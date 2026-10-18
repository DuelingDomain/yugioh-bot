import type Database from "better-sqlite3";
import type { DuelDeck } from "../duels/index.js";
import { isBarredFromGenesys, isExtraDeckCard } from "../cards/effects/card.js";
import { buildArchetypeMatcher, describe, interpret, omitReadingChips, type Interpretation } from "../cards/effects/query.js";
import { matchCard } from "../cards/effects/effect-match.js";
import { compactEffectName, resolveEffectName } from "../cards/effects/name-match.js";
import { cardSynergy, filterReachesCard, scoreForDeck, type Candidate, type RankedInsightCard } from "../cards/effects/synergy.js";
import { normalizeImportedCardName } from "./card-name-match.js";
import { createInsightCatalog, type InsightCatalog } from "./card-insight-catalog.js";
import { readInsightProfiles } from "./card-insight-profiles.js";

export type CardInsightFormat = "normal" | "domain" | "genesys" | "genesys-domain";
export interface CardInsightOptions {
  limit?: number;
  format?: CardInsightFormat;
  genesysRemaining?: number;
  exact?: boolean;
  omittedChips?: readonly string[];
  deckMaster?: number;
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
  cards: RankedInsightCard[];
  total: number;
}
export interface CardPoolHealth {
  /** Distinct canonical cards, including unknown passcodes. */
  cards: number;
  roles: { searchers: number; extenders: number; removal: number; handTraps: number };
  extraDeck: { synchro: number; tuners: number; nonTuners: number; fusion: number; xyz: number; link: number; fusionEnablers: number; linkMaterialMonsters: number; xyzLevels: Record<string, number> };
  unlinkedPasscodes: number[];
  untaggedPasscodes: number[];
  warnings: string[];
}

type Retained = RankedInsightCard & { popularity: number };
const compare = (a: Retained, b: Retained) => b.linkedCards - a.linkedCards || b.score - a.score || b.popularity - a.popularity || a.passcode - b.passcode;
const limitOf = (value?: number) => Math.max(1, Math.min(120, Number.isFinite(value) ? Math.floor(value!) : 30));
const domain = (format?: CardInsightFormat) => format === "domain" || format === "genesys-domain";
const allowed = ({ card }: Candidate, options: CardInsightOptions) => {
  if (options.format !== "genesys" && options.format !== "genesys-domain") return true;
  return !isBarredFromGenesys(card) && card.genesysPoints !== undefined && card.genesysPoints <= (options.genesysRemaining ?? Infinity);
};
const retain = (ranked: Retained[], result: RankedInsightCard, candidate: Candidate, limit: number) => {
  const entry = { ...result, popularity: candidate.card.views };
  if (ranked.length === limit && compare(entry, ranked[ranked.length - 1]!) >= 0) return;
  ranked.push(entry); ranked.sort(compare);
  if (ranked.length > limit) ranked.pop();
};
const withoutPopularity = (ranked: Retained[]) => ranked.map(({ popularity: _popularity, ...card }) => card);
const codesOf = (deck: DuelDeck | readonly number[]): readonly number[] => Array.isArray(deck) ? deck : [...(deck as DuelDeck).main, ...(deck as DuelDeck).extra, ...(deck as DuelDeck).side];
const synergyTarget = (text: string) => text.trim().match(/^(?:cards?\s+that\s+)?(?:works?\s+(?:well\s+)?with|synerg(?:y|ies|izes?)\s+(?:with|for)|partners?\s+for)\s+(.+?)\s*[?.!]?$/i)?.[1];

