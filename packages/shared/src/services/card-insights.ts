import { formatStaples, stapleReason } from "../cards/effects/staples.js";
import { cardEraBoost, deriveCardEra, matchesReleased, compareNewest, cardReleaseInfo, selectedReleaseDate, type ReleasedRange, type CardEra, type ReleaseDates } from "../cards/effects/releases.js";
import type Database from "better-sqlite3";
import type { DuelDeck } from "../duels/index.js";
import { isBarredFromGenesys, isExtraDeckCard } from "../cards/effects/card.js";
import { buildArchetypeMatcher, describe, interpret, omitReadingChips, type Interpretation } from "../cards/effects/query.js";
import { matchCard } from "../cards/effects/effect-match.js";
import { compactEffectName, resolveEffectName } from "../cards/effects/name-match.js";
import { belongsTo, cardSynergy, filterReachesCard, hookQuery, scoreForDeck, type Candidate, type RankedInsightCard } from "../cards/effects/synergy.js";
import { readingArchetypes, type ArchetypeGuide } from "../cards/effects/guide.js";
import { normalizeImportedCardName } from "./card-name-match.js";
import { cachedEffectReading, effectArchetypes } from "../cards/effects/reading-cache.js";
import { intentReading, searchIntentTarget, cardSimilarity, counterProfileFromHooks, counterLink } from "../cards/effects/search-intents.js";
import { effectMatchReason, softTextScore, shortReason } from "../cards/effects/search-reasons.js";
import { ArchetypeProfile } from "../cards/effects/synergy.js";
import { createInsightCatalog, type InsightCatalog } from "./card-insight-catalog.js";
import { readArchetypeGuide, readArchetypeHook, readInsightProfiles } from "./card-insight-profiles.js";
import { suggestDeckRows, type DeckSuggestionOptions, type DeckSuggestionLegality } from "./deck-suggestions.js";

export type CardInsightFormat = "normal" | "domain" | "genesys" | "genesys-domain";
export interface CardInsightOptions {
  released?: ReleasedRange;
  sort?: "match" | "newest";
  era?: CardEra;
  limit?: number;
  format?: CardInsightFormat;
  genesysRemaining?: number;
  exact?: boolean;
  omittedChips?: readonly string[];
  deckMaster?: number;
  /** Server-only context for deterministic outside-archetype search. */
  suggestionContext?: { deck?: DuelDeck; legality: DeckSuggestionLegality; banlist?: string; exclude?: readonly number[] };
}
export interface CardInsightSummary {
  passcode: number;
  summary: string;
  roles: string[];
  source: string;
  textHash: string | null;
  taggedAt: string;
}
export interface CardEffectSearchResult {
  reading: Interpretation | null;
  /** "How it plays" for the archetype the reading names, on the first page only. */
  guide?: ArchetypeGuide;
  cards: RankedInsightCard[];
  total: number;
  relax?: Array<{ chip: string; count: number }>;
}
export interface CardPoolHealth {
  /** Distinct canonical cards, including unknown passcodes. */
  cards: number;
  roles: { searchers: number; extenders: number; removal: number; handTraps: number };
  extraDeck: { synchro: number; tuners: number; nonTuners: number; fusion: number; xyz: number; link: number; fusionEnablers: number; linkMaterialMonsters: number; xyzLevels: Record<string, number> };
  unlinkedPasscodes: number[];
  untaggedPasscodes: number[];
  era?: CardEra;
  warnings: string[];
}

export interface CardPickInsight {
  passcode: number;
  score: number;
  reason?: string;
}

