import { defineScenario, endTurn, expectTurn, type DuelistExpect, type Scenario, type Step } from "../../support/dsl.js";
import { domainVariant } from "./domain-variants.js";
import { everySeat, SEATS, type Seat } from "./seat-kit.js";
import { SOURCE } from "./nseat-scenarios.js";

function order(format: "ffa3" | "ffa4"): Scenario {
  const seats = SEATS[format];
  const steps: Step[] = [];
  const drawn: Record<Seat, number> = { p0: 0, p1: 0, p2: 0, p3: 0 };
  for (let turn = 0; turn <= seats.length; turn++) {
    const seat = seats[turn % seats.length];
    if (turn) drawn[seat]++;
    const state = Object.fromEntries(seats.map((owner) => [owner, { hand: Array(drawn[owner]).fill("Mystical Elf"),
      deckCount: 20 - drawn[owner], extra: [] } satisfies DuelistExpect]));
    steps.push(expectTurn(seat, turn + 1), everySeat(format, state));
    if (turn < seats.length) steps.push(endTurn(seat));
  }
  return defineScenario({ id: `rule-proof-${format}-turn-order-and-first-draw`, title: `${format}: turns go clockwise, and only the first draw is skipped`,
    source: `${SOURCE} [R-FFA-ORDER]`, rules: ["R-FFA-ORDER"], tags: ["multiplayer", format, "turn-order"], setup: { format }, steps });
}
const standard = [order("ffa3"), order("ffa4")];
export const FFA_ORDER_PROOF_SCENARIOS = [...standard, ...standard.map(domainVariant)];
