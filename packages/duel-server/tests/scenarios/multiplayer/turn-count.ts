// Live scenarios of the turn counters that live in a GLOBAL effect (a check that a card registers in initial_effect), rule R-TAG-TURN-COUNT
// of ADR-0002: the End Phase of EVERY duelist counts, the partner of a Tag team too. Plain data: no Vitest import, so that
// scripts/rule-coverage.ts can load this file. turn-count.test.ts runs them on a live core.
//
// A global effect has no scope player, so Duel.MPNthDuelist gives nothing there. An overlay that loops over the duelists with
// aux.MPForEachDuelist ran zero times in such an effect: Final Countdown never ended the duel at 3 or more seats. The overlay loops
// with aux.MPEachSeat in a global effect (mp-utility.lua). Final Countdown is banned at 3+ seats by the deck check (alt-win), so the
// scenario puts the card in the hand of p0 by setup: it proves the engine rule, not a legal deck.

import {
  activate, auto, defineScenario, endTurn, expectBoard, expectEliminated, expectResult, type Scenario, type Step,
} from "../../support/dsl.js";
import { SOURCE } from "./nseat-scenarios.js";

const FINAL_COUNTDOWN = "Final Countdown";
const FINAL_COUNTDOWN_CODE = 95308449;

type Id = "p0" | "p1" | "p2" | "p3";
type Format = "ffa3" | "ffa4" | "tag";

const SEATS: Record<Format, Id[]> = { ffa3: ["p0", "p1", "p2"], ffa4: ["p0", "p1", "p2", "p3"], tag: ["p0", "p1", "p2", "p3"] };

/** The seat order of the table: the turn after the turn of seats[i] is the turn of seats[(i + 1) % length]. */
const ORDER = (format: Format): Id[] => SEATS[format];

/**
 * Hand size of every seat (the hand is empty at the start but for the card of the activator). Each turn draws 1 card, but the first turn
 * of the duel; the hand limit of 6 forces a discard in the End Phase of a turn that ends with 7 cards. `turn` is the number of turns that
 * are over; the seat of turn `turn` has drawn when `drawn` is true. The activator has played its Final Countdown when `played` is true.
 */
interface Counts {
  hand: Record<Id, number>;
  /** Cards that a seat discarded for the hand limit (they are in its Graveyard). */
  discarded: Record<Id, number>;
}
function handsAfter(format: Format, activator: Id, turn: number, drawn: boolean, played: boolean): Counts {
  const order = ORDER(format);
  const hand: Record<Id, number> = { p0: 0, p1: 0, p2: 0, p3: 0 };
  const discarded: Record<Id, number> = { p0: 0, p1: 0, p2: 0, p3: 0 };
  hand[activator] = played ? 0 : 1;
  for (let t = 0; t < turn + (drawn ? 1 : 0); t++) {
    const seat = order[t % order.length]!;
    if (t > 0 || format !== "tag") hand[seat] += 1;
    if (t < turn && hand[seat] > 6) {
      discarded[seat] += hand[seat] - 6;
      hand[seat] = 6;
    }
  }
  return { hand, discarded };
}

/** The End Phases of the turns from `from` up to (not including) `to`, with the answer to the hand-limit discard where a hand is over 6. */
function endPhases(format: Format, activator: Id, from: number, to: number): Step[] {
  const order = ORDER(format);
  const out: Step[] = [];
  for (let t = from; t < to; t++) {
    const seat = order[t % order.length]!;
    out.push(endTurn(seat));
    const hands = handsAfter(format, activator, t, true, t >= order.indexOf(activator));
    if (hands.hand[seat] > 6) out.push(auto(seat));
  }
  return out;
}

/**
 * The whole table. Final Countdown is in the Graveyard of the activator (a Normal Spell: the count is an effect of the duel, not a card on
 * the field). The 2000 LP of the cost are paid by the activator (in Tag, by its team). `out` are the seats that are out of the duel.
 */
function table(format: Format, activator: Id, counts: Counts, out: Id[] = []): Step {
  const base = format === "tag" ? 16000 : 8000;
  const teamOf = (seat: Id) => (format === "tag" ? Number(seat.slice(1)) % 2 : Number(seat.slice(1)));
  const board: Partial<Record<Id, object>> = {};
  for (const seat of SEATS[format]) {
    const gone = out.includes(seat);
    board[seat] = {
      lp: base - (teamOf(seat) === teamOf(activator) ? 2000 : 0),
      hand: { count: gone ? 0 : counts.hand[seat] },
      banished: { count: 0 },
      monsters: { count: 0 },
      spells: { count: 0 },
      grave: gone ? { count: 0 } : seat === activator ? { count: 1 + counts.discarded[seat], include: [FINAL_COUNTDOWN] } : { count: counts.discarded[seat] },
    };
  }
  return expectBoard(board);
}

function finalCountdown(format: Format, activator: Id): Scenario {
  const order = ORDER(format);
  const start = order.indexOf(activator);
  const last = start + 19;
  const lastSeat = order[last % order.length]!;
  const winners: Id[] = format === "tag" ? (["p0", "p2"].includes(activator) ? ["p0", "p2"] : ["p1", "p3"]) : [activator];
  const losers = SEATS[format].filter((seat) => !winners.includes(seat));
  const setup = { format, deckSize: 40, [activator]: { hand: [FINAL_COUNTDOWN] } } as Scenario["setup"];
  return defineScenario({
    id: `turn-count-${format}-final-countdown-${activator}-ends-the-duel-after-20-end-phases`,
    title: `${format.toUpperCase()}: Final Countdown of ${activator} (global turn-end check) counts the End Phase of every duelist and gives ${activator} the win at the 20th End Phase`,
    source: `${SOURCE} [R-TAG-TURN-COUNT] the End Phase of every duelist counts as a turn`,
    rules: ["R-TAG-TURN-COUNT"],
    tags: ["multiplayer", "turn-count", "global-effect", format, `card:${FINAL_COUNTDOWN_CODE}`],
    setup,
    steps: [
      ...endPhases(format, activator, 0, start),
      activate(FINAL_COUNTDOWN, activator),
      table(format, activator, handsAfter(format, activator, start, true, true)),
      // The End Phase of the turn of the activator is the 1st. 19 are over after the 19th: the count is not done and every seat is still in.
      ...endPhases(format, activator, start, last),
      table(format, activator, handsAfter(format, activator, last, true, true)),
      endTurn(lastSeat),
      ...(handsAfter(format, activator, last, true, true).hand[lastSeat] > 6 ? [auto(lastSeat)] : []),
      // The 20th End Phase is done: the activator wins (in Tag its team). Every other seat is out and its cards are gone.
      expectResult(format === "tag" ? { team: Number(activator.slice(1)) % 2 } : { seat: activator }),
      expectEliminated(...losers),
      table(format, activator, handsAfter(format, activator, last, true, true), losers),
    ],
  });
}

export const TURN_COUNT_SCENARIOS: Scenario[] = [
  finalCountdown("ffa3", "p0"), finalCountdown("ffa4", "p0"), finalCountdown("tag", "p0"),
  finalCountdown("ffa3", "p2"), finalCountdown("ffa4", "p3"), finalCountdown("tag", "p1"),
];