type Retained = RankedInsightCard & { popularity: number; releaseDates: ReleaseDates };
const compare = (a: Retained, b: Retained) => b.linkedCards - a.linkedCards || b.score - a.score || b.popularity - a.popularity || a.passcode - b.passcode;
const limitOf = (value?: number) => Math.max(1, Math.min(120, Number.isFinite(value) ? Math.floor(value!) : 30));
const domain = (format?: CardInsightFormat) => format === "domain" || format === "genesys-domain";
const allowed = ({ card }: Candidate, options: CardInsightOptions) => {
  if (!matchesReleased(card, options.released)) return false;
  if (options.format !== "genesys" && options.format !== "genesys-domain") return true;
  return !isBarredFromGenesys(card) && card.genesysPoints !== undefined && card.genesysPoints <= (options.genesysRemaining ?? Infinity);
};
const retain = (ranked: Retained[], result: RankedInsightCard, candidate: Candidate, limit: number, opts: CardInsightOptions = {}) => {
  const comparePage = (a: Retained, b: Retained) => (opts.sort === "newest" ? compareNewest(a.releaseDates, b.releaseDates, opts.released?.region) : 0) || compare(a, b);
  const entry = { ...result, release: cardReleaseInfo(candidate.card, opts.released?.region), popularity: candidate.card.views, releaseDates: candidate.card };
  if (ranked.length === limit && comparePage(entry, ranked[ranked.length - 1]!) >= 0) return;
  ranked.push(entry); ranked.sort(comparePage);
  if (ranked.length > limit) ranked.pop();
};
const withoutPopularity = (ranked: Retained[]) => ranked.map(({ popularity: _popularity, releaseDates: _releaseDates, ...card }) => card);
const codesOf = (deck: DuelDeck | readonly number[]): readonly number[] => Array.isArray(deck) ? deck : [...(deck as DuelDeck).main, ...(deck as DuelDeck).extra, ...(deck as DuelDeck).side];
const synergyTarget = (text: string) => text.trim().match(/^(?:cards?\s+that\s+)?(?:works?\s+(?:well\s+)?with|synerg(?:y|ies|izes?)\s+(?:with|for)|partners?\s+for)\s+(.+?)\s*[?.!]?$/i)?.[1];

