import { defineScenario, endTurn, expectBoard, expectTurn, type DuelistExpect, type Scenario, type Step } from "../../support/dsl.js";
import { domainVariant } from "./domain-variants.js";
import { everySeat, SEATS, type Seat } from "./seat-kit.js";
import { SOURCE } from "./nseat-scenarios.js";

function order(format: "ffa3" | "ffa4"): Scenario {
  const seats = SEATS[format];
  const steps: Step[] = [];
  const drawn: Record<Seat, number> = { p0: 0, p1: 0, p2: 0, p3: 0 };
  for (let turn = 0; turn <= seats.length; turn++) {
    const seat = seats[turn % seats.length];
    drawn[seat]++;
    const state = Object.fromEntries(seats.map((owner) => [owner, { hand: Array(drawn[owner]).fill("Mystical Elf"),
      deckCount: 20 - drawn[owner], extra: [] } satisfies DuelistExpect]));
    steps.push(expectTurn(seat, turn + 1), everySeat(format, state));
    if (turn < seats.length) steps.push(endTurn(seat));
  }
  return defineScenario({ id: `rule-proof-${format}-turn-order-and-first-draw`, title: `${format}: turns go clockwise, and every duelist draws on their first turn`,
    source: `${SOURCE} [R-FFA-ORDER] [R-FFA-FIRST-DRAW]`, rules: ["R-FFA-ORDER", "R-FFA-FIRST-DRAW"], tags: ["multiplayer", format, "turn-order"], setup: { format }, steps });
}
const standard = [order("ffa3"), order("ffa4")];
export const FFA_ORDER_PROOF_SCENARIOS = [...standard, ...standard.map(domainVariant)];

function firstDrawControl(format: "tag" | "1v1"): Scenario {
  const seats: Seat[] = format === "tag" ? SEATS.tag : ["p0", "p1"];
  const drawn: Record<Seat, number> = { p0: 0, p1: 0, p2: 0, p3: 0 };
  const steps: Step[] = [];
  for (let turn = 0; turn <= seats.length; turn++) {
    const seat = seats[turn % seats.length];
    if (turn) drawn[seat]++;
    const state = Object.fromEntries(seats.map((owner) => [owner, {
      lp: format === "tag" ? 16000 : 8000,
      hand: Array(drawn[owner]).fill("Mystical Elf"), deckCount: 20 - drawn[owner],
      monsters: [], spells: [], grave: [], banished: [], extra: [],
    } satisfies DuelistExpect]));
    steps.push(expectTurn(seat, turn + 1), expectBoard(state));
    if (turn < seats.length) steps.push(endTurn(seat));
  }
  return defineScenario({
    id: `rule-proof-${format}-first-draw-control`,
    title: `${format}: only the first duelist's first draw is skipped`,
    source: format === "tag" ? `${SOURCE} [R-TAG-ORDER]` : "Stock 1v1 first-turn draw rule",
    rules: format === "tag" ? ["R-TAG-ORDER"] : [],
    tags: ["multiplayer", format, "first-draw-control"], setup: { format }, steps,
  });
}
const controls = [firstDrawControl("tag"), firstDrawControl("1v1")];
export const FIRST_DRAW_CONTROL_SCENARIOS = [...controls, ...controls.map(domainVariant)];
