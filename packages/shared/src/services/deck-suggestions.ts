import { formatStaples } from "../cards/effects/staples.js";
import { createHash } from "node:crypto";
import type Database from "better-sqlite3";
import { DEFAULT_GENESYS_POINT_CAP, MAX_GENESYS_POINT_CAP, type DuelDeck } from "../duels/index.js";
import { isExtraDeckCard, isBarredFromGenesys } from "../cards/effects/card.js";
import { type RankedInsightCard } from "../cards/effects/synergy.js";
import { shortReason } from "../cards/effects/search-reasons.js";
import { matchesReleased, cardReleaseInfo } from "../cards/effects/releases.js";
import { createMainDeckSummonChecker } from "../cards/effects/deck-summon.js";
import type { CardInsightOptions, CardInsightFormat } from "./card-insights.js";
import type { InsightCatalog } from "./card-insight-catalog.js";
import { deckSuggestionCore, deckSupportContext } from "./deck-suggestion-hooks.js";
import { outsideUtilityEvaluator, utilitySelectivity } from "./deck-suggestion-utility.js";
import { suggestionStapleReason, viableSuggestionStaple } from "./deck-suggestion-staples.js";
import { extraDeckRanking } from "./deck-suggestion-extra.js";
import { archetypeDeckRanking } from "./deck-suggestion-archetype.js";

export interface DeckSuggestionLegality {
  allowed: readonly number[];
  limits: Readonly<Record<number, number>>;
  copyGroups?: Readonly<Record<number, number>>;
  version: string;
}
export interface DeckSuggestionOptions extends CardInsightOptions {
  /** Trusted guild scope; never accepted from HTTP query data. */
  guildId?: string;
  format: CardInsightFormat;
  pool?: readonly number[];
  exclude?: readonly number[];
  banlist?: string;
  /** Trusted server admission scope. Missing scope fails closed. Never accepted from HTTP. */
  legality?: DeckSuggestionLegality;
  /** Disable local retention when the web server owns the result cache. Never accepted from HTTP. */
  cache?: false;
}
export interface DeckSuggestionRow {
  id: "archetype" | "outside" | "extra" | "staples";
  cards: RankedInsightCard[];
  state: "ready" | "hint";
  hint?: string;
  minimumMainCards?: number;
  mainCards?: number;
}
export interface DeckSuggestionResult { rows: DeckSuggestionRow[]; version: string }
// Next routes and instrumentation can load separate module graphs in one process.
// Sharing the registry preserves one 64-entry budget for each shared database handle.
const cacheKey = Symbol.for("yugidraft.deck-suggestions.caches.v1");
const cacheRuntime = globalThis as typeof globalThis & { [cacheKey]?: WeakMap<Database.Database, Map<string, string>> };
const caches = cacheRuntime[cacheKey] ??= new WeakMap<Database.Database, Map<string, string>>();
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
type Entry = RankedInsightCard & { popularity: number; role?: number; playShare?: number };
type RankOrder = Pick<Entry, "score" | "popularity" | "passcode" | "role" | "playShare">;
const compare = (a: RankOrder, b: RankOrder) => b.score - a.score || (b.role ?? 0) - (a.role ?? 0)
  || (b.playShare ?? 0) - (a.playShare ?? 0) || b.popularity - a.popularity || a.passcode - b.passcode;
function retain(list: Entry[], item: Entry, limit = 12) {
  if (list.length === limit && compare(item, list[list.length - 1]!) >= 0) return;
  list.push(item); list.sort(compare); if (list.length > limit) list.pop();
}
const publicCard = ({ popularity: _, role: _role, playShare: _share, ...card }: Entry): RankedInsightCard => card;
const counts = (codes: readonly number[], canonical: (code: number) => number) => {
  const result = new Map<number, number>();
  for (const code of codes) { const id = canonical(code); result.set(id, (result.get(id) ?? 0) + 1); }
  return result;
};
const sorted = (codes: readonly number[], canonical: (code: number) => number) => codes.map(canonical).sort((a, b) => a - b);

