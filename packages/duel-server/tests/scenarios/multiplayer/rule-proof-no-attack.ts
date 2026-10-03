import { activate, attack, changePhase, endTurn, expectEliminated, expectPrompt, expectTurn, pickOpponent, type Scenario, type Step } from "../../support/dsl.js";
import { defineScenarioWithFfaFirstDraw as defineScenario } from "./ffa-first-draw.js";
import { domainVariant } from "./domain-variants.js";
import { everySeat, SEATS } from "./seat-kit.js";
import { SOURCE } from "./nseat-scenarios.js";

function firstRound(format: "ffa3" | "ffa4", earlyLoss: boolean): Scenario {
  const ELF = "Mystical Elf";
  const setup: Scenario["setup"] = { format };
  const seats = SEATS[format];
  const living = seats.filter((seat) => !earlyLoss || seat !== "p1");
  for (const seat of seats) setup[seat] = { monsters: [ELF], ...(earlyLoss && seat === "p1" ? { lp: 500 } : {}),
    ...(earlyLoss && seat === "p0" ? { hand: ["Hinotama"] } : {}) };
  const steps: Step[] = [expectPrompt({ by: "p0", context: "action", notOffers: ["to_bp"] })];
  if (earlyLoss) steps.push(activate("Hinotama", "p0"), pickOpponent("p1", "p0"), expectEliminated("p1"));
  const attacker = living[living.length - 1]!;
  const target = living[0]!;
  for (const [index, seat] of living.entries()) {
    steps.push(expectTurn(seat, index + 1));
    if (seat === attacker) {
      steps.push(expectPrompt({ by: seat, context: "action", offers: ["to_bp"] }));
    } else {
      steps.push(expectPrompt({ by: seat, context: "action", notOffers: ["to_bp"] }), endTurn(seat));
    }
  }
  steps.push(changePhase("battle", attacker),
    attack(ELF, { card: ELF, owner: target }, attacker), expectEliminated(...(earlyLoss ? ["p1" as const] : [])),
    everySeat(format, Object.fromEntries(seats.map((seat) => [seat, {
      lp: earlyLoss && seat === "p1" ? 0 : 8000,
      monsters: seat === attacker || seat === target || earlyLoss && seat === "p1" ? [] : [ELF],
      hand: seat === "p0" || earlyLoss && seat === "p1" ? [] : [ELF],
      grave: seat === "p0" ? [...(earlyLoss ? ["Hinotama"] : []), ELF] : seat === attacker ? [ELF] : [],
    }]))));
  return defineScenario({ id: `rule-proof-${format}-first-round-${earlyLoss ? "early-loss" : "all-live"}`,
    title: `${format}: the last living seat has the first attack on its first turn${earlyLoss ? ", and skips an early loss" : ""}`,
    source: `${SOURCE} [R-FFA-NO-ATTACK]`, rules: ["R-FFA-NO-ATTACK"], tags: ["multiplayer", format, "battle"], setup, steps });
}
const standard = (["ffa3", "ffa4"] as const).flatMap((format) => [firstRound(format, false), firstRound(format, true)]);
const domain = standard.map((scenario) => {
  const result = structuredClone(domainVariant(scenario));
  for (const step of result.steps) {
    if (step.op !== "expectBoard") continue;
    for (const seat of SEATS[result.setup.format as "ffa3" | "ffa4"]) {
      if (step.board[seat]?.lp === 0) continue;
      step.board[seat] = { ...step.board[seat], deckMaster: { inZone: true, returns: 0, nextCost: 0 } };
    }
  }
  return result;
});
export const NO_ATTACK_PROOF_SCENARIOS = [...standard, ...domain];
