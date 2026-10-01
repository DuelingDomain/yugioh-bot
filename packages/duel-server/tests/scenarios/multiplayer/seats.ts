// Live scenarios of the seat rules in the overlay (F7 design, part P3b): R1 "each duelist" (ADR 0002, R-COMMON-EACH-PLAYER, Q3) and the Q10 script
// fixes. Plain data, also read by scripts/rule-coverage.ts; tests/scenarios/multiplayer/seats.test.ts runs them on a live core with Duel.MPNthDuelist
// (patch 0053 and later, NSEAT_LIVE=1). Every scenario uses the real card scripts plus the overlay, and ends with the state of EVERY seat.
// A Spell is activated from the hand in the own Main Phase of p0: it asks for a Spell/Trap Zone first.

import {
  activate, changePosition, defineScenario, eliminate, expectBoard, expectEliminated, expectNoPrompt, faceDown, finish, no, pass, select, yes, zone,
  type BoardExpect, type DuelistExpect, type Scenario, type Step,
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
const ELF = "Mystical Elf";
const TWO_FOR_ONE = "Two-for-One Team";
const HOLE = "Dark Hole";
const RAIGEKI = "Raigeki";
const SWORDS = "Swords of Revealing Light";
const POLY = "Polymerization";
const TIERRA = "Infernoid Tierra";
const ANTRA = "Infernoid Antra";
const ONUNCU = "Infernoid Onuncu";
const DEVYATY = "Infernoid Devyaty";
const NUMERON = "Number 39: Utopia";
const TSUMUHA = "Tsumuha-Kutsunagi the Lord of Swords";

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

  // --- Tsumuha-Kutsunagi (a script fix, Q10) ---------------------------------------------------------------------------------
  defineScenario({
    id: "seats-r1-ffa3-tsumuha-kutsunagi-each-opponent-decides-every-duelist-draws",
    title: "FFA3: p0 flips Tsumuha-Kutsunagi: p1 sends Battle Ox, p2 sends nothing: the total is 1, so p0, p1 and p2 each draw 1 card",
    source: EACH,
    rules: ["R-COMMON-EACH-PLAYER"],
    tags: ["multiplayer", "r1", "each-duelist", "q10", "ffa3", "card:78098950"],
    setup: {
      format: "ffa3",
      p0: { monsters: [faceDown(TSUMUHA)], deck: [RAT] },
      p1: { monsters: [OX], deck: [AXE] },
      p2: { monsters: [FANG], deck: [ELF] },
    },
    steps: [
      changePosition(TSUMUHA, "p0"),
      yes("p1"),
      no("p2"),
      everySeat("ffa3", {
        p0: { hand: [RAT], monsters: [TSUMUHA] },
        p1: { hand: [AXE], grave: [OX] },
        p2: { hand: [ELF], monsters: [FANG] },
      }),
    ],
  }),
  defineScenario({
    id: "seats-r1-tag-tsumuha-kutsunagi-both-opponents-send-partner-draws",
    title: "Tag: p0 flips Tsumuha-Kutsunagi: p1 and p3 (the team of p1, one pool) each send 1 card, so all four duelists (the partner p2 too) draw 2 cards and the partner sends nothing",
    source: EACH,
    rules: ["R-COMMON-EACH-PLAYER", "R-TAG-PARTNER"],
    tags: ["multiplayer", "r1", "each-duelist", "q10", "tag", "card:78098950"],
    setup: {
      format: "tag",
      p0: { monsters: [faceDown(TSUMUHA)], deck: [RAT, OX] },
      p1: { monsters: [OX], deck: [AXE, FANG] },
      p2: { monsters: [ELF], deck: [RAT, AXE] },
      p3: { monsters: [FANG], deck: [OX, ELF] },
    },
    steps: [
      changePosition(TSUMUHA, "p0"),
      // In Tag the side of p1 is its team: p1 and p3 choose from the same pool (Battle Ox, Silver Fang), one after the other.
      yes("p1"),
      select(OX),
      yes("p3"),
      everySeat("tag", {
        p0: { hand: [RAT, OX], monsters: [TSUMUHA] },
        p1: { hand: [AXE, FANG], grave: [OX] },
        p2: { hand: [RAT, AXE], monsters: [ELF] },
        p3: { hand: [OX, ELF], grave: [FANG] },
      }),
    ],
  }),

  // --- Two-for-One Team (a script fix, Q10) ----------------------------------------------------------------------------------
  defineScenario({
    id: "seats-r1-ffa3-two-for-one-team-all-spells-every-duelist-draws-2",
    title: "FFA3: p0 activates Two-for-One Team and all three duelists show a Spell: p0, p1 and p2 each draw 2 cards",
    source: EACH,
    rules: ["R-COMMON-EACH-PLAYER"],
    tags: ["multiplayer", "r1", "each-duelist", "q10", "ffa3", "card:89928517"],
    setup: {
      format: "ffa3",
      p0: { monsters: [TWO_FOR_ONE], hand: [HOLE], deck: [RAT, OX] },
      p1: { hand: [RAIGEKI], deck: [AXE, FANG] },
      p2: { hand: [SWORDS], deck: [ELF, RAT] },
    },
    steps: [
      activate(TWO_FOR_ONE, "p0"),
      everySeat("ffa3", {
        p0: { hand: [HOLE, RAT, OX], monsters: [TWO_FOR_ONE] },
        p1: { hand: [RAIGEKI, AXE, FANG] },
        p2: { hand: [SWORDS, ELF, RAT] },
      }),
    ],
  }),
  defineScenario({
    id: "seats-r1-ffa3-two-for-one-team-all-monsters-each-may-summon",
    title: "FFA3: all three duelists show a Monster: p0 and p2 say yes and Special Summon theirs, p1 says no and keeps it in the hand",
    source: EACH,
    rules: ["R-COMMON-EACH-PLAYER"],
    tags: ["multiplayer", "r1", "each-duelist", "q10", "ffa3", "card:89928517"],
    setup: {
      format: "ffa3",
      p0: { monsters: [TWO_FOR_ONE], hand: [RAT] },
      p1: { hand: [OX] },
      p2: { hand: [AXE] },
    },
    steps: [
      activate(TWO_FOR_ONE, "p0"),
      yes("p0"),
      no("p1"),
      yes("p2"),
      everySeat("ffa3", {
        p0: { monsters: [TWO_FOR_ONE, RAT] },
        p1: { hand: [OX] },
        p2: { monsters: [AXE] },
      }),
    ],
  }),
  defineScenario({
    id: "seats-r1-ffa3-two-for-one-team-mixed-types-nothing-happens",
    title: "FFA3: p0 shows a Spell, p1 a Monster and p2 a Spell: the types differ, so nobody draws, summons or sends a card",
    source: EACH,
    rules: ["R-COMMON-EACH-PLAYER"],
    tags: ["multiplayer", "r1", "each-duelist", "q10", "ffa3", "card:89928517"],
    setup: {
      format: "ffa3",
      p0: { monsters: [TWO_FOR_ONE], hand: [HOLE], deck: [RAT] },
      p1: { hand: [OX], deck: [AXE] },
      p2: { hand: [SWORDS], deck: [ELF] },
    },
    steps: [
      activate(TWO_FOR_ONE, "p0"),
      everySeat("ffa3", {
        p0: { hand: [HOLE], monsters: [TWO_FOR_ONE] },
        p1: { hand: [OX] },
        p2: { hand: [SWORDS] },
      }),
    ],
  }),
  defineScenario({
    id: "seats-r1-tag-two-for-one-team-all-spells-partner-draws",
    title: "Tag: all four duelists show a Spell: p0, p1, p2 (the partner) and p3 each draw 2 cards",
    source: EACH,
    rules: ["R-COMMON-EACH-PLAYER", "R-TAG-PARTNER"],
    tags: ["multiplayer", "r1", "each-duelist", "q10", "tag", "card:89928517"],
    setup: {
      format: "tag",
      p0: { monsters: [TWO_FOR_ONE], hand: [HOLE], deck: [RAT, OX] },
      p1: { hand: [RAIGEKI], deck: [AXE, FANG] },
      p2: { hand: [SWORDS], deck: [ELF, RAT] },
      p3: { hand: ["Pot of Greed"], deck: [OX, AXE] },
    },
    steps: [
      activate(TWO_FOR_ONE, "p0"),
      everySeat("tag", {
        p0: { hand: [HOLE, RAT, OX], monsters: [TWO_FOR_ONE] },
        p1: { hand: [RAIGEKI, AXE, FANG] },
        p2: { hand: [SWORDS, ELF, RAT] },
        p3: { hand: ["Pot of Greed", OX, AXE] },
      }),
    ],
  }),
  // --- Infernoid Tierra (a script fix, Q10) ----------------------------------------------------------------------------------
  defineScenario({
    id: "seats-r1-ffa3-infernoid-tierra-every-duelist-sends-3-extra-deck-cards",
    title: "FFA3: p0 Fusion Summons Infernoid Tierra with 3 different Infernoid names: p0, p1 and p2 each send 3 cards from the Extra Deck to the GY",
    source: EACH,
    rules: ["R-COMMON-EACH-PLAYER"],
    tags: ["multiplayer", "r1", "each-duelist", "q10", "ffa3", "card:82734805"],
    setup: {
      format: "ffa3",
      p0: { hand: [POLY], monsters: [ANTRA, ONUNCU, DEVYATY], extra: [TIERRA, NUMERON, NUMERON, NUMERON] },
      p1: { extra: [NUMERON, NUMERON, NUMERON] },
      p2: { extra: [NUMERON, NUMERON, NUMERON] },
    },
    steps: [
      activate(POLY, "p0"),
      zone("p0", "s0", "p0"),
      pass("p0"),
      select(ANTRA),
      select(ONUNCU),
      select(DEVYATY),
      yes("p0"),
      everySeat("ffa3", {
        p0: { monsters: [TIERRA], grave: [POLY, ANTRA, ONUNCU, DEVYATY, NUMERON, NUMERON, NUMERON], extra: [] },
        p1: { grave: [NUMERON, NUMERON, NUMERON], extra: [] },
        p2: { grave: [NUMERON, NUMERON, NUMERON], extra: [] },
      }),
    ],
  }),
];
