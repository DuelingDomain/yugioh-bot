// Live scenarios of the seat rules in the overlay (F7 design, part P3b): R1 "each duelist" (ADR 0002, R-COMMON-EACH-PLAYER, Q3) and the Q10 script
// fixes. Plain data, also read by scripts/rule-coverage.ts; tests/scenarios/multiplayer/seats.test.ts runs them on a live core with Duel.MPNthDuelist
// (patch 0053 and later, NSEAT_LIVE=1). Every scenario uses the real card scripts plus the overlay, and ends with the state of EVERY seat.
// A Spell is activated from the hand in the own Main Phase of p0: it asks for a Spell/Trap Zone first.

import {
  activate, defineScenario, eliminate, expectBoard, expectEliminated, zone, type BoardExpect, type DuelistExpect, type Scenario, type Step,
} from "../../support/dsl.js";
import { SOURCE } from "./nseat-scenarios.js";

type Seat = "p0" | "p1" | "p2" | "p3";
type Format = "ffa3" | "ffa4" | "tag";
const EACH = `${SOURCE} [R-COMMON-EACH-PLAYER]`;
const ELIM = `${SOURCE} [R-FFA-ELIMINATION]`;

const CONTRACT = "Contract with Don Thousand";
const RAT = "Giant Rat";
const OX = "Battle Ox";
const AXE = "Axe Raider";
const FANG = "Silver Fang";

/** What a defeated seat shows in the seat projection: no cards (the LP is not zeroed by a surrender, so it is not checked). */
const GONE: DuelistExpect = { hand: { count: 0 }, spells: { count: 0 }, monsters: { count: 0 }, grave: { count: 0 } };

/** The state of EVERY seat. LP, monsters, Spell and Trap zones, Graveyard and banished zone are exact; the hand only when the spec names it. */
function everySeat(format: Format, spec: Partial<Record<Seat, DuelistExpect>>): Step {
  const seats: Seat[] = format === "ffa3" ? ["p0", "p1", "p2"] : ["p0", "p1", "p2", "p3"];
  const board: BoardExpect = {};
  for (const seat of seats) board[seat] = { lp: format === "tag" ? 16000 : 8000, monsters: [], spells: [], grave: [], banished: [], ...spec[seat] };
  return expectBoard(board);
}

export const SEATS_SCENARIOS: Scenario[] = [
  // --- R1 row: Contract with Don Thousand (a script fix, Q10) -----------------------------------------------------------------
  defineScenario({
    id: "seats-r1-ffa4-contract-with-don-thousand-living-duelists-pay-and-draw",
    title: "FFA4: p2 is eliminated, p0 activates Contract with Don Thousand: p0, p1 and p3 each lose 1000 LP and draw 1 card, the defeated p2 is unchanged",
    source: EACH,
    rules: ["R-COMMON-EACH-PLAYER", "R-FFA-ELIMINATION"],
    tags: ["multiplayer", "r1", "each-duelist", "q10", "ffa4", "card:56673480"],
    setup: {
      format: "ffa4",
      p0: { hand: [CONTRACT], deck: [RAT] },
      p1: { deck: [OX] },
      p2: { deck: [AXE] },
      p3: { deck: [FANG] },
    },
    steps: [
      eliminate("p2"),
      activate(CONTRACT, "p0"),
      zone("p0", "s0", "p0"),
      expectEliminated("p2"),
      everySeat("ffa4", {
        p0: { lp: 7000, hand: [RAT], spells: [CONTRACT] },
        p1: { lp: 7000, hand: [OX] },
        p2: GONE,
        p3: { lp: 7000, hand: [FANG] },
      }),
    ],
  }),
  defineScenario({
    id: "seats-r1-tag-contract-with-don-thousand-partner-included",
    title: "Tag: p0 activates Contract with Don Thousand: all four duelists draw 1 card, and each team pays 1000 LP for each of its two duelists (the partner is included)",
    source: EACH,
    rules: ["R-COMMON-EACH-PLAYER", "R-TAG-PARTNER"],
    tags: ["multiplayer", "r1", "each-duelist", "q10", "tag", "card:56673480"],
    setup: {
      format: "tag",
      p0: { hand: [CONTRACT], deck: [RAT] },
      p1: { deck: [OX] },
      p2: { deck: [AXE] },
      p3: { deck: [FANG] },
    },
    steps: [
      activate(CONTRACT, "p0"),
      zone("p0", "s0", "p0"),
      everySeat("tag", {
        p0: { lp: 14000, hand: [RAT], spells: [CONTRACT] },
        p1: { lp: 14000, hand: [OX] },
        p2: { lp: 14000, hand: [AXE] },
        p3: { lp: 14000, hand: [FANG] },
      }),
    ],
  }),
];
