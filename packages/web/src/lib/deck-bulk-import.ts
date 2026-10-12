import { NextResponse } from "next/server";
import { decodeYdke, parseYdk, splitImportText, type DeckSections, type FormatIssue } from "@yugidraft/shared/decks";
import type { DuelDeck, DuelMode } from "@yugidraft/shared/duels";
import { SavedDeckServiceError, validateSavedDeckWrite } from "@yugidraft/shared/services";
import { normalizeDraftCardCodes } from "@/lib/draft-deck-codes";
import { requireDuelActor } from "@/lib/duel-host";
import { checkSavedDeckMaster, type SavedDeckActor } from "@/lib/saved-decks";

export const MAX_IMPORT_DECKS = 50;
const MAX_BODY_BYTES = 1024 * 1024;
const MAX_SOURCE_BYTES = 64 * 1024;
type Actor = Extract<SavedDeckActor, { ok: true }>;
export type ImportIssue = FormatIssue & { passcode?: number; from?: number; to?: number };
type Duplicate = { kind: "saved"; deckId: number; name: string } | { kind: "row"; rowId: string; name: string };
export type ImportPreviewRow = {
  rowId: string;
  sourceId: string;
  name: string;
  deck: DeckSections;
  counts: { main: number; extra: number; side: number };
  errors: ImportIssue[];
  warnings: ImportIssue[];
  duplicateOf?: Duplicate;
};
const emptyDeck = (): DeckSections => ({ main: [], extra: [], side: [], deckMaster: null });
const errorResponse = (error: string, status = 400) => NextResponse.json({ error }, { status });
const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);

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

/** null is the public no-master value; storage uses an omitted property. Mode follows the existing file importer. */
export function validateImportRow(value: unknown):
  | { ok: true; name: string; mode: DuelMode; deck: DuelDeck }
  | { ok: false; errors: ImportIssue[] } {
  try {
    if (!isRecord(value)) throw new SavedDeckServiceError("Expected a deck row", 400);
    let deck = value.deck;
    const mode: DuelMode = isRecord(deck) && deck.deckMaster != null ? "domain" : "normal";
    if (isRecord(deck) && deck.deckMaster === null) {
      const { deckMaster: _master, ...rest } = deck;
      deck = rest;
    }
    return { ok: true, ...validateSavedDeckWrite({ name: value.name, mode, deck }) };
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
      || typeof source.name !== "string" || typeof source.text !== "string") {
      return { ok: false, response: errorResponse("Each source needs a unique string id, name and text") };
    }
    const sourceId = source.id;
    ids.add(sourceId);
    if (Buffer.byteLength(source.text, "utf8") > MAX_SOURCE_BYTES) {
      return { ok: false, response: errorResponse("Each source text must be at most 64 KiB", 413) };
    }
    const inputs = splitImportText(source.text, source.name);
    if (rows.length + inputs.length > MAX_IMPORT_DECKS) return { ok: false, response: importListError("decks") };
    inputs.forEach((input, index) => {
      let deck: DeckSections = emptyDeck();
      let errors: ImportIssue[] = [];
      if (input.kind === "ydke") {
        const parsed = decodeYdke(input.text);
        if ("error" in parsed) errors = [parsed.error];
        else deck = { ...parsed.deck, deckMaster: null };
      } else {
        const parsed = parseYdk(input.text);
        errors = parsed.issues;
        if (errors.length === 0) deck = { ...parsed.deck, deckMaster: parsed.deck.deckMaster ?? null };
      }
      const name = input.kind === "ydke" ? `Imported deck ${++ydkeNumber}` : input.name;
      if (errors.length === 0) {
        const valid = validateImportRow({ name, deck });
        if (!valid.ok) errors = valid.errors;
      }
      rows.push({ rowId: `${sourceId}#${index}`, sourceId, name, deck,
        counts: { main: deck.main.length, extra: deck.extra.length, side: deck.side.length }, errors, warnings: [] });
    });
  }
  return { ok: true, rows };
}

const allCodes = (deck: DeckSections) => [...deck.main, ...deck.extra, ...deck.side, ...(deck.deckMaster == null ? [] : [deck.deckMaster])];

/** Share the existing engine resolver and its validated effective remaps. Keep known artwork passcodes. */
export async function resolveImportCodes(actor: Actor, decks: DeckSections[]) {
  const codes = [...new Set(decks.flatMap(allCodes))];
  if (codes.length === 0) return { ok: true as const, codes: new Map<number, number | null>() };
  const duelActor = await requireDuelActor();
  if (!duelActor.ok) return duelActor;
  return normalizeDraftCardCodes({ guildId: actor.guildId, playerId: duelActor.playerId, codes, preserveArtwork: true });
}

