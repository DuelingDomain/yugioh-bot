import { deriveEngineCore, type EngineCorePlan } from "./engine-core.js";
import { REVIEWED_CORE_PLANS } from "./engine-core-plans.js";
import type { BridgeFormat, BridgeGraphData } from "./bridge-types.js";
import { bridgeObservations, observationFormat, type BridgeObservations, type ObservationFormat } from "./bridge-observations.js";
import { bridgeLegal } from "./bridge-engine.js";

/** Observed quantities adjust a grounded plan; popularity cannot clear dependency gaps. */
export function observedEngineCore(plan: EngineCorePlan, graph: BridgeGraphData, engine: string, format: BridgeFormat,
  sampleFormat: ObservationFormat = observationFormat(format), artifact: BridgeObservations | null = bridgeObservations()): EngineCorePlan {
  const sample = artifact?.formats[sampleFormat]?.engines[engine];
  if (!sample || sample.decks < 5) return plan;
  const legalMembers = new Set(graph.capabilities.filter(row=>graph.groups[engine]?.includes(row.id) && bridgeLegal(row.card,format)).map(row=>row.id));
  const prevalent = sample.cards.filter(card => card.decks / sample.decks >= 0.5 && legalMembers.has(card.code)).map(card => card.code);
  // Unreviewed proposals start with the members lists actually play. The same
  // checked role/dependency selector still runs, and remains provisional.
  if (!REVIEWED_CORE_PLANS[engine]) {
    if (prevalent.length < 3) return plan;
    plan = deriveEngineCore({ ...graph, groups: { ...graph.groups, [engine]: prevalent } }, engine, format);
  }
  const cards = plan.cards.map(slot => {
    const usage = sample.cards.find(row => row.code === slot.card.id);
    // Rare/absent members do not overwrite a grounded dependency or guessed count.
    if (!usage || usage.decks / sample.decks < 0.5 || !bridgeLegal(slot.card, format)) return slot;
    const limit = format === "genesys" ? 3 : slot.card.banTcg === "Limited" ? 1 : slot.card.banTcg === "Semi-Limited" ? 2 : 3;
    const materialFloor = slot.role === "material" ? slot.copies : 1;
    const copies = Math.min(limit, Math.max(materialFloor, Math.round(usage.copies / sample.decks)));
    return { ...slot, copies, evidence: [...slot.evidence,
      `Observed in ${usage.decks}/${sample.decks} sampled ${sampleFormat} lists; ${usage.copies} total Main/Extra copies.`] };
  });
  const gaps = [...plan.gaps];
  if (cards.reduce((n, slot) => n + slot.copies, 0) > 12 && !gaps.some(gap => /exceeds the 12-copy target/.test(gap)))
    gaps.push("Observed engine exceeds the 12-copy target; review deck space.");
  return { cards, gaps, caption: `${plan.caption} Quantities informed by ${sample.decks} sampled ${sampleFormat} lists; dependencies remain checked.` };
}
