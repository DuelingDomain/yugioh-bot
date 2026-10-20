import { createHash } from "node:crypto";
import type Database from "better-sqlite3";
import type { DraftCard } from "../types/index.js";
import { effectSearchEnabled } from "../cards/effects/capability.js";
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

const enablesFusion = (candidate: Candidate) => candidate.tags?.effects.some(effect =>
  effect.actions.some(event => event.verb === "fusion_summon" && event.player !== "opponent")) ?? false;

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
    const printed = card.text.split(/\r?\n/)[0] ?? "";
    const tuner = printed.match(/(\d+)(\+|\s+or\s+more)?\s+(?:(?!non[- ]tuner)[^+\n])*?\btuners?\b/i);
    const nonTuner = printed.match(/(\d+)(\+|\s+or\s+more)?\s+[^+\n]*?\bnon[- ]tuners?\b/i);
    const tunerMin = Number(tuner?.[1] ?? 1), nonTunerMin = Number(nonTuner?.[1] ?? 1);
    if (tunerMin > 5 || nonTunerMin > 5) return 0;
    // Each body is used once. Retain required body counts, exact Level, and separate tag slots.
    const states = new Set<number>([0]);
    const counts = (tunerMin + 1) * (nonTunerMin + 1);
    const width = counts * (1 << filters.length), fullMask = (1 << filters.length) - 1;
    const complete = card.level * width + fullMask * counts + counts - 1;
    for (const body of main) {
      const level = body.card.level;
      if (!level || level > card.level) continue;
      const isTuner = body.card.subtypes.includes("tuner");
      // Match metadata once per body, rather than once for every DP state.
      const slots = filters.map((filter, index) => filterReachesCard(filter, body.card) ? 1 << index : 0).filter(Boolean);
      for (const state of [...states]) {
        const total = Math.floor(state / width) + level;
        if (total > card.level) continue;
        const previous = state % counts;
        const tunerCount = previous % (tunerMin + 1), nonTunerCount = Math.floor(previous / (tunerMin + 1));
        if (isTuner && tuner && !tuner[2] && tunerCount === tunerMin) continue;
        if (!isTuner && nonTuner && !nonTuner[2] && nonTunerCount === nonTunerMin) continue;
        const next = Math.min(tunerMin, tunerCount + (isTuner ? 1 : 0))
          + (tunerMin + 1) * Math.min(nonTunerMin, nonTunerCount + (isTuner ? 0 : 1));
        const mask = Math.floor((state % width) / counts);
        states.add(total * width + mask * counts + next);
        for (const slot of slots) if (!(mask & slot)) states.add(total * width + (mask | slot) * counts + next);
      }
      if (states.has(complete)) return 1;
    }
    return -1;
  }
  if (card.subtypes.includes("xyz")) {
    const count = Number(card.text.split("\n")[0]?.match(/^(\d+)\+?\s+/)?.[1] ?? 2);
    return card.rank && main.filter(body => body.card.level === card.rank && (!filters.length || filters.some(filter => filterReachesCard(filter, body.card)))).length >= count ? 1 : -1;
  }
  if (card.subtypes.includes("link")) {
    // Main Deck bodies each contribute one Link Rating. Do not assume an unmade Extra monster.
    const bodies = main.filter(body => !filters.length || filters.some(filter => filterReachesCard(filter, body.card)));
    const requirements = `${card.text.split(/\r?\n/)[0]} ${filters.map(filter => filter.other).join(" ")}`;
    if (/different names/i.test(requirements) && new Set(bodies.map(body => body.card.name.trim().toLowerCase())).size < (card.linkRating ?? 1)) return -1;
    return card.linkRating && bodies.length >= card.linkRating ? 1 : -1;
  }
  if (card.subtypes.includes("fusion")) {
    const enabler = pool.some(enablesFusion);
    const contact = extra.tags?.effects.some(effect => effect.timing === "condition" && effect.location.includes("extra_deck")
      && effect.actions.some(event => event.verb === "special_summon" && event.what.this_card && event.from.includes("extra_deck")));
    return (enabler || contact) && main.length >= Math.max(2, filters.length) ? 1 : -1;
  }
  return 0;
}