/** One streaming scan with bounded proof queues and a compact legal stat histogram. */
export function suggestDeckRows(db: Database.Database, catalog: InsightCatalog, deck: DuelDeck, opts: DeckSuggestionOptions, dataDirectory?: string): DeckSuggestionResult {
  const canonical = (code: number) => catalog.canonical(code);
  const master = opts.deckMaster ?? deck.deckMaster;
  const revision = (db.prepare("SELECT revision FROM card_catalog_revision WHERE id=1").get() as { revision: number }).revision;
  const pointsRevision = (db.prepare("SELECT revision FROM genesys_points_meta WHERE id=1").get() as { revision: string } | undefined)?.revision;
  const usage = formatStaples(opts.format, opts.banlist, db, opts.guildId);
  const version = `suggestions-4:${usage.version}:${revision}:${pointsRevision ?? ""}:${opts.legality?.version ?? "no-admission"}`;
  let cache: Map<string, string> | undefined, key: string | undefined;
  if (opts.cache !== false) {
    key = hash({ main: sorted(deck.main, canonical), extra: sorted(deck.extra, canonical), side: sorted(deck.side, canonical), master: master && canonical(master),
      format: opts.format, pool: opts.pool && sorted(opts.pool, canonical), exclude: opts.exclude && sorted(opts.exclude, canonical), banlist: opts.banlist,
      remaining: opts.genesysRemaining, released: opts.released, version, dataDirectory });
    cache = caches.get(db);
    if (!cache) { cache = new Map(); caches.set(db, cache); }
    const found = cache.get(key);
    if (found) { cache.delete(key); cache.set(key, found); return JSON.parse(found) as DeckSuggestionResult; }
  }
  const rows: DeckSuggestionRow[] = ["archetype", "outside", "extra", "staples"].map(id => ({ id: id as DeckSuggestionRow["id"], cards: [], state: "ready" }));
  if (deck.main.length < 40) Object.assign(rows[2]!, { state: "hint", hint: "Add 40 Main Deck cards.", minimumMainCards: 40, mainCards: deck.main.length });
  const result = { rows, version };
  if (!opts.legality || !deck.main.length || opts.pool?.length === 0) return result;
  const scope = opts.legality;
  const admitted = new Set(scope.allowed);
  const owned = counts([...deck.main, ...deck.extra, ...deck.side, ...(master ? [master] : [])], canonical);
  const group = (code: number) => scope.copyGroups?.[code] ?? code;
  const held = new Map<number, number>();
  for (const [code, count] of owned) held.set(group(code), (held.get(group(code)) ?? 0) + count);
  const pool = opts.pool && counts(opts.pool, canonical), excluded = new Set(opts.exclude?.map(canonical));
  const main = deck.main.flatMap(code => { const card = catalog.candidate(code); return card ? [card] : []; });
  const core = deckSuggestionCore(main);
  const rowCore = deckSuggestionCore(main, true);
  const supportMain = core.anchors;
  const extraCards = deck.extra.flatMap(code => { const card = catalog.candidate(code); return card ? [card] : []; });
  const supportContext = deckSupportContext(supportMain, extraCards, core.archetypes);
  const rankArchetype = archetypeDeckRanking(main, rowCore.archetypes, supportContext);
  const evaluateOutside = outsideUtilityEvaluator(supportContext, usage, core.archetypes);
  const selectivity = utilitySelectivity();
  const queues = new Map<string, Entry[]>();
  const archetypes = rowCore.archetypes;
  const ranked = rows.map(() => [] as Entry[]);
  const genericExtra: Entry[] = [];
  const rankExtra = extraDeckRanking(main, archetypes, extraCards);
  const canSummon = createMainDeckSummonChecker(main);
  const canSummonWithCore = createMainDeckSummonChecker(core.anchors);
  const genesys = opts.format.startsWith("genesys"), singleton = opts.format.endsWith("domain");
  let remaining = Infinity;
  if (genesys) {
    let used = 0;
    for (const [code, count] of owned) {
      const points = catalog.candidate(code)?.card.genesysPoints;
      if (points === undefined) { used = Infinity; break; }
      used += points * count;
    }
    remaining = Math.min(opts.genesysRemaining ?? DEFAULT_GENESYS_POINT_CAP - used, MAX_GENESYS_POINT_CAP - used);
  }
  for (const candidate of catalog.suggestionCandidates()) {
    const { card, tags } = candidate, id = card.id, heldCount = held.get(group(id)) ?? 0;
    if (admitted.has(id) && (scope.limits[id] ?? 3) > 0) selectivity.observe(candidate);
    // Empty-search Suggestions propose new cards; all artworks share the same identity.
    if (!admitted.has(id) || owned.has(id) || excluded.has(id) || heldCount >= (scope.limits[id] ?? (singleton ? 1 : 3))
      || (pool && (pool.get(id) ?? 0) <= (owned.get(id) ?? 0)) || !matchesReleased(card, opts.released)) continue;
    if (genesys && (isBarredFromGenesys(card) || card.genesysPoints === undefined || card.genesysPoints > remaining)) continue;
    const family = catalog.suggestionFamily(candidate);
    if (family !== id && admitted.has(family)) continue;
    const extra = isExtraDeckCard(card);
    const item = (score: number, reason: string, linkedCards = 0): Entry => ({ passcode: id, name: card.name, score, linkedCards,
      reason: shortReason(reason.replace(/[\r\n]+/g, " ")), popularity: card.views, release: cardReleaseInfo(card),
      ...(singleton && master ? { deckMasterFit: true } : {}) });
    if (extra) {
      if (deck.main.length < 40) continue;
      const fit = rankExtra(candidate);
      const queue = fit.generic ? genericExtra : ranked[2]!, capacity = fit.generic ? 3 : 12;
      // Retained entries already have complete summon proofs. A candidate that
      // cannot outrank their worst entry cannot change the row; avoid its solver.
      if (queue.length === capacity && compare({ score: fit.score, popularity: card.views, passcode: id }, queue.at(-1)!) >= 0) continue;
      // A proof using the strategy core also proves the full Main Deck subset.
      const summon = (fit.generic ? canSummonWithCore : canSummon)(candidate);
      if (summon) retain(queue, item(fit.score, summon, fit.linkedCards), capacity);
      continue;
    }
    const played = usage.cards.get(id);
    if (played) {
      if (viableSuggestionStaple(candidate, extraCards, main)) retain(ranked[3]!, item(played.playShare, suggestionStapleReason(candidate, played, usage.label)), 18);
      continue;
    }
    const archetype = rankArchetype(candidate);
    if (archetype.rank) {
      const fit = archetype.rank;
      retain(ranked[0]!, item(fit.score, fit.reason, fit.linkedCards)); continue;
    }
    if (archetype.claimed) continue;
    const staple = tags?.roles.find(role => role === "hand_trap" || role === "board_breaker" || role === "negation");
    if (!usage.cards.size && staple) {
      if (viableSuggestionStaple(candidate, extraCards, main)) retain(ranked[3]!, item(1, suggestionStapleReason(candidate, undefined, usage.label)), 18);
      continue;
    }
    const support = evaluateOutside(candidate);
    if (!support) continue;
    const supported = item(support.score, support.reason, support.linkedCards);
    supported.role = support.role; supported.playShare = support.playShare;
    // Restriction shapes, rather than catalog size, bound retained candidates.
    if (queues.size >= 256 && support.selectivity) continue;
    const key = selectivity.key(support.selectivity);
    const queue = queues.get(key) ?? [];
    retain(queue, supported); queues.set(key, queue);
  }
  for (const [key, queue] of queues) if (selectivity.accepts(key, supportContext)) for (const entry of queue) retain(ranked[1]!, entry);
  rows[1]!.cards = ranked[1]!.map(publicCard);
  ranked[2]!.push(...genericExtra.slice(0, 12 - ranked[2]!.length));
  for (const at of [0, 2, 3]) rows[at]!.cards = ranked[at]!.map(publicCard);
  // Staples may occupy at most a quarter of the visible suggestions.
  rows[3]!.cards = rows[3]!.cards.slice(0, Math.min(6, Math.floor(rows.slice(0, 3).reduce((n, row) => n + row.cards.length, 0) / 3)));
  if (cache && key) {
    cache.set(key, JSON.stringify(result));
    while (cache.size > 64) cache.delete(cache.keys().next().value!);
  }
  return result;
}
