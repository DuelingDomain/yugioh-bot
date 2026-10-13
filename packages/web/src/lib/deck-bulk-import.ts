import { NextResponse } from "next/server";
import { decodeYdke, MAX_DECK_ISSUES, parseYdk, splitImportText, type DeckSections, type FormatIssue } from "@yugidraft/shared/decks";
import { assertExtraDeckCards, ExtraDeckCardError, routeDeckSections, type DuelDeck, type DuelMode } from "@yugidraft/shared/duels";
import { CARD_LOOKUP_LIMIT, createDeckTypeLookup, SavedDeckServiceError, validateSavedDeckWrite } from "@yugidraft/shared/services";
import { getDb } from "@/lib/db";
import { normalizeDraftCardCodes } from "@/lib/draft-deck-codes";
import { requireDuelActor } from "@/lib/duel-host";
import { checkSavedDeckMaster, type SavedDeckActor } from "@/lib/saved-decks";

export const MAX_IMPORT_DECKS = 50;
const MAX_IMPORT_CODES = MAX_IMPORT_DECKS * 91;
const MAX_BODY_BYTES = 1024 * 1024;
const MAX_SOURCE_BYTES = 64 * 1024;
type Actor = Extract<SavedDeckActor, { ok: true }>;
export type ImportMode = "standard" | "domain";
export type ImportIssue = FormatIssue & { passcode?: number; from?: number; to?: number };
type Duplicate = { kind: "saved"; deckId: number; name: string } | { kind: "row"; rowId: string; name: string };
export type ImportPreviewRow = {
  rowId: string;
  sourceId: string;
  name: string;
  mode: ImportMode;
  deck: DeckSections;
  counts: { main: number; extra: number; side: number };
  errors: ImportIssue[];
  warnings: ImportIssue[];
  duplicateOf?: Duplicate;
};
const emptyDeck = (): DeckSections => ({ main: [], extra: [], side: [], deckMaster: null });
const errorResponse = (error: string, status = 400) => NextResponse.json({ error }, { status });
const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const isImportMode = (value: unknown): value is ImportMode => value === "standard" || value === "domain";
const importMode = (mode: DuelMode): ImportMode => mode === "domain" ? "domain" : "standard";
const sourceLines = new WeakMap<ImportPreviewRow, Map<number, number>>();

/** Errors take priority so a long warning list cannot hide a blocking issue. */
function boundIssues(errors: ImportIssue[], warnings: ImportIssue[] = []) {
  const count = (issues: ImportIssue[]) => issues.reduce((total, issue) => total + (issue.code === "more_issues" ? issue.count ?? 1 : 1), 0);
  const keptErrors = errors.filter(issue => issue.code !== "more_issues").slice(0, MAX_DECK_ISSUES);
  const keptWarnings = warnings.filter(issue => issue.code !== "more_issues").slice(0, MAX_DECK_ISSUES - keptErrors.length);
  const omitted = count(errors) + count(warnings) - keptErrors.length - keptWarnings.length;
  if (omitted > 0) {
    const list = count(errors) > keptErrors.length ? keptErrors : keptWarnings;
    list.push({ code: "more_issues", message: `and ${omitted} more issues`, count: omitted });
  }
  return { errors: keptErrors, warnings: keptWarnings };
}

// Preview and bulk share request/lookup buckets and a lock. Idle, fully refilled buckets expire.
type ImportBucket = { tokens: number; lookupTokens: number; updated: number; inFlight: boolean };
const importBuckets = new Map<string, ImportBucket>();
const IMPORT_BURST = 20;
const IMPORT_REFILL_MS = 6000;
const LOOKUP_BURST = 100;
const LOOKUP_REFILL_MS = 6000;
const actorKey = (actor: Actor) => `${actor.guildId}:${actor.ownerUserId}`;

