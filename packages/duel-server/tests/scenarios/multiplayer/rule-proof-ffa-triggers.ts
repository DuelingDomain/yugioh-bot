import { defineScenario, type Scenario, type Step } from "../../support/dsl.js";
import { domainVariant } from "./domain-variants.js";
import { FFA_SCENARIOS } from "./nseat-ffa.js";

const sources = FFA_SCENARIOS.filter((s) => s.rules?.includes("R-FFA-TRIGGERS"));
if (sources.length !== 2) throw new Error("The FFA trigger sources changed; review the new proof");
const standard: Scenario[] = (["ffa3", "ffa4"] as const).flatMap((format) => sources.map((source, index) => {
  const setup = structuredClone(source.setup);
  setup.format = format;
  if (format === "ffa3") delete setup.p3;
  const steps: Step[] = source.steps.map((step) => {
    if (format === "ffa3" && step.op === "expectBoard") { const board = { ...step.board }; delete board.p3; return { ...step, board }; }
    return step;
  });
  return defineScenario({ ...source, id: `rule-proof-${format}-simultaneous-triggers-turn-player-p${index}`,
    title: `${format}: simultaneous triggers go clockwise from turn player p${index}, then resolve in reverse`, setup, steps });
}));
export const FFA_TRIGGER_PROOF_SCENARIOS = [...standard, ...standard.map(domainVariant)];
