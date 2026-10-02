import { activate, endTurn, expectPickSeats, pickOpponent, type DuelistExpect, type Scenario, type Step } from "../../support/dsl.js";
import { defineScenarioWithFfaFirstDraw as defineScenario } from "./ffa-first-draw.js";
import { domainVariant } from "./domain-variants.js";
import { everySeat, SEATS, type Seat } from "./seat-kit.js";
import { SOURCE } from "./nseat-scenarios.js";

function separateLp(format: "ffa3" | "ffa4"): Scenario {
  const setup: Scenario["setup"] = { format };
  const state: Partial<Record<Seat, DuelistExpect>> = {};
  const steps: Step[] = [];
  const seats = SEATS[format];
  for (const seat of seats) {
    setup[seat] = { hand: ["Hinotama"] };
    state[seat] = { lp: 8000, hand: ["Hinotama"], deckCount: 20 };
  }
  for (const [index, seat] of seats.entries()) {
    if (index) state[seat] = { ...state[seat], hand: ["Hinotama", "Mystical Elf"], deckCount: 19 };
    const target = seats[(index + 1) % seats.length];
    state[seat] = { ...state[seat], hand: index ? ["Mystical Elf"] : [], grave: ["Hinotama"] };
    state[target] = { ...state[target], lp: state[target]!.lp! - 500 };
    steps.push(activate("Hinotama", seat), expectPickSeats(seats.filter((other) => other !== seat), seat),
      pickOpponent(target, seat), everySeat(format, state));
    if (index < seats.length - 1) steps.push(endTurn(seat));
  }
  return defineScenario({ id: `rule-proof-${format}-independent-lp-every-seat`, title: `${format}: every seat pays damage into one independent LP total`,
    source: `${SOURCE} [R-FFA-LP]`, rules: ["R-FFA-LP"], tags: ["multiplayer", format, "card:46130346"], setup, steps });
}
const standard = [separateLp("ffa3"), separateLp("ffa4")];
export const FFA_LP_PROOF_SCENARIOS = [...standard, ...standard.map(domainVariant)];