/** SQL-backed, read-only insights. Only anchors, their profiles and the retained page live in memory. */
export function createCardInsightService(db: Database.Database, options: { dataDirectory?: string } = {}) {
  const withCatalog = <T>(read: (catalog: InsightCatalog) => T): T => {
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
      total++;
      if (master) result.deckMasterFit = cardSynergy(master, candidate).score > 0;
      retain(ranked, result, candidate, limitOf(opts.limit));
    }
    return { cards: withoutPopularity(ranked), total };
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
      if (opts.exact) return withCatalog(catalog => {
        const literal = text.trim().toLowerCase(), ranked: Retained[] = [];
        const master = domain(opts.format) && opts.deckMaster !== undefined ? catalog.candidate(opts.deckMaster) : undefined;
        let total = 0;
        if (literal) for (const candidate of catalog.candidates(pool)) {
          if (!allowed(candidate, opts) || !`${candidate.card.pendulumText ?? ""}\n${candidate.card.text}`.toLowerCase().includes(literal)) continue;
          total++;
          retain(ranked, { passcode: candidate.card.id, name: candidate.card.name, score: 0, linkedCards: 0, reason: `Text: ${text.trim()}`,
            ...(master ? { deckMasterFit: cardSynergy(master, candidate).score > 0 } : {}) }, candidate, limitOf(opts.limit));
        }
        return { reading: null, cards: withoutPopularity(ranked), total };
      });
      const initial = readQuery(text);
      const reading = initial ? omitReadingChips(initial, opts.omittedChips) : null;
      if (!reading || pool?.length === 0) return { reading, cards: [], total: 0 };
      const target = synergyTarget(text), anchor = target && !opts.omittedChips?.includes(initial!.chips[0]!) ? resolveTarget(target) : undefined;
      return withCatalog(catalog => {
        if (anchor !== undefined) {
          const candidate = catalog.candidate(anchor);
          return { reading, ...rank(catalog, candidate ? [candidate] : [], pool, opts) };
        }
        const ranked: Retained[] = [], words = normalizeImportedCardName(reading.query.text).split(" ").filter(Boolean);
        const master = domain(opts.format) && opts.deckMaster !== undefined ? catalog.candidate(opts.deckMaster) : undefined;
        let total = 0;
        for (const candidate of catalog.candidates(pool)) {
          if (!allowed(candidate, opts)) continue;
          const printed = normalizeImportedCardName(`${candidate.card.pendulumText ?? ""} ${candidate.card.text}`);
          if (words.length && !words.every(word => printed.includes(word))) continue;
          const score = matchCard(candidate.card, candidate.tags, reading.query);
          if (score === null) continue;
          total++;
          retain(ranked, { passcode: candidate.card.id, name: candidate.card.name, score, linkedCards: 0, reason: reading.chips.join("; "),
            ...(master ? { deckMasterFit: cardSynergy(master, candidate).score > 0 } : {}) }, candidate, limitOf(opts.limit));
        }
        return { reading, cards: withoutPopularity(ranked), total };
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
    poolHealth(codes: readonly number[]): CardPoolHealth {
      return withCatalog(catalog => {
        const canonical = [...new Set(codes.map(catalog.canonical))].sort((a, b) => a - b);
        const candidates = [...catalog.candidates(canonical)], known = new Map(candidates.map(candidate => [candidate.card.id, candidate]));
        const health: CardPoolHealth = { cards: canonical.length, roles: { searchers: 0, extenders: 0, removal: 0, handTraps: 0 }, extraDeck: { synchro: 0, tuners: 0, nonTuners: 0, fusion: 0, xyz: 0, link: 0, fusionEnablers: 0, linkMaterialMonsters: 0, xyzLevels: {} }, unlinkedPasscodes: [], untaggedPasscodes: [], warnings: [] };
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
    /** One catalog read for a whole pack: the reason each card works with the picked pool. Cards with no link are left out. */
    packFits(passcodes: readonly number[], pickedPool: readonly number[]): Map<number, string> {
      const fits = new Map<number, string>();
      if (!passcodes.length || !pickedPool.length) return fits;
      return withCatalog(catalog => {
        const deck = [...catalog.candidates(pickedPool)];
        if (!deck.length) return fits;
        const profiles = readInsightProfiles(db, deck), owned = new Set(deck.map(anchor => anchor.card.id));
        for (const passcode of passcodes) {
          const candidate = catalog.candidate(passcode);
          if (!candidate || owned.has(candidate.card.id)) continue;
          const result = scoreForDeck(candidate, deck, profiles);
          if (result.score > 0 && result.reason) fits.set(passcode, result.reason);
        }
        return fits;
      });
    },
    pickScore(passcode: number, pickedPool: readonly number[]): number {
      return withCatalog(catalog => {
        const candidate = catalog.candidate(passcode), deck = [...catalog.candidates(pickedPool)];
        if (!candidate || deck.some(anchor => anchor.card.id === candidate.card.id)) return 0;
        const score = scoreForDeck(candidate, deck, readInsightProfiles(db, deck)).score;
        const present = new Set<string>(deck.flatMap(anchor => anchor.tags?.roles ?? []));
        const balance = deck.length ? ["searcher", "extender", "removal", "hand_trap"].filter(role => candidate.tags?.roles.some(value => value === role) && !present.has(role)).length : 0;
        return score + balance;
      });
    },
  };
}

export type CardInsightService = ReturnType<typeof createCardInsightService>;