function importBucket(actor: Actor): ImportBucket {
  const now = Date.now();
  for (const [key, bucket] of importBuckets) {
    if (!bucket.inFlight && now - bucket.updated >= LOOKUP_BURST * LOOKUP_REFILL_MS) importBuckets.delete(key);
  }
  const key = actorKey(actor);
  const bucket = importBuckets.get(key) ?? { tokens: IMPORT_BURST, lookupTokens: LOOKUP_BURST, updated: now, inFlight: false };
  const elapsed = Math.max(0, now - bucket.updated);
  bucket.tokens = Math.min(IMPORT_BURST, bucket.tokens + elapsed / IMPORT_REFILL_MS);
  bucket.lookupTokens = Math.min(LOOKUP_BURST, bucket.lookupTokens + elapsed / LOOKUP_REFILL_MS);
  bucket.updated = now;
  importBuckets.set(key, bucket);
  return bucket;
}

export function checkImportRateLimit(actor: Actor): NextResponse | null {
  const bucket = importBucket(actor);
  if (bucket.inFlight) {
    return NextResponse.json({ error: "A deck import is already in progress, try again shortly", retryAfterSeconds: 1 },
      { status: 429, headers: { "Retry-After": "1" } });
  }
  if (bucket.tokens < 1) {
    const retryAfterSeconds = Math.ceil((1 - bucket.tokens) * IMPORT_REFILL_MS / 1000);
    return NextResponse.json({ error: "Too many deck imports, try again shortly", retryAfterSeconds }, { status: 429, headers: { "Retry-After": String(retryAfterSeconds) } });
  }
  bucket.tokens--;
  bucket.inFlight = true;
  return null;
}

/** Always release in a route's finally, including malformed bodies and host errors. */
export function finishImportRequest(actor: Actor): void {
  const bucket = importBuckets.get(actorKey(actor));
  if (bucket) bucket.inFlight = false;
}

const negativeCodes = new Map<number, number>();
const NEGATIVE_CACHE_MS = 10 * 60 * 1000;
const MAX_NEGATIVE_CODES = 5000;

function rememberUnknown(code: number): void {
  negativeCodes.delete(code);
  if (negativeCodes.size >= MAX_NEGATIVE_CODES) negativeCodes.delete(negativeCodes.keys().next().value!);
  negativeCodes.set(code, Date.now() + NEGATIVE_CACHE_MS);
}

/** Enforce the actual streamed JSON byte count, including requests without Content-Length. */
export async function readImportBody(request: Request): Promise<
  { ok: true; body: Record<string, unknown> } | { ok: false; response: NextResponse }
> {
  if (Number(request.headers.get("content-length")) > MAX_BODY_BYTES) {
    return { ok: false, response: errorResponse("Import body must be at most 1 MiB", 413) };
  }
  try {
    if (!request.body) return { ok: false, response: errorResponse("Invalid JSON body") };
    const reader = request.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_BODY_BYTES) {
          await reader.cancel();
          return { ok: false, response: errorResponse("Import body must be at most 1 MiB", 413) };
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    const body: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    return isRecord(body) ? { ok: true, body } : { ok: false, response: errorResponse("Expected an import object") };
  } catch {
    return { ok: false, response: errorResponse("Invalid JSON body") };
  }
}

export function checkImportList(value: unknown): value is unknown[] {
  return Array.isArray(value) && value.length > 0 && value.length <= MAX_IMPORT_DECKS;
}
export const importListError = (label: string) => errorResponse(`Provide between 1 and ${MAX_IMPORT_DECKS} ${label}`);

