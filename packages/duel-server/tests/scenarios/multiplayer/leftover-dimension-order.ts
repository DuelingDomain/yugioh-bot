import { type Scenario, type Step } from "../../support/dsl.js";
import { defineScenarioWithFfaFirstDraw as defineScenario } from "./ffa-first-draw.js";
import { EACH_DUELIST_REVIVAL_SCENARIOS } from "./each-duelist-revival.js";
import { type Format } from "./seat-kit.js";

export const LEFTOVER_DIMENSION_ORDER_SCENARIOS: Scenario[] = (["ffa3", "ffa4", "tag"] as Format[]).map((format) => {
  const proof = structuredClone(EACH_DUELIST_REVIVAL_SCENARIOS.find((s) => s.id === "each-duelist-revival-tag-p1-39900763")!);
  proof.id = `leftover-dimension-encounter-${format}-off-turn-p1-turn-first`;
  proof.title = `${format}: p1 activates Different Dimension Encounter during p0's turn and p0 chooses first`;
  proof.setup.format = format;
  proof.tags = ["multiplayer", format, "card:39900763"];
  if (format === "ffa3") delete proof.setup.p3;
  const first = proof.steps.findIndex((step) => step.op === "expectPickOptions");
  const groups: Step[][] = [];
  let at = first;
  while (proof.steps[at]?.op === "expectPickOptions") { groups.push(proof.steps.slice(at, at + 3)); at += 3; }
  const kept = groups.filter((group) => format !== "ffa3" || (group[0] as Step & { by: string }).by !== "p3");
  kept.sort((a, b) => Number((a[0] as Step & { by: string }).by[1]) - Number((b[0] as Step & { by: string }).by[1]));
  proof.steps = [...proof.steps.slice(0, first), ...kept.flat(), ...proof.steps.slice(at)];
  for (const step of proof.steps) if (step.op === "expectBoard") {
    if (format === "ffa3") delete step.board.p3;
    for (const state of Object.values(step.board)) state!.lp = format === "tag" ? 16000 : 8000;
  }
  return defineScenario(proof);
});
