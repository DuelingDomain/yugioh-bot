import type Database from "better-sqlite3";
import { createPrereleaseDateLookup } from "@yugidraft/shared/services";
import { spawn } from "node:child_process";
import { closeSync, mkdtempSync, openSync, readSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { deserialize } from "node:v8";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { join, resolve } from "node:path";
import {
  buildArchetypeMatcher, engineInsightCard, interpret, matchCard, omitReadingChips, mayReadEffect,
  compactEffectName, resolveEffectName, cachedEffectReading, intentReading, cardSimilarity, counterProfileFromHooks, counterLink,
  softTextScore, effectMatchReason, shortReason, ArchetypeProfile,
  type ReleaseDates,
  type Card, type Interpretation,
} from "@yugidraft/shared/cards/effects";
import { CARD_TYPE_BITS as T } from "@yugidraft/shared/duels";
import type { CardDatabase } from "./cards.js";
import { cardArtworkFamily } from "./card-artworks.js";
import { buildCardEffectFacets, type CardEffectFacets } from "./card-effect-facets.js";

export interface CardEffectIndex {
  size: number;
  release(code: number): ReleaseDates;
  readQuery(text: string, omitted?: readonly string[]): Interpretation | null;
  match(code: number, reading: Interpretation): number | null;
  popularity(code: number): number;
  reason(code: number, reading: Interpretation): string;
}

const indexes = new WeakMap<CardDatabase, CardEffectIndex>();

/** Missing upstream artwork IDs can bridge by one unambiguous printed engine name. */
export function createCanonicalEffectResolver(cards: CardDatabase): (passcode: number, name?: string) => number {
  const byName = new Map<string, number | null>();
  for (const card of cards.all()) {
    if (card.type & 0x4000) continue;
    const canonical = card.canonicalPasscode ?? cardArtworkFamily(cards, card.code)?.passcode ?? card.code;
    const key = compactEffectName(card.name);
    if (!byName.has(key)) byName.set(key, canonical);
    else if (byName.get(key) !== canonical) byName.set(key, null);
  }
  return (passcode, name) => {
    const card = cards.get(passcode);
    return card?.canonicalPasscode ?? (card ? cardArtworkFamily(cards, passcode)?.passcode : undefined)
      ?? (name ? byName.get(compactEffectName(name)) : undefined) ?? passcode;
  };
}

function installCardEffectIndex(db: Database.Database, cards: CardDatabase, { facets, releases, archetypes: profileArchetypes }: CardEffectFacets): CardEffectIndex {
  const prereleaseDate = createPrereleaseDateLookup(db);
  for (const card of cards.all()) {
    const code = card.canonicalPasscode ?? card.code;
    if (card.prerelease && !releases.get(code)?.prerelease) releases.set(code, { ...releases.get(code), prerelease: true });
  }
  const releaseDates = (code: number) => {
    const dates = releases.get(code) ?? {};
    return prereleaseDate(code, dates, dates.prerelease);
  };
  type PrintedType = Pick<Card, "kind" | "subtypes" | "monsterType" | "attribute">;
  const printedTypes = new Map<string, PrintedType>();
  const names = new Set<string>();
  for (const card of cards.all()) {
    const key = `${card.type}:${card.race}:${card.attribute}`;
    if (!printedTypes.has(key)) {
      const value = engineInsightCard(card);
      printedTypes.set(key, { kind: value.kind, subtypes: value.subtypes, monsterType: value.monsterType, attribute: value.attribute });
    }
    names.add(compactEffectName(card.name));
  }
  const archetypes = new Set([...cards.setnames().values(), ...profileArchetypes]);
  const findArchetypes = buildArchetypeMatcher(archetypes);
  // matchCard is synchronous and does not retain its input. Reuse one record
  // instead of duplicating the running engine's complete printed-card catalog.
  const current: Card = { id: 0, name: "", kind: "monster", typeLine: "", subtypes: [], text: "", formats: [], views: 0, url: "",
    monsterType: undefined, attribute: undefined, level: undefined, rank: undefined, linkRating: undefined,
    atk: null, def: null, tcgDate: undefined, ocgDate: undefined };
  const canonical = (code: number) => cards.get(code)?.canonicalPasscode ?? code;
  const summary = db.prepare<[number], { summary: string; tags_json: string }>("SELECT summary,tags_json FROM card_tags WHERE passcode=?");
  const profileRow = db.prepare<[string], { plan: string; hooks_json: string }>("SELECT plan,hooks_json FROM card_tag_profiles WHERE archetype=? COLLATE NOCASE");
  const contexts = new WeakMap<Interpretation, { anchor?: { card: Card; tags?: import("@yugidraft/shared/cards/effects").MatchTags }; counter?: import("@yugidraft/shared/cards/effects").CounterProfile }>();
  const context = (reading: Interpretation) => {
    let result = contexts.get(reading);
    if (result) return result;
    result = {};
    const intent = reading.query.intent;
    if (intent?.kind === "similar") {
      const anchor = cards.deckCard(intent.passcode);
      if (anchor) result.anchor = { card: engineInsightCard(anchor), tags: facets.get(canonical(intent.passcode)) };
    } else if (intent?.kind === "counters") {
      const row = profileRow.get(intent.archetype);
      try { if (row) result.counter = counterProfileFromHooks(ArchetypeProfile.parse({ plan: row.plan, hooks: JSON.parse(row.hooks_json) })); } catch { /* Optional profile: fail closed. */ }
    }
    contexts.set(reading, result);
    return result;
  };
  const named = (text: string) => {
    const card = resolveEffectName([...cards.all()].filter(card => !card.canonicalPasscode || card.canonicalPasscode === card.code), text);
    return card ? { id: card.code, name: card.name } : undefined;
  };
  const intent = (text: string) => intentReading(text, named, text => resolveEffectName([...archetypes].map(name => ({ name })), text)?.name);
  const index: CardEffectIndex = {
    size: facets.size,
    release: code => releaseDates(canonical(code)),
    readQuery: (text, omitted) => {
      if (names.has(compactEffectName(text))) return null;
      const reading = intent(text) ?? cachedEffectReading(db, text, archetypes) ?? (mayReadEffect(text) ? interpret(text, findArchetypes) : null);
      return reading ? omitReadingChips(reading, omitted) : null;
    },
    match: (code, reading) => {
      const card = cards.deckCard(code);
      if (!card) return null;
      const printed = printedTypes.get(`${card.type}:${card.race}:${card.attribute}`);
      if (!printed) return null;
      const id = card.canonicalPasscode ?? card.code, dates = releaseDates(id);
      current.text = card.description;
      current.id = id; current.name = card.name; current.kind = printed.kind; current.subtypes = printed.subtypes;
      current.monsterType = printed.monsterType; current.attribute = printed.attribute;
      current.level = card.type & (T.xyz | T.link) ? undefined : card.level;
      current.rank = card.type & T.xyz ? card.level : undefined; current.linkRating = card.type & T.link ? card.level : undefined;
      current.atk = card.attack >= 0 ? card.attack : null; current.def = card.defense >= 0 ? card.defense : null;
      current.tcgDate = dates?.tcgDate; current.ocgDate = dates?.ocgDate; current.prerelease = dates?.prerelease; current.upcomingDate = dates?.upcomingDate;
      const tags = facets.get(id), base = matchCard(current, tags, reading.query);
      if (base === null) return null;
      const { anchor, counter } = context(reading);
      const candidate = { card: current, tags };
      const score = reading.query.intent?.kind === "similar" ? (anchor ? cardSimilarity(anchor, candidate) : null)
        : reading.query.intent?.kind === "counters" ? (counter ? counterLink(counter, reading.query.intent.archetype, candidate)?.score ?? null : null) : base;
      return score === null ? null : score + softTextScore(current, reading.query.text);
    },
    reason: (code, reading) => {
      const raw = cards.deckCard(code);
      if (!raw) return "Matches your search";
      const card = engineInsightCard(raw), tags = facets.get(canonical(code)), ctx = context(reading);
      if (reading.query.intent?.kind === "counters" && ctx.counter) return counterLink(ctx.counter, reading.query.intent.archetype, { card, tags })?.reason ?? "Disrupts this plan";
      if (reading.query.intent?.kind === "similar") return shortReason(`Similar ${tags?.roles.find(role => ctx.anchor?.tags?.roles.includes(role))?.replaceAll("_", " ") ?? "effects"} to ${reading.query.intent.name}`);
      // The compact facets drop each action's note and condition; one stored record is read for the retained card only.
      const stored = summary.get(canonical(code));
      let full: typeof tags = tags;
      try { if (stored?.tags_json) full = JSON.parse(stored.tags_json) as typeof tags; } catch { /* Keep the compact facets. */ }
      return effectMatchReason(card, full, reading.query, stored?.summary);
    },
    popularity: code => facets.get(canonical(code))?.popularity ?? 0,
  };
  indexes.set(cards, index);
  return index;
}

/** Synchronous API retained for callers and in-memory fixtures. */
export function createCardEffectIndex(db: Database.Database, cards: CardDatabase): CardEffectIndex {
  const index = installCardEffectIndex(db, cards, buildCardEffectFacets(db));
  db.pragma("shrink_memory");
  return index;
}

const PREPARE_PROCESS = `
  (async () => {
    const module = process.argv[1];
    const load = async () => module.endsWith('.ts')
      ? (await import(process.argv[4])).tsImport(module, module)
      : import(module);
    const [{ default: Database }, { buildCardEffectFacets }] = await Promise.all([
      import(process.argv[3]), load()
    ]);
    const db = new Database(process.argv[2], { readonly: true, fileMustExist: true });
    const write = value => {
      global.gc();
      const bytes = require('node:v8').serialize(value), header = Buffer.allocUnsafe(4);
      header.writeUInt32LE(bytes.length);
      require('node:fs').writeFileSync(3, header);
      require('node:fs').writeFileSync(3, bytes);
    };
    let prepared;
    try { prepared = db.transaction(() => buildCardEffectFacets(db, facets => write({ facets, releases: new Map(), archetypes: [] }))).deferred(); }
    finally { db.close(); }
    write(prepared);
  })().catch(error => { console.error(error); process.exitCode = 1; });
`;

function readPreparedFacets(path: string): CardEffectFacets {
  const fd = openSync(path, "r"), header = Buffer.allocUnsafe(4);
  const prepared: CardEffectFacets = { facets: new Map(), releases: new Map(), archetypes: [] };
  const read = (bytes: Buffer, start = 0) => {
    for (let offset = start; offset < bytes.length;) {
      const count = readSync(fd, bytes, offset, bytes.length - offset, null);
      if (!count) throw new Error("Incomplete effect facet preparation chunk");
      offset += count;
    }
  };
  try {
    while (true) {
      const first = readSync(fd, header, 0, header.length, null);
      if (!first) break;
      read(header, first);
      const bytes = Buffer.allocUnsafe(header.readUInt32LE());
      read(bytes);
      const chunk = deserialize(bytes) as CardEffectFacets;
      for (const [code, facet] of chunk.facets) prepared.facets.set(code, facet);
      for (const [code, release] of chunk.releases) prepared.releases.set(code, release);
      prepared.archetypes.push(...chunk.archetypes);
    }
    return prepared;
  } finally { closeSync(fd); }
}

/** Prepare temporary parser/interner state in a disposable process. Install
 * only after exit, retaining its deserialized compact graph in the server. */
export async function initializeCardEffectIndex(db: Database.Database, cards: CardDatabase): Promise<CardEffectIndex> {
  if (!db.name || db.name === ":memory:" || db.inTransaction) return createCardEffectIndex(db, cards);
  const temporary = mkdtempSync(join(tmpdir(), "effect-facets-")), path = join(temporary, "facets");
  const fd = openSync(path, "w", 0o600);
  try {
    const source = import.meta.url.endsWith(".ts"), require = createRequire(import.meta.url);
    const module = new URL(source ? "./card-effect-facets.ts" : "./card-effect-facets.js", import.meta.url).href;
    const sqliteModule = pathToFileURL(require.resolve("better-sqlite3")).href;
    const tsxModule = source ? pathToFileURL(require.resolve("tsx/esm/api")).href : "";
    await new Promise<void>((complete, reject) => {
      let stderr = "";
      const child = spawn(process.execPath, ["--expose-gc", `--max-old-space-size=${source ? 48 : 32}`, `--max-semi-space-size=${source ? 4 : 1}`, "--input-type=commonjs", "-e", PREPARE_PROCESS, module, resolve(db.name), sqliteModule, tsxModule], {
        stdio: ["ignore", "ignore", "pipe", fd], env: { ...process.env, NODE_OPTIONS: "" },
      });
      child.stderr!.setEncoding("utf8");
      child.stderr!.on("data", value => { if (stderr.length < 16 * 1024) stderr += value; });
      child.once("error", reject);
      child.once("close", code => {
        if (code !== 0) reject(new Error(`Effect facet preparation failed (${code}): ${stderr}`));
        else complete();
      });
    });
    const prepared = readPreparedFacets(path);
    db.pragma("shrink_memory");
    return installCardEffectIndex(db, cards, prepared);
  } finally {
    closeSync(fd);
    rmSync(temporary, { recursive: true, force: true });
  }
}

export function cardEffectIndex(cards: CardDatabase): CardEffectIndex | undefined {
  return indexes.get(cards);
}

const releaseIndexes = new WeakMap<Database.Database, { revision: number; cards?: CardDatabase; releases: Map<number, ReleaseDates> }>();
/** Date sorting and filters remain available without parsing or retaining any effect tags. */
export function cardReleaseIndex(db: Database.Database, cards?: CardDatabase): ReadonlyMap<number, ReleaseDates> {
  const revision = (db.prepare("SELECT revision FROM card_catalog_revision WHERE id=1").get() as { revision: number }).revision;
  const cached = releaseIndexes.get(db);
  if (cached?.revision === revision && (!cards || cached.cards === cards)) return cached.releases;
  const releases = new Map<number, ReleaseDates>();
  for (const row of db.prepare("SELECT passcode,tcg_date,ocg_date FROM card_release").iterate() as Iterable<{ passcode: number; tcg_date: string | null; ocg_date: string | null }>) {
    releases.set(row.passcode, { ...(row.tcg_date ? { tcgDate: row.tcg_date } : {}), ...(row.ocg_date ? { ocgDate: row.ocg_date } : {}) });
  }
  const prereleaseDate = createPrereleaseDateLookup(db);
  for (const card of cards?.all() ?? []) {
    const code = card.canonicalPasscode ?? card.code;
    if (card.prerelease && !releases.get(code)?.prerelease) releases.set(code, prereleaseDate(code, releases.get(code) ?? {}, true));
  }
  releaseIndexes.set(db, { revision, cards, releases });
  return releases;
}
