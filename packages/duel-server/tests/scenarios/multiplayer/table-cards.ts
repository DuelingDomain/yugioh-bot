// Live scenarios of the table cards that need a script fix or a proof of the multi-seat rules (F7 design, part P3b, row Table):
// Traptrix Pudica (the Standby Phase return goes to the controller of the banished monster), Summoning Curse (every controller of a
// summoned monster banishes), Brain Jacker, The Eye of Truth, Kiseitai, Gingerbread House and Snake-Eyes Diabellstar (a dead bound opponent).
// Plain data, also read by scripts/rule-coverage.ts; table-cards.test.ts runs them on a live core (NSEAT_LIVE=1).
// Every scenario ends with the state of every seat. Decisions: docs/adr/0002-multiplayer-duel-rules.md and DECISIONS-2026-10-01 (Q3, Q6, Q9, OQ3).

import {
  activate, defineScenario, endTurn, expectBoard, expectEliminated, expectLp, expectPrompt, expectTurn, surrender, expectNotOffered, expectPickSeats, pickOpponent, specialSummon, yes,
  type BoardExpect, type DuelistExpect, type Scenario, type Step,
} from "../../support/dsl.js";
import { ELF, SOURCE } from "./nseat-scenarios.js";

type Seat = "p0" | "p1" | "p2" | "p3";
export const OPP_PICK = `${SOURCE} [R-COMMON-OPP-PICK]`;
export const OPP_FIELD = `${SOURCE} [R-COMMON-OPP-FIELD]`;

/**
 * The state of EVERY seat of a format, exact for the monster zones, the Spell and Trap zones, the Graveyard, the banished zone and
 * the Life Points (8000 for a seat, 16000 for the team of a Tag duel, unless given). A seat that the spec leaves out must be empty. The hand is checked only when the spec names it.
 */
export function everySeat(format: "ffa3" | "ffa4" | "tag", spec: Partial<Record<Seat, DuelistExpect>>): Step {
  const seats: Seat[] = format === "ffa3" ? ["p0", "p1", "p2"] : ["p0", "p1", "p2", "p3"];
  const board: BoardExpect = {};
  for (const seat of seats) board[seat] = { lp: format === "tag" ? 16000 : 8000, monsters: [], spells: [], grave: [], banished: [], ...spec[seat] };
  return expectBoard(board);
}

const PUDICA = "Traptrix Pudica";
const CYBER = "Cyber Dragon";