export function resolveImportDeck(deck: DeckSections, codes: ReadonlyMap<number, number | null>) {
  const errors: ImportIssue[] = [];
  const warnings: ImportIssue[] = [];
  for (const code of new Set(allCodes(deck))) {
    const resolved = codes.get(code);
    if (resolved == null) errors.push({ code: "unknown_card", message: `Unknown card ${code}`, passcode: code });
    else if (resolved !== code) warnings.push({ code: "remapped", message: `Passcode ${code} was mapped to ${resolved}.`, from: code, to: resolved });
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
  const checked = await checkSavedDeckMaster("domain", deck);
  if (checked.ok) return [];
  const body = await checked.response.json() as { error?: string };
  return [{ code: checked.response.status >= 500 ? "validation_unavailable" : "invalid_deck_master",
    message: body.error ?? "Could not validate Deck Master." }];
}

/** Contract identity is the combined multiset, including the master; sections, order and name do not affect it. */
export function importDeckIdentity(deck: DeckSections, codes: ReadonlyMap<number, number | null> = new Map()): string {
  return allCodes(deck).map(code => codes.get(code) ?? code).sort((a, b) => a - b).join(",");
}

export async function finishImportPreview(actor: Actor, rows: ImportPreviewRow[]): Promise<NextResponse> {
  const valid = rows.filter(row => row.errors.length === 0);
  if (valid.length === 0) return NextResponse.json({ maxDecks: MAX_IMPORT_DECKS, rows });
  const saved = actor.decks.list(actor.guildId, actor.ownerUserId);
  const resolved = await resolveImportCodes(actor, [...valid.map(row => row.deck), ...saved.map(row => row.deck)]);
  if (!resolved.ok) return resolved.response;
  const duplicates = new Map<string, Duplicate>();
  for (const stored of saved) {
    const key = importDeckIdentity(stored.deck, resolved.codes);
    if (!duplicates.has(key)) duplicates.set(key, { kind: "saved", deckId: stored.id, name: stored.name });
  }
  for (const row of valid) {
    const mapped = resolveImportDeck(row.deck, resolved.codes);
    row.deck = mapped.deck;
    row.errors.push(...mapped.errors, ...await masterIssues(mapped.deck));
    row.warnings.push(...mapped.warnings, ...sizeWarnings(mapped.deck));
    const key = importDeckIdentity(mapped.deck);
    const duplicate = duplicates.get(key);
    if (duplicate) row.duplicateOf = duplicate;
    else duplicates.set(key, { kind: "row", rowId: row.rowId, name: row.name });
  }
  return NextResponse.json({ maxDecks: MAX_IMPORT_DECKS, rows });
}

export async function saveImportRows(actor: Actor, rows: unknown[]): Promise<NextResponse> {
  const checked = rows.map(validateImportRow);
  const valid = checked.filter(row => row.ok);
  const resolved = await resolveImportCodes(actor, valid.map(row => row.deck));
  if (!resolved.ok) return resolved.response;
  const created: Array<{ id: number; name: string }> = [];
  const failed: Array<{ index: number; errors: ImportIssue[] }> = [];
  for (const [index, row] of checked.entries()) {
    if (!row.ok) {
      failed.push({ index, errors: row.errors });
      continue;
    }
    const mapped = resolveImportDeck(row.deck, resolved.codes);
    const errors = [...mapped.errors, ...await masterIssues(mapped.deck)];
    if (errors.length > 0) {
      failed.push({ index, errors });
      continue;
    }
    // Validate the resolved deck too. The service remains the authority for storage rules.
    const final = validateImportRow({ name: row.name, deck: mapped.deck });
    if (!final.ok) {
      failed.push({ index, errors: final.errors });
      continue;
    }
    try {
      // Selected duplicates are allowed. Always create a library deck owned by the server actor.
      const saved = actor.decks.create(actor.guildId, actor.ownerUserId, { name: final.name, mode: final.mode, deck: final.deck });
      created.push({ id: saved.id, name: saved.name });
    } catch (error) {
      if (!(error instanceof SavedDeckServiceError)) throw error;
      failed.push({ index, errors: [{ code: "save_failed", message: error.message }] });
    }
  }
  return NextResponse.json({ created, failed });
}