/** Match importForLibrary: explicit master selects Domain; a lone Domain Side card becomes the master. */
export function validateImportRow(value: unknown):
  | { ok: true; name: string; mode: DuelMode; deck: DuelDeck }
  | { ok: false; errors: ImportIssue[] } {
  try {
    if (!isRecord(value)) throw new SavedDeckServiceError("Expected a deck row", 400);
    if (value.mode !== undefined && !isImportMode(value.mode)) {
      throw new SavedDeckServiceError("Import mode must be standard or domain", 400);
    }
    let deck = value.deck;
    const mode: DuelMode = value.mode === "domain" || (isRecord(deck) && deck.deckMaster != null) ? "domain" : "normal";
    if (isRecord(deck) && deck.deckMaster === null) {
      const { deckMaster: _master, ...rest } = deck;
      deck = rest;
    }
    const valid = validateSavedDeckWrite({ name: value.name, mode, deck });
    if (valid.mode === "domain" && valid.deck.deckMaster == null && valid.deck.side.length === 1) {
      valid.deck = { ...valid.deck, side: [], deckMaster: valid.deck.side[0] };
    }
    if (allCodes(valid.deck).length === 0) return { ok: false, errors: [{ code: "empty_deck", message: "No cards found" }] };
    return { ok: true, ...valid };
  } catch (error) {
    if (!(error instanceof SavedDeckServiceError)) throw error;
    return { ok: false, errors: [{ code: "invalid_deck", message: error.message }] };
  }
}

export function parseImportSources(sources: unknown[]): { ok: true; rows: ImportPreviewRow[] } | { ok: false; response: NextResponse } {
  const rows: ImportPreviewRow[] = [];
  const ids = new Set<string>();
  let ydkeNumber = 0;
  for (const source of sources) {
    if (!isRecord(source) || typeof source.id !== "string" || !source.id.trim() || ids.has(source.id)
      || (source.name !== undefined && typeof source.name !== "string") || typeof source.text !== "string") {
      return { ok: false, response: errorResponse("Each source needs a unique string id and text, with an optional string name") };
    }
    if (source.mode !== undefined && !isImportMode(source.mode)) {
      return { ok: false, response: errorResponse("Import mode must be standard or domain") };
    }
    const sourceMode: ImportMode = source.mode ?? "standard";
    const sourceId = source.id;
    ids.add(sourceId);
    if (Buffer.byteLength(source.text, "utf8") > MAX_SOURCE_BYTES) {
      return { ok: false, response: errorResponse("Each source text must be at most 64 KiB", 413) };
    }
    const inputs = splitImportText(source.text, source.name);
    const nonblankLines = source.text.split(/\r\n|\n|\r/).flatMap((line, index) => line.trim() ? [index + 1] : []);
    if (rows.length + inputs.length > MAX_IMPORT_DECKS) return { ok: false, response: importListError("decks") };
    inputs.forEach((input, index) => {
      let deck: DeckSections = emptyDeck();
      // The current library picker defaults to Standard; there is no persisted user mode preference.
      let mode: ImportMode = sourceMode;
      let errors: ImportIssue[] = [];
      let warnings: ImportIssue[] = [];
      const cardLines = new Map<number, number>();
      if (input.kind === "ydke") {
        const parsed = decodeYdke(input.text);
        if ("error" in parsed) errors = [{ ...parsed.error, line: nonblankLines[index] }];
        else {
          deck = { ...parsed.deck, deckMaster: null };
          for (const code of allCodes(deck)) cardLines.set(code, nonblankLines[index]);
        }
      } else {
        const parsed = parseYdk(input.text, { onCard: (code, line) => { if (!cardLines.has(code)) cardLines.set(code, line); } });
        warnings = parsed.issues;
        deck = { ...parsed.deck, deckMaster: parsed.deck.deckMaster ?? null };
      }
      const name = input.kind === "ydke" ? `Imported deck ${++ydkeNumber}` : input.name;
      if (errors.length === 0) {
        const valid = validateImportRow({ name, deck, mode });
        if (!valid.ok) errors = valid.errors;
        else {
          mode = importMode(valid.mode);
          deck = { ...valid.deck, deckMaster: valid.deck.deckMaster ?? null };
        }
      }
      const row: ImportPreviewRow = { rowId: `${sourceId}#${index}`, sourceId, name, mode, deck,
        counts: { main: deck.main.length, extra: deck.extra.length, side: deck.side.length }, errors, warnings };
      sourceLines.set(row, cardLines);
      rows.push(row);
    });
  }
  return { ok: true, rows };
}

