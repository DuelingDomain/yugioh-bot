import { defineScenario, type Scenario, type Step } from "../../support/dsl.js";
import { domainVariant } from "./domain-variants.js";
import { FFA_SCENARIOS } from "./nseat-ffa.js";
import { everySeat, SEATS } from "./seat-kit.js";

const source = FFA_SCENARIOS.find((s) => s.id === "nseat-ffa4-four-way-chain-order")!;
if (!source) throw new Error("The FFA chain source is missing");
const standard: Scenario[] = (["ffa3", "ffa4"] as const).map((format) => {
  const setup = structuredClone(source.setup);
  setup.format = format;
  if (format === "ffa3") delete setup.p3;
  const steps: Step[] = source.steps.filter((step) => !(format === "ffa3" && (("by" in step && step.by === "p3") || (step.op === "expectPrompt" && step.prompt.by === "p3"))))
    .map((step) => {
      if (format === "ffa3" && step.op === "expectBoard") { const board = { ...step.board }; delete board.p3; return { ...step, board }; }
      if (format === "ffa3" && step.op === "expectResponseOrder") return { ...step, seats: step.seats.filter((seat) => seat !== "p3") };
      return step;
    });
  steps.push(everySeat(format, Object.fromEntries(SEATS[format].map((seat) => [seat, {
    hand: [], deckCount: 20, grave: seat === "p0" ? ["Heavy Storm", "Swords of Revealing Light", "Swords of Revealing Light", "Dust Tornado"] : seat === "p2" ? ["Dust Tornado", "Dust Tornado"] : ["Dust Tornado"],
  }]))));
  return defineScenario({ ...source, id: `rule-proof-${format}-turn-player-responds-first`,
    title: `${format}: a later seat chains, then the turn player responds first and all seats pass in order`, setup, steps });
});
export const FFA_CHAIN_PROOF_SCENARIOS = [...standard, ...standard.map(domainVariant)];
