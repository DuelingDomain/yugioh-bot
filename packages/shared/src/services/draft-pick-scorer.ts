import { createHash } from "node:crypto";
import type Database from "better-sqlite3";
import type { DraftCard } from "../types/index.js";
import { isExtraDeckCard } from "../cards/effects/card.js";
import { filterReachesCard, type Candidate } from "../cards/effects/synergy.js";
import { createInsightCatalog } from "./card-insight-catalog.js";
import { createCardInsightService } from "./card-insights.js";
import type { ShuffleSeed } from "./deal.js";

export type RankedDraftPick = DraftCard & {
  /** Internal ranking, including bounded seeded variation; not a win-rate estimate. */
  score: number;
  pickScore: number;
  fitsYourPool?: string;
};

/** Material supply is a draft heuristic, not a summon-legality check. Copies count as bodies. */
function materialSupply(extra: Candidate, pool: readonly Candidate[]): number {
  const main = pool.filter(({ card }) => card.kind === "monster" && !isExtraDeckCard(card));
  const filters = extra.tags?.materials ?? [];
  // Match separate requirements to separate bodies, including named/type/Level restrictions.
  const assigned = new Map<number, number>();
  const match = (filterIndex: number, visited: Set<number>): boolean => {
    for (let body = 0; body < main.length; body++) {
      if (visited.has(body) || !filterReachesCard(filters[filterIndex]!, main[body]!.card)) continue;
      visited.add(body);
      const previous = assigned.get(body);
      if (previous === undefined || match(previous, visited)) { assigned.set(body, filterIndex); return true; }
    }
    return false;
  };
  if (filters.some((_, index) => !match(index, new Set()))) return -1;

  const { card } = extra;
  if (card.subtypes.includes("synchro")) {
    if (!card.level || card.level > 20 || filters.length > 6) return 0;
    // Each body is used once. Bits retain Tuner/non-Tuner presence and separate tag slots.
    const states = new Set<number>([0]);
    const width = 4 * (1 << filters.length), fullMask = (1 << filters.length) - 1;
    for (const body of main) {
      const level = body.card.level;
      if (!level || level > card.level) continue;
      const tuner = body.card.subtypes.includes("tuner") ? 1 : 2;
      for (const state of [...states]) {
        const total = Math.floor(state / width) + level;
        if (total > card.level) continue;
        const flags = (state % 4) | tuner, mask = Math.floor((state % width) / 4);
        states.add(total * width + mask * 4 + flags);
        filters.forEach((filter, index) => {
          if (!(mask & (1 << index)) && filterReachesCard(filter, body.card)) states.add(total * width + (mask | (1 << index)) * 4 + flags);
        });
      }
    }
    return states.has(card.level * width + fullMask * 4 + 3) ? 1 : -1;
  }
  if (card.subtypes.includes("xyz")) {
    const count = Number(card.text.split("\n")[0]?.match(/^(\d+)\+?\s+/)?.[1] ?? 2);
    return card.rank && main.filter(body => body.card.level === card.rank && (!filters.length || filters.some(filter => filterReachesCard(filter, body.card)))).length >= count ? 1 : -1;
  }
  if (card.subtypes.includes("link")) {
    // Main Deck bodies each contribute one Link Rating. Do not assume an unmade Extra monster.
    const bodies = main.filter(body => !filters.length || filters.some(filter => filterReachesCard(filter, body.card)));
    return card.linkRating && bodies.length >= card.linkRating ? 1 : -1;
  }
  if (card.subtypes.includes("fusion")) {
    const enabler = pool.some(candidate => candidate.tags?.effects.some(effect => effect.actions.some(event => event.verb === "fusion_summon")));
    return enabler && main.length >= Math.max(2, filters.length) ? 1 : -1;
  }
  return 0;
}

/** One policy for bots and expired human picks. Callers supply legal current-pack options only. */
export function rankDraftPicks(db: Database.Database, options: readonly DraftCard[], pickedPool: readonly number[], context: {
  mainTarget: number; extraTarget: number; seed: ShuffleSeed;
}): RankedDraftPick[] {
  if (!options.length) return [];
  const catalog = createInsightCatalog(db);
  try {
    const pool = pickedPool.map(code => catalog.candidate(code)).filter((card): card is Candidate => card !== undefined);
    const insights = new Map(createCardInsightService(db).pickScores([...new Set(options.map(card => card.catalogCardId))], pickedPool).map(insight => [insight.passcode, insight]));
    const extraCount = pool.filter(({ card }) => isExtraDeckCard(card)).length;
    const desiredExtraShare = context.extraTarget / Math.max(1, context.mainTarget + context.extraTarget);
    const poolExtras = [...new Map(pool.filter(({ card }) => isExtraDeckCard(card)).map(card => [card.card.id, card])).values()];
    const supplyBefore = poolExtras.map(extra => materialSupply(extra, pool));
    return options.map(option => {
      const candidate = catalog.candidate(option.catalogCardId), insight = insights.get(option.catalogCardId);
      const pickScore = insight?.score ?? 0;
      let power = 0, balance = 0, materials = 0;
      if (candidate) {
        power = Math.min(2, Math.log10(1 + Math.max(0, candidate.card.views)) / 3);
        if (isExtraDeckCard(candidate.card)) {
          balance = context.extraTarget === 0 || extraCount >= context.extraTarget ? -6
            : 2 * (desiredExtraShare - (extraCount + 1) / (pool.length + 1));
          materials = materialSupply(candidate, pool) * 4;
        } else {
          balance = 2 * ((extraCount / (pool.length + 1)) - desiredExtraShare);
          if (pool.length - extraCount >= context.mainTarget) balance -= 6;
          materials = Math.min(3, poolExtras.reduce((sum, extra, index) => sum + Math.max(0, materialSupply(extra, [...pool, candidate]) - supplyBefore[index]!), 0));
        }
      }
      // Stateless per-seat/per-step noise survives worker/request restarts; it never consumes deal RNG.
      const noise = createHash("sha256").update(`${context.seed}:${option.id}`).digest().readUInt32BE(0) / 0x100000000 * 0.6 - 0.3;
      return { ...option, pickScore, score: power + Math.min(8, 2 * Math.log2(1 + pickScore)) + balance + materials + noise,
        ...(pickScore > 0 && insight?.reason ? { fitsYourPool: insight.reason } : {}) };
    }).sort((a, b) => b.score - a.score || a.id - b.id);
  } finally { catalog.close(); }
}