const allCodes = (deck: DeckSections) => [...deck.main, ...deck.extra, ...deck.side, ...(deck.deckMaster == null ? [] : [deck.deckMaster])];

/** Share the existing engine resolver and its validated effective remaps. Keep known artwork passcodes. */
export async function resolveImportCodes(actor: Actor, decks: DeckSections[], cacheOnly = false) {
  const codes = [...new Set(decks.flatMap(allCodes))];
  if (!cacheOnly && codes.length > MAX_IMPORT_CODES) return { ok: false as const, response: errorResponse(`Import must contain at most ${MAX_IMPORT_CODES} unique card codes`) };
  const now = Date.now();
  for (const [code, expires] of negativeCodes) if (expires <= now) negativeCodes.delete(code);
  const unknown = cacheOnly ? [] : codes.filter(code => negativeCodes.has(code));
  const pending = cacheOnly ? codes : codes.filter(code => !negativeCodes.has(code));
  if (pending.length === 0) return { ok: true as const, codes: new Map<number, number | null>(unknown.map(code => [code, null])),
    canonicalCodes: new Map<number, number | null>(unknown.map(code => [code, null])), lookupLimitedCodes: new Set<number>() };
  const duelActor = await requireDuelActor();
  if (!duelActor.ok) return duelActor;
  const bucket = importBucket(actor);
  const lookupLimit = cacheOnly ? 0 : Math.min(CARD_LOOKUP_LIMIT, Math.floor(bucket.lookupTokens));
  // Reserve before calling the host. Refund only a validated remainder; a lost response cannot grant fresh lookups.
  bucket.lookupTokens -= lookupLimit;
  const result = await normalizeDraftCardCodes({ guildId: actor.guildId, playerId: duelActor.playerId, codes: pending, preserveArtwork: true,
    lookupLimit, ...(cacheOnly ? { cacheOnly: true } : {}), includeCanonical: true });
  if (!result.ok) return result;
  bucket.lookupTokens = Math.min(LOOKUP_BURST, bucket.lookupTokens + (result.lookupRemaining ?? 0));
  if (!cacheOnly) {
    for (const [code, resolved] of result.codes) {
      if (resolved === null && !result.lookupLimitedCodes.has(code)) rememberUnknown(code);
    }
  }
  for (const code of unknown) {
    result.codes.set(code, null);
    result.canonicalCodes.set(code, null);
  }
  return result;
}

export function resolveImportDeck(deck: DeckSections, codes: ReadonlyMap<number, number | null>, limited: ReadonlySet<number> = new Set(), lines: ReadonlyMap<number, number> = new Map()) {
  const errors: ImportIssue[] = [];
  const warnings: ImportIssue[] = [];
  for (const code of new Set(allCodes(deck))) {
    const resolved = codes.get(code);
    const line = lines.get(code);
    const position = line === undefined ? {} : { line };
    if (resolved == null) errors.push(limited.has(code)
      ? { code: "lookup_limited", message: "lookup limit reached, try again", passcode: code, ...position }
      : { code: "unknown_card", message: `Unknown card ${code}`, passcode: code, ...position });
    else if (resolved !== code) warnings.push({ code: "remapped", message: `Passcode ${code} was mapped to ${resolved}.`, from: code, to: resolved, ...position });
  }
  const map = (code: number) => codes.get(code) ?? code;
  const mapped: DeckSections = { main: deck.main.map(map), extra: deck.extra.map(map), side: deck.side.map(map),
    deckMaster: deck.deckMaster == null ? null : map(deck.deckMaster) };
  return { deck: mapped, errors, warnings };
}

