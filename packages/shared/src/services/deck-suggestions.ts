import { createHash } from "node:crypto";
import type Database from "better-sqlite3";
import type { DuelDeck } from "../duels/index.js";
import { isExtraDeckCard, isBarredFromGenesys } from "../cards/effects/card.js";
import { belongsTo, type Candidate, type RankedInsightCard } from "../cards/effects/synergy.js";
import { compactEffectName } from "../cards/effects/name-match.js";
import { shortReason } from "../cards/effects/search-reasons.js";
import { matchesReleased, cardReleaseInfo } from "../cards/effects/releases.js";
import { createMainDeckSummonChecker } from "../cards/effects/deck-summon.js";
import type { CardInsightOptions, CardInsightFormat } from "./card-insights.js";
import type { InsightCatalog } from "./card-insight-catalog.js";
import { readInsightProfiles } from "./card-insight-profiles.js";
import { deckSuggestionCore, deckSuggestionHooks, deckSupportContext, scoreDeckSupport, prepareSuggestionHookMatching } from "./deck-suggestion-hooks.js";
import { extraDeckRanking } from "./deck-suggestion-extra.js";

export interface DeckSuggestionLegality {
  allowed: readonly number[];
  limits: Readonly<Record<number, number>>;
  copyGroups?: Readonly<Record<number, number>>;
  version: string;
}
export interface DeckSuggestionOptions extends CardInsightOptions {
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
type Entry = RankedInsightCard & { popularity: number };
const compare = (a: Entry, b: Entry) => b.score - a.score || b.popularity - a.popularity || a.passcode - b.passcode;
function retain(list: Entry[], item: Entry, limit = 12) {
  if (list.length === limit && compare(item, list[list.length - 1]!) >= 0) return;
  list.push(item); list.sort(compare); if (list.length > limit) list.pop();
}
const publicCard = ({ popularity: _, ...card }: Entry): RankedInsightCard => card;
const counts = (codes: readonly number[], canonical: (code: number) => number) => {
  const result = new Map<number, number>();
  for (const code of codes) { const id = canonical(code); result.set(id, (result.get(id) ?? 0) + 1); }
  return result;
};
const sorted = (codes: readonly number[], canonical: (code: number) => number) => codes.map(canonical).sort((a, b) => a - b);

/** One streaming scan; only bounded hook queues and the four result rows survive it. */
export function suggestDeckRows(db: Database.Database, catalog: InsightCatalog, deck: DuelDeck, opts: DeckSuggestionOptions, dataDirectory?: string): DeckSuggestionResult {
  const canonical = (code: number) => catalog.canonical(code);
  const master = opts.deckMaster ?? deck.deckMaster;
  const revision = (db.prepare("SELECT revision FROM card_catalog_revision WHERE id=1").get() as { revision: number }).revision;
  const pointsRevision = (db.prepare("SELECT revision FROM genesys_points_meta WHERE id=1").get() as { revision: string } | undefined)?.revision;
  const version = `suggestions-1:${revision}:${pointsRevision ?? ""}:${opts.legality?.version ?? "no-admission"}`;
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
  const anchors = [...new Map(main.map(card => [card.card.id, card])).values()];
  const core = deckSuggestionCore(main);
  const supportMain = core.anchors;
  const extraCards = deck.extra.flatMap(code => { const card = catalog.candidate(code); return card ? [card] : []; });
  const profiles = readInsightProfiles(db, core.anchors.filter(({ card }) => card.archetype && core.archetypes.includes(card.archetype)));
  const hooks = deckSuggestionHooks(main, profiles, extraCards);
  const supportContext = deckSupportContext(supportMain, extraCards, core.archetypes);
  const matchingHooks = prepareSuggestionHookMatching(hooks, supportMain, extraCards);
  const queues = hooks.map(() => [] as Entry[]), matches = hooks.map(() => 0);
  const multi: Array<{ entry: Entry; hooks: number[] }> = [];
  const archetypes = core.archetypes;
  const names = new Set(anchors.map(({ card }) => compactEffectName(card.name)));
  const ranked = rows.map(() => [] as Entry[]);
  const genericExtra: Entry[] = [];
  const rankExtra = extraDeckRanking(main, archetypes, extraCards);
  const canSummon = createMainDeckSummonChecker(main);
  const canSummonWithCore = createMainDeckSummonChecker(core.anchors);
  const genesys = opts.format.startsWith("genesys"), singleton = opts.format.endsWith("domain");
  let remaining = opts.genesysRemaining ?? 100;
  if (genesys) {
    let used = 0;
    for (const [code, count] of owned) {
      const points = catalog.candidate(code)?.card.genesysPoints;
      if (points === undefined) { used = Infinity; break; }
      used += points * count;
    }
    remaining = Math.min(remaining, 100 - used);
  }
  let scanned = 0;
  for (const candidate of catalog.suggestionCandidates()) {
    scanned++;
    const fits = matchingHooks(candidate);
    for (const at of fits) matches[at]!++;
    const { card, tags } = candidate, id = card.id, heldCount = held.get(group(id)) ?? 0;
    // Empty-search Suggestions propose new cards; all artworks share the same identity.
    if (!admitted.has(id) || owned.has(id) || excluded.has(id) || heldCount >= (scope.limits[id] ?? (singleton ? 1 : 3))
      || (pool && (pool.get(id) ?? 0) <= (owned.get(id) ?? 0)) || !matchesReleased(card, opts.released)) continue;
    if (genesys && (isBarredFromGenesys(card) || card.genesysPoints === undefined || card.genesysPoints > remaining)) continue;
    const extra = isExtraDeckCard(card);
    const summon = extra && deck.main.length >= 40 ? canSummon(candidate) : undefined;
    if (extra && !summon) continue;
    const item = (score: number, reason: string, linkedCards = 0): Entry => ({ passcode: id, name: card.name, score, linkedCards,
      reason: shortReason(reason.replace(/[\r\n]+/g, " ")), popularity: card.views, release: cardReleaseInfo(card),
      ...(singleton && master ? { deckMasterFit: true } : {}) });
    if (extra) {
      const fit = rankExtra(candidate);
      if (fit.generic) {
        // A pile of hand traps cannot justify an off-profile Link or Rank.
        const coreSummon = canSummonWithCore(candidate);
        if (coreSummon) retain(genericExtra, item(fit.score, coreSummon, fit.linkedCards), 3);
      } else retain(ranked[2]!, item(fit.score, summon!, fit.linkedCards));
      continue;
    }
    const member = archetypes.find(archetype => belongsTo(card, archetype));
    let named: string | undefined;
    for (const name of tags?.supports.names ?? []) {
      if (names.has(compactEffectName(name))) { named = name; break; }
    }
    if (named === undefined && (card.text.includes('"') || card.text.includes("“"))) {
      for (const match of card.text.matchAll(/["“]([^"”]+)["”]/g)) {
        if (names.has(compactEffectName(match[1]!))) { named = match[1]!; break; }
      }
    }
    if (member || named) { retain(ranked[0]!, item(named ? 12 : 5, named ? `Names ${named}` : `Supports ${member}`, 1)); continue; }
    const staple = tags?.roles.find(role => role === "hand_trap" || role === "board_breaker" || role === "negation");
    if (staple) retain(ranked[3]!, item(1, tags?.summary || `Adds ${staple.replaceAll("_", " ")}`), 18);
    if (!fits.length || tags?.roles.includes("hand_trap")) continue;
    const support = scoreDeckSupport(candidate, supportContext);
    if (!support) continue;
    const supported = item(support.score, support.reason, support.linkedCards);
    for (const at of fits) retain(queues[at]!, supported);
    if (fits.length) {
      multi.push({ entry: supported, hooks: fits });
      multi.sort((a, b) => compare(a.entry, b.entry)); if (multi.length > 12) multi.pop();
    }
  }
  // Use the complete catalog as the common-hook denominator, also for a small draft pool.
  const catalogSize = scanned;
  const usable = matches.map(n => n > 0 && n <= catalogSize * 0.05);
  const chosen = new Set<number>();
  const addOutside = (entry: Entry) => { if (rows[1]!.cards.length < 12 && !chosen.has(entry.passcode)) { chosen.add(entry.passcode); rows[1]!.cards.push(publicCard(entry)); } };
  for (const match of multi) if (match.hooks.some(at => usable[at])) addOutside(match.entry);
  for (let turn = 0; turn < 12; turn++) queues.forEach((queue, at) => { if (usable[at] && queue[turn]) addOutside(queue[turn]!); });
  ranked[2]!.push(...genericExtra.slice(0, 12 - ranked[2]!.length));
  for (const at of [0, 2, 3]) rows[at]!.cards = ranked[at]!.map(publicCard);
  // Staples may occupy at most a quarter of the visible suggestions.
  rows[3]!.cards = rows[3]!.cards.filter(card => !chosen.has(card.passcode)).slice(0, Math.min(6, Math.floor(rows.slice(0, 3).reduce((n, row) => n + row.cards.length, 0) / 3)));
  if (cache && key) {
    cache.set(key, JSON.stringify(result));
    while (cache.size > 64) cache.delete(cache.keys().next().value!);
  }
  return result;
}
