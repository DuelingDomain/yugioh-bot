// Live scenarios of overlay cards that need the core seats of patch 0053 (Duel.MPSeat, Duel.MPSeatOf, Duel.MPBindSeat): the
// card names a duelist that is not the bound opponent. Plain data, also read by scripts/rule-coverage.ts;
// tests/scenarios/multiplayer/compare-extra-seats.test.ts runs them on a live core that has the seats (NSEAT_LIVE=1).
// Every scenario ends with the state of every seat. Decisions: docs/adr/0002-multiplayer-duel-rules.md.

import {
  activate, changePosition, defineScenario, endTurn, expectBoard, select, type BoardExpect, type DuelistExpect, type Scenario, type Step,
} from "../../support/dsl.js";
import { SOURCE } from "./nseat-scenarios.js";

type Seat = "p0" | "p1" | "p2" | "p3";
const OX = "Battle Ox";
const BUG = "Man-Eater Bug";
const ELF = "Mystical Elf";
const YUBEL = "Yubel";
const PHANTOM = "Phantom of Yubel";
const OPP_PICK = `${SOURCE} [R-COMMON-OPP-PICK]`;

/** The state of EVERY seat: monsters, Spell and Trap zones, Graveyard, banished zone and Life Points are exact, the hand only when the spec names it. */
function everySeat(format: "ffa3" | "ffa4" | "tag", spec: Partial<Record<Seat, DuelistExpect>>): Step {
  const seats: Seat[] = format === "ffa3" ? ["p0", "p1", "p2"] : ["p0", "p1", "p2", "p3"];
  const board: BoardExpect = {};
  for (const seat of seats) board[seat] = { lp: format === "tag" ? 16000 : 8000, monsters: [], spells: [], grave: [], banished: [], ...spec[seat] };
  return expectBoard(board);
}

export const COMPARE_EXTRA_SEAT_SCENARIOS: Scenario[] = [
  defineScenario({
    id: "compare-extra-seats-ffa3-phantom-of-yubel-controller-destroys-its-own-yubel-p1-activates",
    title: "FFA3: p1 activates a monster effect and p0 changes it with Phantom of Yubel: p0 destroys its own Yubel, nobody is asked for an opponent, the Yubel of p1 and p2 stay",
    source: OPP_PICK,
    rules: ["R-COMMON-OPP-PICK"],
    tags: ["multiplayer", "chooser", "ffa3", "card:80453041"],
    // Stock rule (checked with the 2 seat core): the changed effect makes the OTHER side of the activator destroy a Yubel monster, that is the controller of Phantom of Yubel.
    // Man-Eater Bug flips face-up (the effect is changed, so Battle Ox stays). Phantom of Yubel is the Tribute cost and goes to the Graveyard.
    setup: {
      format: "ffa3",
      p0: { hand: [YUBEL], monsters: [PHANTOM] },
      p1: { hand: [YUBEL], monsters: [{ card: BUG, pos: "set" }, OX] },
      p2: { hand: [YUBEL], monsters: [OX] },
    },
    steps: [
      endTurn("p0"),
      changePosition({ card: BUG, owner: "p1" }, "p1"),
      select({ card: OX, owner: "p1" }),
      activate(PHANTOM, "p0"),
      everySeat("ffa3", {
        p0: { hand: [], grave: [PHANTOM, YUBEL] },
        p1: { hand: [YUBEL, ELF], monsters: [BUG, OX] },
        p2: { hand: [YUBEL], monsters: [OX] },
      }),
    ],
  }),
  defineScenario({
    id: "compare-extra-seats-ffa3-phantom-of-yubel-controller-destroys-its-own-yubel-p2-activates",
    title: "FFA3: p2 activates a monster effect and p0 changes it with Phantom of Yubel: p0 destroys its own Yubel, the Yubel of p1 and p2 stay",
    source: OPP_PICK,
    rules: ["R-COMMON-OPP-PICK"],
    tags: ["multiplayer", "chooser", "ffa3", "card:80453041"],
    setup: {
      format: "ffa3",
      p0: { hand: [YUBEL], monsters: [PHANTOM] },
      p1: { hand: [YUBEL], monsters: [OX] },
      p2: { hand: [YUBEL], monsters: [{ card: BUG, pos: "set" }, OX] },
    },
    steps: [
      endTurn("p0"),
      endTurn("p1"),
      changePosition({ card: BUG, owner: "p2" }, "p2"),
      select({ card: OX, owner: "p1" }),
      activate(PHANTOM, "p0"),
      everySeat("ffa3", {
        p0: { hand: [], grave: [PHANTOM, YUBEL] },
        p1: { hand: [YUBEL, ELF], monsters: [OX] },
        p2: { hand: [YUBEL, ELF], monsters: [BUG, OX] },
      }),
    ],
  }),
  defineScenario({
    id: "compare-extra-seats-tag-phantom-of-yubel-controller-destroys-its-own-yubel",
    title: "Tag: p1 activates a monster effect and p0 changes it with Phantom of Yubel: p0 (not its partner p2) destroys its own Yubel, nobody is asked for an opponent",
    source: OPP_PICK,
    rules: ["R-COMMON-OPP-PICK"],
    tags: ["multiplayer", "chooser", "tag", "card:80453041"],
    // Team 0 is p0 and p2, team 1 is p1 and p3. p2 and p3 hold a Yubel too.
    setup: {
      format: "tag",
      p0: { hand: [YUBEL], monsters: [PHANTOM] },
      p1: { hand: [YUBEL], monsters: [{ card: BUG, pos: "set" }, OX] },
      p2: { hand: [YUBEL], monsters: [OX] },
      p3: { hand: [YUBEL] },
    },
    steps: [
      endTurn("p0"),
      changePosition({ card: BUG, owner: "p1" }, "p1"),
      select({ card: OX, owner: "p1" }),
      activate(PHANTOM, "p0"),
      everySeat("tag", {
        p0: { hand: [], grave: [PHANTOM, YUBEL] },
        p1: { hand: [YUBEL, ELF], monsters: [BUG, OX] },
        p2: { hand: [YUBEL], monsters: [OX] },
        p3: { hand: [YUBEL] },
      }),
    ],
  }),
];