export function sizeWarnings(deck: DeckSections): ImportIssue[] {
  const warnings: ImportIssue[] = [];
  if (deck.main.length < 40 || deck.main.length > 60) warnings.push({ code: "main_size", message: "Main Deck normally contains 40 to 60 cards." });
  for (const section of ["extra", "side"] as const) {
    if (deck[section].length > 15) warnings.push({ code: `${section}_size`, message: `${section === "extra" ? "Extra" : "Side"} Deck normally contains at most 15 cards.` });
  }
  return warnings;
}

export async function masterIssues(deck: DeckSections): Promise<ImportIssue[]> {
  if (deck.deckMaster == null) return [];
  let checked: Awaited<ReturnType<typeof checkSavedDeckMaster>>;
  try { checked = await checkSavedDeckMaster("domain", deck); }
  catch { return [{ code: "validation_unavailable", message: "Duel engine unavailable, try again" }]; }
  if (checked.ok) return [];
  const body = await checked.response.json() as { error?: string };
  return [{ code: checked.response.status >= 500 ? "validation_unavailable" : "invalid_deck_master",
    message: body.error ?? "Could not validate Deck Master." }];
}

/** Contract identity is the combined multiset, including the master; sections, order and name do not affect it. */
export function importDeckIdentity(deck: DeckSections, codes: ReadonlyMap<number, number | null> = new Map()): string {
  return allCodes(deck).map(code => codes.get(code) ?? code).sort((a, b) => a - b).join(",");
}

const sectionIssues = (messages: string[]): ImportIssue[] => messages.map(message => ({
  code: message.startsWith("Card type is unknown") ? "unknown_card_type" : message.startsWith("Extra Deck contains") ? "extra_size" : "section_moved", message,
}));

export async function finishImportPreview(actor: Actor, rows: ImportPreviewRow[]): Promise<NextResponse> {
  const valid = rows.filter(row => row.errors.length === 0);
  const response = () => {
    for (const row of rows) Object.assign(row, boundIssues(row.errors, row.warnings));
    return NextResponse.json({ maxDecks: MAX_IMPORT_DECKS, rows });
  };
  if (valid.length === 0) return response();
  const saved = actor.decks.list(actor.guildId, actor.ownerUserId);
  const resolved = await resolveImportCodes(actor, valid.map(row => row.deck));
  if (!resolved.ok) return resolved.response;
  const savedCodes = await resolveImportCodes(actor, saved.map(row => row.deck), true);
  if (!savedCodes.ok) return savedCodes.response;
  const duplicates = new Map<string, Duplicate>();
  for (const stored of saved) {
    const key = importDeckIdentity(stored.deck, savedCodes.canonicalCodes);
    if (!duplicates.has(key)) duplicates.set(key, { kind: "saved", deckId: stored.id, name: stored.name });
  }
  const findCard = createDeckTypeLookup(getDb()).snapshot();
  for (const row of valid) {
    const key = importDeckIdentity(row.deck, resolved.canonicalCodes);
    const masterLine = row.deck.deckMaster == null ? undefined : sourceLines.get(row)?.get(row.deck.deckMaster);
    const mapped = resolveImportDeck(row.deck, resolved.codes, resolved.lookupLimitedCodes, sourceLines.get(row));
    // The engine type takes priority over catalog frames and file section labels.
    const routed = mapped.errors.length === 0
      ? routeDeckSections({ ...mapped.deck, deckMaster: mapped.deck.deckMaster ?? undefined }, findCard)
      : { deck: mapped.deck, messages: [] };
    row.deck = { ...routed.deck, deckMaster: routed.deck.deckMaster ?? null };
    row.counts = { main: row.deck.main.length, extra: row.deck.extra.length, side: row.deck.side.length };
    const final = validateImportRow({ name: row.name, mode: row.mode, deck: row.deck });
    const master = mapped.errors.length || !final.ok ? [] : await masterIssues(row.deck);
    if (master.some(issue => issue.code === "validation_unavailable")) return errorResponse("Duel engine unavailable, try again", 503);
    row.errors.push(...mapped.errors, ...(final.ok ? [] : final.errors), ...master.map(issue => masterLine === undefined ? issue : { ...issue, line: masterLine }));
    row.warnings.push(...mapped.warnings, ...sectionIssues(routed.messages), ...sizeWarnings(row.deck).filter(issue => issue.code !== "extra_size" || !routed.messages.some(message => message.startsWith("Extra Deck contains"))));
    const duplicate = duplicates.get(key);
    if (duplicate) row.duplicateOf = duplicate;
    else duplicates.set(key, { kind: "row", rowId: row.rowId, name: row.name });
  }
  return response();
}