/** One policy for bots and expired human picks. Callers supply legal current-pack options only. */
export function rankDraftPicks(db: Database.Database, options: readonly DraftCard[], pickedPool: readonly number[], context: {
  mainTarget: number; extraTarget: number | null; seed: ShuffleSeed;
}): RankedDraftPick[] {
  if (!options.length) return [];
  if (!effectSearchEnabled()) {
    // The former bot and expired-pick policy makes exactly one uniform draw.
    // Only the first row is used for the pick; do not read effect tags or scores.
    const selected = Math.floor(Math.random() * options.length);
    return [options[selected]!, ...options.slice(0, selected), ...options.slice(selected + 1)]
      .map(option => ({ ...option, score: 0, pickScore: 0 }));
  }
  const catalog = createInsightCatalog(db);
  try {
    const pool = pickedPool.map(code => catalog.candidate(code)).filter((card): card is Candidate => card !== undefined);
    const insights = new Map(createCardInsightService(db, { catalog }).pickScores([...new Set(options.map(card => card.catalogCardId))], pickedPool).map(insight => [insight.passcode, insight]));
    const extraCount = pool.filter(({ card }) => isExtraDeckCard(card)).length;
    const desiredExtraShare = (context.extraTarget ?? 0) / Math.max(1, context.mainTarget + (context.extraTarget ?? 0));
    const poolExtras = [...new Map(pool.filter(({ card }) => isExtraDeckCard(card)).map(card => [card.card.id, card])).values()];
    const supplyBefore = new Map<number, number>();
    return options.map(option => {
      const candidate = catalog.candidate(option.catalogCardId), insight = insights.get(option.catalogCardId);
      const pickScore = insight?.score ?? 0;
      let power = 0, balance = 0, materials = 0;
      if (candidate) {
        power = Math.min(2, Math.log10(1 + Math.max(0, candidate.card.views)) / 3);
        if (isExtraDeckCard(candidate.card)) {
          if (context.extraTarget !== null) {
            balance = context.extraTarget === 0 || extraCount >= context.extraTarget ? -6
              : 2 * (desiredExtraShare - (extraCount + 1) / (pool.length + 1));
          }
          materials = materialSupply(candidate, pool) * 4;
        } else {
          if (context.extraTarget !== null) {
            balance = 2 * ((extraCount / (pool.length + 1)) - desiredExtraShare);
            if (pool.length - extraCount >= context.mainTarget) balance -= 6;
          }
          materials = Math.min(3, poolExtras.reduce((sum, extra) => {
            const filters = extra.tags?.materials ?? [];
            const fusionEnabler = extra.card.subtypes.includes("fusion") && enablesFusion(candidate);
            if (filters.length && !fusionEnabler && !filters.some(filter => filterReachesCard(filter, candidate.card))) return sum;
            const level = extra.card.level ?? extra.card.rank;
            // Fusion materials have no implicit Level cap, and Links have no Level/Rank.
            if ((extra.card.subtypes.includes("synchro") || extra.card.subtypes.includes("xyz"))
              && level && candidate.card.level && candidate.card.level > level) return sum;
            // Resolve the baseline only if an option could help; share it across the pack.
            let before = supplyBefore.get(extra.card.id);
            if (before === undefined) { before = materialSupply(extra, pool); supplyBefore.set(extra.card.id, before); }
            if (before === 1) return sum;
            return sum + Math.max(0, materialSupply(extra, [...pool, candidate]) - before);
          }, 0));
        }
      }
      // Stateless per-seat/per-step noise survives worker/request restarts; it never consumes deal RNG.
      const noise = createHash("sha256").update(`${context.seed}:${option.id}`).digest().readUInt32BE(0) / 0x100000000 * 0.6 - 0.3;
      return { ...option, pickScore, score: power + Math.min(8, 2 * Math.log2(1 + pickScore)) + balance + materials + noise,
        ...(pickScore > 0 && insight?.reason ? { fitsYourPool: insight.reason } : {}) };
    }).sort((a, b) => b.score - a.score || a.id - b.id);
  } finally { catalog.close(); }
}