export const TABLE_CARD_SCENARIOS: Scenario[] = [
  defineScenario({
    id: "table-ffa3-pudica-standby-return-goes-to-the-controller-of-the-banished-monster",
    title: "FFA3: after Traptrix Pudica banished the monster of p2, the offer to Special Summon it comes to p2 (not to the turn player p1) in the next Standby Phase, and the monster returns to p2",
    source: OPP_PICK,
    rules: ["R-COMMON-OPP-PICK", "R-COMMON-OPP-FIELD"],
    tags: ["multiplayer", "chooser", "trigger", "ffa3", "card:49027020"],
    // Cyber Dragon Special Summons itself from the hand when its controller has no monster and an opponent has one. p0 keeps one monster.
    setup: {
      format: "ffa3",
      p0: { hand: ["Monster Reborn"], monsters: [ELF], grave: [PUDICA] },
      p1: { hand: [CYBER] },
      p2: { hand: [CYBER] },
    },
    steps: [
      endTurn("p0"),
      specialSummon(CYBER, "p1"),
      endTurn("p1"),
      specialSummon(CYBER, "p2"),
      endTurn("p2"),
      activate("Monster Reborn", "p0"),
      yes("p0"),
      expectPickSeats(["p1", "p2"], "p0"),
      pickOpponent("p2", "p0"),
      everySeat("ffa3", { p0: { monsters: [ELF, PUDICA], grave: ["Monster Reborn"] }, p1: { monsters: [CYBER] }, p2: { banished: [CYBER] } }),
      // The Standby Phase of p1: the controller of the banished monster is p2, so p2 is asked.
      endTurn("p0"),
      yes("p2"),
      everySeat("ffa3", { p0: { monsters: [ELF, PUDICA], grave: ["Monster Reborn"] }, p1: { monsters: [CYBER] }, p2: { monsters: [CYBER] } }),
    ],
  }),
  defineScenario({
    id: "table-tag-pudica-standby-return-goes-to-the-duelist-that-controlled-the-banished-monster",
    title: "Tag: after Traptrix Pudica banished the monster of p3, the offer comes to p3 (not to p1, the turn player of the same team) in the Standby Phase of p1, and the monster returns to p3",
    source: OPP_PICK,
    rules: ["R-COMMON-OPP-PICK", "R-COMMON-OPP-FIELD", "R-TAG-ORDER"],
    tags: ["multiplayer", "chooser", "trigger", "tag", "card:49027020"],
    // Team 0 is p0 and p2, team 1 is p1 and p3. Only p3 has a Cyber Dragon; the effect value keeps the seat p3, not the team.
    setup: {
      format: "tag",
      p0: { hand: ["Monster Reborn"], monsters: [ELF], grave: [PUDICA] },
      p1: {},
      p2: {},
      p3: { hand: [CYBER] },
    },
    steps: [
      endTurn("p0"),
      endTurn("p1"),
      endTurn("p2"),
      specialSummon(CYBER, "p3"),
      endTurn("p3"),
      activate("Monster Reborn", "p0"),
      yes("p0"),
      // In Tag the chooser also asks for one duelist of the opposing team: p1 has no monster, p3 has the Cyber Dragon.
      expectPickSeats(["p1", "p3"], "p0"),
      pickOpponent("p3", "p0"),
      everySeat("tag", { p0: { monsters: [ELF, PUDICA], grave: ["Monster Reborn"] }, p3: { banished: [CYBER] } }),
      // The Standby Phase of p1: the controller of the banished monster is p3.
      endTurn("p0"),
      yes("p3"),
      everySeat("tag", { p0: { monsters: [ELF, PUDICA], grave: ["Monster Reborn"] }, p3: { monsters: [CYBER] } }),
    ],
  }),
  defineScenario({
    id: "table-ffa3-pudica-controller-eliminated-before-the-standby-phase-no-offer-and-no-error",
    title: "FFA3: p2 is eliminated after Traptrix Pudica banished its monster: the Standby Phase of p1 gives no offer to p1 or p0, and there is no Lua error (OQ3)",
    source: OPP_PICK,
    rules: ["R-COMMON-OPP-PICK", "R-FFA-ELIMINATION"],
    tags: ["multiplayer", "chooser", "trigger", "elimination", "ffa3", "card:49027020"],
    setup: {
      format: "ffa3",
      p0: { hand: ["Monster Reborn"], monsters: [ELF], grave: [PUDICA] },
      p1: { hand: [CYBER], monsters: [] },
      p2: { hand: [CYBER] },
    },
    steps: [
      endTurn("p0"),
      specialSummon(CYBER, "p1"),
      endTurn("p1"),
      specialSummon(CYBER, "p2"),
      endTurn("p2"),
      activate("Monster Reborn", "p0"),
      yes("p0"),
      pickOpponent("p2", "p0"),
      // The loss lands at the next Adjust, which is the end of the action prompt of p0. The cards of p2 leave the duel with it. The Standby Phase of p1 starts
      // after that: the effect value names p2, which is dead, so nobody is asked and no script fails.
      surrender("p2"),
      endTurn("p0"),
      expectEliminated("p2"),
      expectTurn("p1"),
      expectPrompt({ by: "p1", context: "action" }),
      everySeat("ffa3", { p0: { monsters: [ELF, PUDICA], grave: ["Monster Reborn"] }, p1: { monsters: [CYBER] } }),
    ],
  }),
];

void [expectLp, expectNotOffered];