export async function saveImportRows(actor: Actor, rows: unknown[]): Promise<NextResponse> {
  const checked = rows.map(validateImportRow);
  const valid = checked.filter(row => row.ok);
  const resolved = await resolveImportCodes(actor, valid.map(row => row.deck));
  if (!resolved.ok) return resolved.response;
  const created: Array<{ id: number; name: string }> = [];
  const failed: Array<{ index: number; errors: ImportIssue[] }> = [];
  const warnings: Array<{ index: number; warnings: ImportIssue[] }> = [];
  const prepared: Array<{ index: number; name: string; mode: DuelMode; deck: DuelDeck }> = [];
  const findCard = createDeckTypeLookup(getDb()).snapshot();
  for (const [index, row] of checked.entries()) {
    if (!row.ok) {
      failed.push({ index, errors: row.errors });
      continue;
    }
    const mapped = resolveImportDeck(row.deck, resolved.codes, resolved.lookupLimitedCodes);
    // Recheck resolved preview rows before any writes, with the same 400/code as ordinary saves.
    if (mapped.errors.length === 0) {
      try { assertExtraDeckCards(mapped.deck, findCard); }
      catch (error) {
        if (error instanceof ExtraDeckCardError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
        throw error;
      }
    }
    // Direct bulk rows must obey the same section rule as preview rows.
    const routed = mapped.errors.length ? { deck: mapped.deck, messages: [] }
      : routeDeckSections({ ...mapped.deck, deckMaster: mapped.deck.deckMaster ?? undefined }, findCard);
    const warning = sectionIssues(routed.messages);
    const master = mapped.errors.length ? [] : await masterIssues(routed.deck);
    if (master.some(issue => issue.code === "validation_unavailable")) return errorResponse("Duel engine unavailable, try again", 503);
    const errors = [...mapped.errors, ...master];
    if (errors.length > 0) {
      failed.push({ index, errors: boundIssues(errors).errors });
      continue;
    }
    // Validate the resolved deck too. The service remains the authority for storage rules.
    const final = validateImportRow({ name: row.name, deck: routed.deck, mode: importMode(row.mode) });
    if (!final.ok) {
      failed.push({ index, errors: final.errors });
      continue;
    }
    prepared.push({ index, name: final.name, mode: final.mode, deck: final.deck });
    if (warning.length) warnings.push({ index, warnings: warning });
  }
  // Finish every host check before writing: a 503 must not hide already-created decks.
  for (const final of prepared) {
    try {
      // Selected duplicates are allowed. Always create a library deck owned by the server actor.
      const saved = actor.decks.create(actor.guildId, actor.ownerUserId, { name: final.name, mode: final.mode, deck: final.deck });
      created.push({ id: saved.id, name: saved.name });
    } catch (error) {
      if (!(error instanceof SavedDeckServiceError)) throw error;
      failed.push({ index: final.index, errors: [{ code: "save_failed", message: error.message }] });
    }
  }
  return NextResponse.json({ created, failed: failed.sort((a, b) => a.index - b.index), ...(warnings.length ? { warnings } : {}) });
}
