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
  for (const [index, seat] of living.entries()) {
    steps.push(expectTurn(seat, index + 1), expectPrompt({ by: seat, context: "action", notOffers: ["to_bp"] }), endTurn(seat));
  }
  const target = living[living.length - 1];
  steps.push(expectTurn("p0", living.length + 1), expectPrompt({ by: "p0", offers: ["to_bp"] }), changePhase("battle", "p0"),
    attack(ELF, { card: ELF, owner: target }, "p0"), expectEliminated(...(earlyLoss ? ["p1" as const] : [])),
    everySeat(format, Object.fromEntries(seats.map((seat) => [seat, {
      lp: earlyLoss && seat === "p1" ? 0 : 8000,
      monsters: seat === "p0" || seat === target || earlyLoss && seat === "p1" ? [] : [ELF],
      hand: earlyLoss && seat === "p1" ? [] : [ELF],
      grave: seat === "p0" ? [...(earlyLoss ? ["Hinotama"] : []), ELF] : seat === target ? [ELF] : [],
    }]))));
  return defineScenario({ id: `rule-proof-${format}-first-round-${earlyLoss ? "early-loss" : "all-live"}`,
    title: `${format}: the first attack waits for all living seats to finish a turn${earlyLoss ? ", and skips an early loss" : ""}`,
    source: `${SOURCE} [R-FFA-NO-ATTACK]`, rules: ["R-FFA-NO-ATTACK"], tags: ["multiplayer", format, "battle"], setup, steps });
}
const standard = (["ffa3", "ffa4"] as const).flatMap((format) => [firstRound(format, false), firstRound(format, true)]);
export const NO_ATTACK_PROOF_SCENARIOS = [...standard, ...standard.map(domainVariant)];