/** SQL-backed, read-only insights. Only anchors, their profiles and the retained page live in memory. */
export function createCardInsightService(db: Database.Database, options: {
  dataDirectory?: string;
  /** Borrowed for this operation; its caller owns closing it. */
  catalog?: InsightCatalog;
} = {}) {
  const withCatalog = <T>(read: (catalog: InsightCatalog) => T): T => {
    if (options.catalog) return read(options.catalog);
    const catalog = createInsightCatalog(db, options.dataDirectory);
    try { return read(catalog); } finally { catalog.close(); }
  };
  const archetypeMatcher = () => {
    const names = new Set<string>();
    for (const row of db.prepare<[], { name: string }>(`SELECT name FROM archetypes UNION SELECT archetype AS name FROM card_tag_profiles UNION SELECT DISTINCT archetype AS name FROM card_catalog WHERE archetype IS NOT NULL`).iterate()) names.add(row.name);
    return buildArchetypeMatcher(names);
  };
  const resolveTarget = (text: string): number | undefined => {
    let best: { name: string; passcode: number } | undefined;
    for (const row of db.prepare<[], { name: string; passcode: number }>(`SELECT name,ygoprodeck_id AS passcode FROM card_catalog WHERE NOT EXISTS(SELECT 1 FROM card_artworks a WHERE a.artwork_id=card_catalog.ygoprodeck_id AND a.card_id<>a.artwork_id) ORDER BY ygoprodeck_id`).iterate()) {
      if (compactEffectName(row.name) === compactEffectName(text)) return row.passcode;
      best = resolveEffectName(best ? [best, row] : [row], text);
    }
    return best?.passcode;
  };
  const readQuery = (text: string): Interpretation | null => {
    const matcher = archetypeMatcher();
    const target = synergyTarget(text);
    const intent = intentReading(text, name => {
      const id = resolveTarget(name);
      const card = id === undefined ? undefined : db.prepare<[number], { name: string }>("SELECT name FROM card_catalog WHERE ygoprodeck_id=?").get(id);
      return card && id !== undefined ? { id, name: card.name } : undefined;
    }, name => resolveEffectName([...effectArchetypes(db)].map(name => ({ name })), name)?.name);
    if (intent) return intent;
    if (searchIntentTarget(text)?.kind === "outside") return null;
    const cached = cachedEffectReading(db, text);
    if (cached) return cached;
    if (!target) return interpret(text, matcher);
    const named = resolveTarget(target);
    const name = named === undefined ? undefined : (db.prepare("SELECT name FROM card_catalog WHERE ygoprodeck_id=?").get(named) as { name: string } | undefined)?.name;
    if (!name) return interpret(`${target} support`, matcher);
    const query = { card: { kinds: [], subtypes: [], types: [], attributes: [], archetypes: [] }, roles: [], quick: false, text: "", supports: { kinds: [], subtypes: [], types: [], attributes: [], archetypes: [name] } };
    return { query, chips: describe(query) };
  };
  const rank = (catalog: InsightCatalog, deck: readonly Candidate[], pool: readonly number[] | undefined, opts: CardInsightOptions): { cards: RankedInsightCard[]; total: number } => {
    if (!deck.length) return { cards: [], total: 0 };
    const owned = new Set(deck.map(candidate => candidate.card.id));
    const master = domain(opts.format) && opts.deckMaster !== undefined ? catalog.candidate(opts.deckMaster) : undefined;
    if (master) owned.add(master.card.id);
    const profiles = readInsightProfiles(db, deck), ranked: Retained[] = [];
    let total = 0;
    for (const candidate of catalog.candidates(pool)) {
      if (owned.has(candidate.card.id) || !allowed(candidate, opts)) continue;
      const result = scoreForDeck(candidate, deck, profiles);
      if (result.score <= 0) continue;
      result.score += cardEraBoost(candidate.card, opts.era);
      total++;
      if (master) result.deckMasterFit = cardSynergy(master, candidate).score > 0;
      retain(ranked, result, candidate, limitOf(opts.limit), opts);
    }
    return { cards: withoutPopularity(ranked), total };
  };

  // Batch a pack against one pool/profile snapshot; do not reopen the engine per choice.
  const pickScores = (passcodes: readonly number[], pickedPool: readonly number[]): CardPickInsight[] => withCatalog(catalog => {
    const deck = [...catalog.candidates(pickedPool)], profiles = readInsightProfiles(db, deck);
    const owned = new Set(deck.map(anchor => anchor.card.id));
    const present = new Set<string>(deck.flatMap(anchor => anchor.tags?.roles ?? []));
    return passcodes.map(passcode => {
      const candidate = catalog.candidate(passcode);
      if (!candidate || owned.has(candidate.card.id)) return { passcode, score: 0 };
      const ranked = scoreForDeck(candidate, deck, profiles);
      const missing = deck.length ? ["searcher", "extender", "removal", "hand_trap"].filter(role => candidate.tags?.roles.some(value => value === role) && !present.has(role)) : [];
      const reason = ranked.reason || (missing.length ? `Adds ${missing.map(role => role.replaceAll("_", " ")).join(" and ")} to your pool` : "");
      return { passcode, score: ranked.score + missing.length, ...(reason ? { reason } : {}) };
    });
  });

  const searchEffects = (text: string, pool: readonly number[] | undefined, opts: CardInsightOptions): CardEffectSearchResult => {
      if (opts.exact) return withCatalog(catalog => {
        const literal = text.trim().toLowerCase(), ranked: Retained[] = [];
        const master = domain(opts.format) && opts.deckMaster !== undefined ? catalog.candidate(opts.deckMaster) : undefined;
        let total = 0;
        if (literal) for (const candidate of catalog.candidates(pool)) {
          if (!allowed(candidate, opts) || !`${candidate.card.pendulumText ?? ""}\n${candidate.card.text}`.toLowerCase().includes(literal)) continue;
          total++;
          retain(ranked, { passcode: candidate.card.id, name: candidate.card.name, score: 0, linkedCards: 0, reason: shortReason(`Text: ${text.trim()}`),
            ...(master ? { deckMasterFit: cardSynergy(master, candidate).score > 0 } : {}) }, candidate, limitOf(opts.limit), opts);
        }
        return { reading: null, cards: withoutPopularity(ranked), total };
      });
      const initial = readQuery(text);
      const reading = initial?.query.intent?.kind === "outside" ? initial : initial ? omitReadingChips(initial, opts.omittedChips) : null;
      if (!reading || pool?.length === 0) return { reading, cards: [], total: 0, relax: [] };
      const target = cachedEffectReading(db, text) ? undefined : synergyTarget(text), anchor = target && !opts.omittedChips?.includes(initial!.chips[0]!) ? resolveTarget(target) : undefined;
      const effective = { ...opts, sort: opts.sort ?? reading.query.sort,
        released: { ...opts.released, region: opts.released?.region ?? reading.query.released?.region } };
      return withCatalog(catalog => {
        if (reading.query.intent?.kind === "outside") {
          const archetype = reading.query.intent.archetype;
          const inferredMain: number[] = [];
          if (!opts.suggestionContext?.deck) for (const { card } of catalog.suggestionCandidates()) {
            if (card.kind !== "monster" || isExtraDeckCard(card) || !belongsTo(card, archetype)) continue;
            inferredMain.push(card.id);
            if (inferredMain.length === 60) break;
          }
          const deck = opts.suggestionContext?.deck ?? { main: inferredMain, extra: [], side: [] };
          const rows = suggestDeckRows(db, catalog, deck, { ...opts, ...opts.suggestionContext, format: opts.format ?? "normal", pool }, options.dataDirectory);
          const cards = rows.rows[1]!.cards;
          return { reading, cards, total: cards.length };
        }
        if (anchor !== undefined) {
          const candidate = catalog.candidate(anchor);
          return { reading, ...rank(catalog, candidate ? [candidate] : [], pool, effective) };
        }
        const ranked: Retained[] = [];
        const staples = formatStaples(opts.format, opts.suggestionContext?.banlist, db);
        const similar = reading.query.intent?.kind === "similar" ? catalog.candidate(reading.query.intent.passcode) : undefined;
        const archetype = reading.query.intent?.kind === "counters" ? reading.query.intent.archetype : undefined;
        const row = archetype ? db.prepare<[string], { plan: string; hooks_json: string }>("SELECT plan,hooks_json FROM card_tag_profiles WHERE archetype=? COLLATE NOCASE").get(archetype) : undefined;
        let counter: ReturnType<typeof counterProfileFromHooks> | undefined;
        try { if (row) counter = counterProfileFromHooks(ArchetypeProfile.parse({ plan: row.plan, hooks: JSON.parse(row.hooks_json) })); } catch { /* Optional profile: fail closed. */ }
        const match = (candidate: Candidate, query = reading.query): number | null => {
          if (query.intent?.kind === "staples") return staples.cards.size ? staples.cards.get(candidate.card.id)?.playShare ?? null
            : candidate.tags?.roles.some(role => ["hand_trap", "board_breaker", "negation"].includes(role)) ? 1 : null;
          const base = matchCard(candidate.card, candidate.tags, query);
          if (base === null) return null;
          if (query.intent?.kind === "similar") return similar ? cardSimilarity(similar, candidate) : null;
          if (query.intent?.kind === "counters") return counter && archetype ? counterLink(counter, archetype, candidate)?.score ?? null : null;
          return base + softTextScore(candidate.card, query.text);
        };
        const master = domain(opts.format) && opts.deckMaster !== undefined ? catalog.candidate(opts.deckMaster) : undefined;
        let total = 0;
        for (const candidate of catalog.candidates(pool)) {
          if (!allowed(candidate, opts)) continue;
          const score = match(candidate);
          if (score === null) continue;
          total++;
          retain(ranked, { passcode: candidate.card.id, name: candidate.card.name, score: score + cardEraBoost(candidate.card, opts.era), linkedCards: 0, reason: reading.query.intent?.kind === "staples" && staples.cards.size ? stapleReason(staples.cards.get(candidate.card.id)!, staples.label) : counter && archetype ? counterLink(counter, archetype, candidate)!.reason
            : similar ? shortReason(`Similar ${candidate.tags?.roles.find(role => similar.tags?.roles.includes(role))?.replaceAll("_", " ") ?? "effects"} to ${similar.card.name}`)
            : effectMatchReason(candidate.card, candidate.tags, reading.query, candidate.tags?.summary),
            ...(master ? { deckMasterFit: cardSynergy(master, candidate).score > 0 } : {}) }, candidate, limitOf(opts.limit), effective);
        }
        const relax: Array<{ chip: string; count: number }> = [];
        if (!total) {
          for (const chip of reading.chips) {
            if (chip.startsWith("Text:") || chip.startsWith("Sort:")) continue;
            const query = omitReadingChips(reading, [chip])!.query;
            let count = 0;
            for (const candidate of catalog.candidates(pool)) if (allowed(candidate, opts) && match(candidate, query) !== null) count++;
            if (count) relax.push({ chip, count });
          }
          relax.sort((a, b) => b.count - a.count || a.chip.localeCompare(b.chip, "en"));
        }
        return { reading, cards: withoutPopularity(ranked), total, relax: relax.slice(0, 2) };
      });
  };

  return {
    summary(passcode: number): CardInsightSummary | null {
      return withCatalog(catalog => {
        const canonical = catalog.canonical(passcode);
        const row = db.prepare("SELECT summary,roles_json,source,text_hash,tagged_at FROM card_tags WHERE passcode=?").get(canonical) as { summary: string; roles_json: string; source: string; text_hash: string | null; tagged_at: string } | undefined;
        return row ? { passcode: canonical, summary: row.summary, roles: JSON.parse(row.roles_json) as string[], source: row.source, textHash: row.text_hash, taggedAt: row.tagged_at } : null;
      });
    },
    readQuery,
    effectSearch(text: string, pool?: readonly number[], opts: CardInsightOptions = {}): CardEffectSearchResult {
      const result = searchEffects(text, pool, opts);
      const guide = result.reading ? readArchetypeGuide(db, readingArchetypes(result.reading)) : null;
      return guide ? { ...result, guide } : result;
    },
    /** Cards outside an archetype that fit one hook of its "How it plays" panel. */
    hookSearch(archetype: string, hookIndex: number, pool?: readonly number[], opts: CardInsightOptions = {}): RankedInsightCard[] {
      const found = readArchetypeHook(db, archetype, hookIndex);
      if (!found || pool?.length === 0) return [];
      const query = hookQuery(found.hook, found.archetype), phrases = found.hook.phrases.map(phrase => phrase.toLowerCase());
      const ranked: Retained[] = [], limit = limitOf(opts.limit);
      return withCatalog(catalog => {
        const master = domain(opts.format) && opts.deckMaster !== undefined ? catalog.candidate(opts.deckMaster) : undefined;
        for (const candidate of catalog.candidates(pool)) {
          const { card } = candidate;
          if (!allowed(candidate, opts) || belongsTo(card, found.archetype)) continue;
          const printed = `${card.pendulumText ?? ""}\n${card.text}`.toLowerCase();
          if (!phrases.every(phrase => printed.includes(phrase))) continue;
          const score = matchCard(card, candidate.tags, query);
          if (score === null) continue;
          retain(ranked, { passcode: card.id, name: card.name, score: score + cardEraBoost(card, opts.era), linkedCards: 0, reason: found.hook.label,
            ...(master ? { deckMasterFit: cardSynergy(master, candidate).score > 0 } : {}) }, candidate, limit, opts);
        }
        return withoutPopularity(ranked);
      });
    },
    worksWith(passcode: number, pool?: readonly number[], opts: CardInsightOptions = {}): RankedInsightCard[] {
      if (pool?.length === 0) return [];
      return withCatalog(catalog => { const anchor = catalog.candidate(passcode); return rank(catalog, anchor ? [anchor] : [], pool, opts).cards; });
    },
    suggestForDeck(deck: DuelDeck | readonly number[], opts: CardInsightOptions & { pool?: readonly number[]; format: CardInsightFormat }): RankedInsightCard[] {
      if (opts.pool?.length === 0) return [];
      return withCatalog(catalog => {
        const anchors = [...catalog.candidates(codesOf(deck))];
        const master = opts.deckMaster ?? (!Array.isArray(deck) ? (deck as DuelDeck).deckMaster : undefined);
        return rank(catalog, anchors, opts.pool, { ...opts, deckMaster: master }).cards;
      });
    },
    suggestRows(deck: DuelDeck, opts: DeckSuggestionOptions) {
      return withCatalog(catalog => suggestDeckRows(db, catalog, deck, opts, options.dataDirectory));
    },
    poolHealth(codes: readonly number[], opts: { era?: CardEra } = {}): CardPoolHealth {
      return withCatalog(catalog => {
        const canonical = [...new Set(codes.map(catalog.canonical))].sort((a, b) => a - b);
        const candidates = [...catalog.candidates(canonical)], known = new Map(candidates.map(candidate => [candidate.card.id, candidate]));
        const health: CardPoolHealth = { cards: canonical.length, roles: { searchers: 0, extenders: 0, removal: 0, handTraps: 0 }, extraDeck: { synchro: 0, tuners: 0, nonTuners: 0, fusion: 0, xyz: 0, link: 0, fusionEnablers: 0, linkMaterialMonsters: 0, xyzLevels: {} }, unlinkedPasscodes: [], untaggedPasscodes: [], warnings: [] };
        health.era = opts.era ?? deriveCardEra(candidates.map(candidate => candidate.card));
        if (health.era) {
          const threshold = health.era.medianYear + Math.max(5, health.era.spread * 2);
          const newer = candidates.filter(({ card }) => { const date = selectedReleaseDate(card); return date && Number(date.slice(0, 4)) > threshold; }).length;
          if (newer) health.warnings.push(`${newer} ${newer === 1 ? "card is" : "cards are"} much newer than the rest of this cube.`);
        }
        const main = candidates.filter(({ card }) => card.kind === "monster" && !isExtraDeckCard(card));
        for (const code of canonical) {
          const candidate = known.get(code);
          if (!candidate?.tags) health.untaggedPasscodes.push(code);
          if (!candidate || !candidates.some(other => other.card.id !== code && cardSynergy(candidate, other).score > 0)) health.unlinkedPasscodes.push(code);
        }
        for (const { card, tags } of candidates) {
          if (tags?.roles.includes("searcher")) health.roles.searchers++;
          if (tags?.roles.includes("extender")) health.roles.extenders++;
          if (tags?.roles.includes("removal")) health.roles.removal++;
          if (tags?.roles.includes("hand_trap")) health.roles.handTraps++;
          for (const subtype of ["synchro", "fusion", "xyz", "link"] as const) if (card.subtypes.includes(subtype)) health.extraDeck[subtype]++;
          if (tags?.effects.some(effect => effect.actions.some(event => event.verb === "fusion_summon"))) health.extraDeck.fusionEnablers++;
          if (card.kind === "monster" && !isExtraDeckCard(card)) {
            health.extraDeck[card.subtypes.includes("tuner") ? "tuners" : "nonTuners"]++;
            health.extraDeck.linkMaterialMonsters++;
            if (card.level !== undefined) health.extraDeck.xyzLevels[card.level] = (health.extraDeck.xyzLevels[card.level] ?? 0) + 1;
          }
        }
        if (health.cards) {
          if (!health.roles.searchers) health.warnings.push("No tagged searchers in this pool.");
          if (!health.roles.extenders) health.warnings.push("No tagged extenders in this pool.");
          if (!health.roles.removal) health.warnings.push("No tagged removal in this pool.");
          if (health.untaggedPasscodes.length) health.warnings.push(`${health.untaggedPasscodes.length} cards have no effect tags; health is incomplete.`);
          if (health.extraDeck.synchro && !health.extraDeck.tuners) health.warnings.push("Synchro monsters have no Main Deck Tuner supply.");
          if (health.extraDeck.synchro && !health.extraDeck.nonTuners) health.warnings.push("Synchro monsters have no Main Deck non-Tuner supply.");
          if (health.extraDeck.fusion && !health.extraDeck.fusionEnablers) health.warnings.push("Fusion monsters have no tagged Fusion Summon enabler.");
          for (const candidate of candidates.filter(({ card }) => isExtraDeckCard(card))) {
            if (candidate.tags?.materials.some(filter => !main.some(({ card }) => filterReachesCard(filter, card)))) health.warnings.push(`${candidate.card.name} has a material requirement without a matching Main Deck monster.`);
          }
        }
        return health;
      });
    },
    /** Public reason adapter; shares the bot policy and one catalog read per pack. */
    packFits(passcodes: readonly number[], pickedPool: readonly number[]): Map<number, string> {
      if (!passcodes.length || !pickedPool.length) return new Map();
      return new Map(pickScores(passcodes, pickedPool)
        .filter(insight => insight.score > 0 && insight.reason)
        .map(insight => [insight.passcode, insight.reason!]));
    },
    pickScore(passcode: number, pickedPool: readonly number[]): number {
      return pickScores([passcode], pickedPool)[0]!.score;
    },
    pickScores,
  };
}

export type CardInsightService = ReturnType<typeof createCardInsightService>;
