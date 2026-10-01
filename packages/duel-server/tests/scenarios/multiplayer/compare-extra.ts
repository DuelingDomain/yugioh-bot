// More live scenarios of the compare and chooser overlay (F7 design, part P3b): cards whose later effects or whose one-opponent
// reads (`IsControler(1-tp)`, `rp==1-tp`) run inside a one-opponent window, and the chain of three seats of the design (W10).
// Plain data, also read by scripts/rule-coverage.ts; tests/scenarios/multiplayer/compare-extra.test.ts runs them on a live core
// (NSEAT_LIVE=1). Every scenario ends with the state of every seat. Decisions: docs/adr/0002-multiplayer-duel-rules.md.

import {
  activate, attack, changePhase, changePosition, defineScenario, endTurn, expectBoard, expectNotOffered, expectOffered,
  expectPickOptions, expectPickSeats, pass, pickOpponent, select, specialSummon, yes, type BoardExpect, type DuelistExpect, type Scenario, type Step,
} from "../../support/dsl.js";
import { ELF, SOURCE } from "./nseat-scenarios.js";

type Seat = "p0" | "p1" | "p2" | "p3";
// The windows of a turn in which p0 may chain its set Ultimate Sky: p0 passes each one.
const passWindows = (seat: Seat, count: number): Step[] => Array.from({ length: count }, () => pass(seat));
const passTurns = (...seats: Seat[]): Step[] => seats.map((seat) => endTurn(seat));
const RAT = "Giant Rat";
const OX = "Battle Ox";
const GUARDIAN = "Celtic Guardian";
const SANGAN = "Sangan";
const WITCH = "Witch of the Black Forest";
const NUMERON = "Number 100: Numeron Dragon";
const DIAN = "Dian Keto the Cure Master";
const ECCLESIA = "Incredible Ecclesia, the Virtuous";
const ACCUSATION = "Mistaken Accusation";
const BUG = "Man-Eater Bug";
const OPP_PICK = `${SOURCE} [R-COMMON-OPP-PICK]`;

/**
 * The state of EVERY seat of a format, exact for the monster zones, the Spell and Trap zones, the Graveyard, the banished zone and
 * the Life Points (8000 for a seat, 16000 for the team of a Tag duel, unless given). A seat that the spec leaves out must be empty. The hand is checked only when the spec names it.
 */
function everySeat(format: "ffa3" | "ffa4" | "tag", spec: Partial<Record<Seat, DuelistExpect>>): Step {
  const seats: Seat[] = format === "ffa3" ? ["p0", "p1", "p2"] : ["p0", "p1", "p2", "p3"];
  const board: BoardExpect = {};
  for (const seat of seats) board[seat] = { lp: format === "tag" ? 16000 : 8000, monsters: [], spells: [], grave: [], banished: [], ...spec[seat] };
  return expectBoard(board);
}

export const COMPARE_EXTRA_SCENARIOS: Scenario[] = [
  defineScenario({
    id: "compare-extra-ffa3-kuribabylon-no-single-opponent-has-fewer",
    title: "FFA3: Kuribabylon is not offered when no single opponent has fewer monsters in the Graveyard than p0, and no seat changes",
    source: OPP_PICK,
    rules: ["R-COMMON-OPP-PICK"],
    tags: ["multiplayer", "compare", "ffa3", "card:70914287"],
    // p0 has 2 monsters in the Graveyard, p1 has 2 and p2 has 3: the compare is false for each opponent.
    setup: { format: "ffa3", p0: { hand: ["Kuribabylon"], grave: [ELF, RAT] }, p1: { grave: [SANGAN, WITCH] }, p2: { grave: [BUG, OX, GUARDIAN] } },
    steps: [
      expectNotOffered("activate", "Kuribabylon", "p0"),
      endTurn("p0"),
      everySeat("ffa3", { p0: { hand: ["Kuribabylon"], grave: [ELF, RAT] }, p1: { grave: [SANGAN, WITCH] }, p2: { grave: [BUG, OX, GUARDIAN] } }),
    ],
  }),
  defineScenario({
    id: "compare-extra-tag-kuribabylon-joined-graveyard-passes",
    title: "Tag: Kuribabylon compares the joined Graveyard of the opposing team: 1 monster against the 2 of p0 is offered and the Special Summon resolves",
    source: OPP_PICK,
    rules: ["R-COMMON-OPP-PICK"],
    tags: ["multiplayer", "compare", "tag", "card:70914287"],
    // Team 0 is p0 and p2, team 1 is p1 and p3. The opposing team has 1 monster in the Graveyard in all.
    setup: { format: "tag", p0: { hand: ["Kuribabylon"], grave: [ELF, RAT] }, p1: { grave: [SANGAN] }, p3: {} },
    steps: [
      activate("Kuribabylon", "p0"),
      everySeat("tag", { p0: { monsters: ["Kuribabylon"], hand: [], grave: [ELF, RAT] }, p1: { grave: [SANGAN] } }),
    ],
  }),
  defineScenario({
    id: "compare-extra-tag-kuribabylon-joined-graveyard-fails",
    title: "Tag: each opposing duelist has fewer monsters in the Graveyard than p0 (1 and 1 against 2), but the joined Graveyard has 2: Kuribabylon is not offered",
    source: OPP_PICK,
    rules: ["R-COMMON-OPP-PICK"],
    tags: ["multiplayer", "compare", "tag", "card:70914287"],
    setup: { format: "tag", p0: { hand: ["Kuribabylon"], grave: [ELF, RAT] }, p1: { grave: [SANGAN] }, p3: { grave: [WITCH] } },
    steps: [
      expectNotOffered("activate", "Kuribabylon", "p0"),
      endTurn("p0"),
      everySeat("tag", { p0: { hand: ["Kuribabylon"], grave: [ELF, RAT] }, p1: { grave: [SANGAN] }, p3: { grave: [WITCH] } }),
    ],
  }),
  defineScenario({
    id: "compare-extra-ffa3-guan-yun-destroy-picked-opponent",
    title: "FFA3: Loyal Guan Yun is offered its destroy effect when ONE opponent controls more monsters, asks which opponent and destroys a monster of that opponent only",
    source: OPP_PICK,
    rules: ["R-COMMON-OPP-PICK"],
    tags: ["multiplayer", "compare", "chooser", "ffa3", "card:76416959"],
    // p0 controls 1 monster, p1 has 1 (not more) and p2 has 3 (more). The target tests IsControler(1-tp) inside the window of the picked seat.
    setup: {
      format: "ffa3",
      p0: { monsters: ["Ancient Warriors - Loyal Guan Yun"] },
      p1: { monsters: [SANGAN] },
      p2: { monsters: [WITCH, BUG, OX] },
    },
    steps: [
      activate("Ancient Warriors - Loyal Guan Yun", "p0"),
      // Only p2 controls more monsters than p0, so no pick is asked: p2 is the bound seat.
      select(BUG),
      everySeat("ffa3", {
        p0: { monsters: ["Ancient Warriors - Loyal Guan Yun"] },
        p1: { monsters: [SANGAN] },
        p2: { monsters: [WITCH, OX], grave: [BUG] },
      }),
    ],
  }),
  defineScenario({
    id: "compare-extra-ffa3-guan-yun-two-opponents-pass-pick-asked",
    title: "FFA3: Loyal Guan Yun asks which opponent when two opponents control more monsters, and the monster of the picked one is destroyed, not one of the other",
    source: OPP_PICK,
    rules: ["R-COMMON-OPP-PICK"],
    tags: ["multiplayer", "compare", "chooser", "ffa3", "card:76416959"],
    setup: {
      format: "ffa3",
      p0: { monsters: ["Ancient Warriors - Loyal Guan Yun"] },
      p1: { monsters: [SANGAN, WITCH] },
      p2: { monsters: [BUG, OX] },
    },
    steps: [
      activate("Ancient Warriors - Loyal Guan Yun", "p0"),
      expectPickSeats(["p1", "p2"], "p0"),
      pickOpponent("p1", "p0"),
      // The target step sees the monsters of p1 only.
      select(WITCH),
      everySeat("ffa3", {
        p0: { monsters: ["Ancient Warriors - Loyal Guan Yun"] },
        p1: { monsters: [SANGAN], grave: [WITCH] },
        p2: { monsters: [BUG, OX] },
      }),
    ],
  }),
  defineScenario({
    id: "compare-extra-ffa3-guan-yun-special-summon-from-hand",
    title: "FFA3: Loyal Guan Yun Special Summons itself from the hand when p0 has no monster and only ONE opponent has a monster",
    source: OPP_PICK,
    rules: ["R-COMMON-OPP-PICK"],
    tags: ["multiplayer", "compare", "ffa3", "card:76416959"],
    setup: { format: "ffa3", p0: { hand: ["Ancient Warriors - Loyal Guan Yun"] }, p1: {}, p2: { monsters: [OX] } },
    steps: [
      activate("Ancient Warriors - Loyal Guan Yun", "p0"),
      everySeat("ffa3", { p0: { monsters: ["Ancient Warriors - Loyal Guan Yun"], hand: [] }, p2: { monsters: [OX] } }),
    ],
  }),
  defineScenario({
    id: "compare-extra-ffa3-pudica-banish-picked-opponent",
    title: "FFA3: Traptrix Pudica banishes a Special Summoned monster of the picked opponent; the monsters of the other opponent stay",
    source: OPP_PICK,
    rules: ["R-COMMON-OPP-PICK"],
    tags: ["multiplayer", "chooser", "trigger", "ffa3", "card:49027020"],
    // The Standby Phase return is NOT asserted: with core P52 the overlay stores the folded seat 1 in the effect value, so the prompt goes to the turn player, not to the picked
    // opponent (finding for the core seat API, patch 0053: Duel.MPSeat). Cyber Dragon Special Summons itself from the hand when its controller has no monster and an opponent has one. p0 keeps one monster.
    setup: {
      format: "ffa3",
      p0: { hand: ["Monster Reborn"], monsters: [ELF], grave: ["Traptrix Pudica"] },
      p1: { hand: ["Cyber Dragon"] },
      p2: { hand: ["Cyber Dragon"] },
    },
    steps: [
      endTurn("p0"),
      specialSummon("Cyber Dragon", "p1"),
      endTurn("p1"),
      specialSummon("Cyber Dragon", "p2"),
      endTurn("p2"),
      activate("Monster Reborn", "p0"),
      yes("p0"),
      expectPickSeats(["p1", "p2"], "p0"),
      pickOpponent("p2", "p0"),
      everySeat("ffa3", { p0: { monsters: [ELF, "Traptrix Pudica"], grave: ["Monster Reborn"] }, p1: { monsters: ["Cyber Dragon"] }, p2: { banished: ["Cyber Dragon"] } }),
    ],
  }),
  defineScenario({
    id: "compare-extra-ffa3-phantom-of-yubel-offered-for-each-opponent-effect",
    title: "FFA3: Phantom of Yubel (rp==1-tp) is offered when p1 activates a monster effect, and when p2 does; p0 passes and both effects resolve unchanged",
    source: OPP_PICK,
    rules: ["R-COMMON-OPP-PICK"],
    tags: ["multiplayer", "chooser", "ffa3", "card:80453041"],
    // The operation of Phantom of Yubel is NOT run here: with core P52 it asks p1 for an opponent and destroys the Yubel of THAT opponent (finding, patch 0053 Duel.MPSeat).
    setup: {
      format: "ffa3",
      p0: { hand: ["Yubel"], monsters: ["Phantom of Yubel"] },
      p1: { monsters: [{ card: BUG, pos: "set" }] },
      p2: { monsters: [{ card: BUG, pos: "set" }, OX] },
    },
    steps: [
      endTurn("p0"),
      changePosition({ card: BUG, owner: "p1" }, "p1"),
      select(OX),
      expectPickOptions({ include: [{ card: "Phantom of Yubel" }] }, "p0"),
      pass("p0"),
      endTurn("p1"),
      changePosition({ card: BUG, owner: "p2" }, "p2"),
      select({ card: BUG, owner: "p1" }),
      expectPickOptions({ include: [{ card: "Phantom of Yubel" }] }, "p0"),
      pass("p0"),
      everySeat("ffa3", {
        p0: { hand: ["Yubel"], monsters: ["Phantom of Yubel"] },
        p1: { grave: [BUG] },
        p2: { monsters: [BUG], grave: [OX] },
      }),
    ],
  }),
  defineScenario({
    id: "compare-extra-ffa3-numeron-dragon-summons-itself-when-p0-is-attacked-directly",
    title: "FFA3: Number 100: Numeron Dragon (spcon unchanged) is offered from the Graveyard when p1 attacks p0 directly and p0 has no card on the field or in the hand",
    source: OPP_PICK,
    rules: ["R-COMMON-OPP-PICK"],
    tags: ["multiplayer", "chooser", "trigger", "ffa3", "card:57314798"],
    // A Xyz monster in the Graveyard of the setup was never properly summoned, so it cannot return. Numeron Dragon starts on the field and Elf destroys it in battle.
    // p0 does not draw on turn 1 and draws a Dian Keto on turn 4, which p0 plays, so the hand and the field are empty when the Rat attacks directly.
    setup: { format: "ffa3", p0: { monsters: [NUMERON], deck: [DIAN] }, p1: { monsters: [ELF, RAT] }, p2: {} },
    steps: [
      endTurn("p0"),
      endTurn("p1"),
      endTurn("p2"),
      activate(DIAN, "p0"),
      endTurn("p0"),
      changePhase("battle", "p1"),
      attack(ELF, { card: NUMERON, owner: "p0" }, "p1"),
      attack(RAT, "direct", "p1"),
      pickOpponent("p0", "p1"),
      yes("p0"),
      everySeat("ffa3", { p0: { lp: 8200, monsters: [NUMERON], grave: [DIAN] }, p1: { monsters: [ELF, RAT] } }),
    ],
  }),
  defineScenario({
    id: "compare-extra-ffa3-numeron-dragon-is-offered-to-p0-also-when-p2-is-attacked",
    title: "FFA3: Number 100: Numeron Dragon (spcon unchanged) is offered to p0 also when p1 attacks p2 directly (the stock condition does not read the attacked duelist; owner decision open), and p0 may summon it",
    source: OPP_PICK,
    rules: ["R-COMMON-OPP-PICK"],
    tags: ["multiplayer", "chooser", "trigger", "ffa3", "card:57314798"],
    // A Xyz monster in the Graveyard of the setup was never properly summoned, so it cannot return. Numeron Dragon starts on the field and Elf destroys it in battle.
    // p0 does not draw on turn 1 and draws a Dian Keto on turn 4, which p0 plays, so the hand and the field are empty when the Rat attacks directly.
    setup: { format: "ffa3", p0: { monsters: [NUMERON], deck: [DIAN] }, p1: { monsters: [ELF, RAT] }, p2: {} },
    steps: [
      endTurn("p0"),
      endTurn("p1"),
      endTurn("p2"),
      activate(DIAN, "p0"),
      endTurn("p0"),
      changePhase("battle", "p1"),
      attack(ELF, { card: NUMERON, owner: "p0" }, "p1"),
      attack(RAT, "direct", "p1"),
      pickOpponent("p2", "p1"),
      // The stock condition reads "attacker is an opponent, no attack target, my field and hand are empty": it does not check who is attacked.
      yes("p0"),
      everySeat("ffa3", { p0: { lp: 8200, monsters: [NUMERON], grave: [DIAN] }, p1: { monsters: [ELF, RAT] } }),
    ],
  }),
  defineScenario({
    id: "compare-extra-ffa3-ecclesia-summon-procedure-one-opponent-has-more",
    title: "FFA3: Incredible Ecclesia, the Virtuous (summon procedure, a real compare of item 4) is offered when ONE opponent controls more monsters, and it is summoned",
    source: OPP_PICK,
    rules: ["R-COMMON-OPP-PICK"],
    tags: ["multiplayer", "compare", "ffa3", "card:55273560"],
    // p0 has 1 monster. p1 has 1 (equal), p2 has 2 (more): p2 passes, so the procedure is open.
    setup: { format: "ffa3", p0: { hand: [ECCLESIA], monsters: [ELF] }, p1: { monsters: [SANGAN] }, p2: { monsters: [WITCH, BUG] } },
    steps: [
      expectOffered("specialSummon", ECCLESIA, "p0"),
      specialSummon(ECCLESIA, "p0"),
      everySeat("ffa3", { p0: { hand: [], monsters: [ELF, ECCLESIA] }, p1: { monsters: [SANGAN] }, p2: { monsters: [WITCH, BUG] } }),
    ],
  }),
  defineScenario({
    id: "compare-extra-ffa3-ecclesia-summon-procedure-no-single-opponent-has-more",
    title: "FFA3: Incredible Ecclesia, the Virtuous is NOT offered when the opponents have more monsters together (2) but no single opponent has more than p0 (1 each)",
    source: OPP_PICK,
    rules: ["R-COMMON-OPP-PICK"],
    tags: ["multiplayer", "compare", "ffa3", "card:55273560"],
    setup: { format: "ffa3", p0: { hand: [ECCLESIA], monsters: [ELF] }, p1: { monsters: [SANGAN] }, p2: { monsters: [WITCH] } },
    steps: [
      expectNotOffered("specialSummon", ECCLESIA, "p0"),
      endTurn("p0"),
      everySeat("ffa3", { p0: { hand: [ECCLESIA], monsters: [ELF] }, p1: { monsters: [SANGAN] }, p2: { monsters: [WITCH] } }),
    ],
  }),
  defineScenario({
    id: "compare-extra-ffa3-mistaken-accusation-one-opponent-has-more-cards",
    title: "FFA3: Mistaken Accusation (a real compare of item 4, cards in the hand and on the field) is offered when ONE opponent has more cards than p0",
    source: OPP_PICK,
    rules: ["R-COMMON-OPP-PICK"],
    tags: ["multiplayer", "compare", "ffa3", "card:89883517"],
    // p0 has 1 card (the set trap). p1 has 1 (equal), p2 has 2 (more).
    setup: { format: "ffa3", p0: { spells: [{ card: ACCUSATION, pos: "set" }] }, p1: { monsters: [SANGAN] }, p2: { monsters: [WITCH, BUG] } },
    steps: [
      activate(ACCUSATION, "p0"),
      select(WITCH),
      everySeat("ffa3", { p0: { grave: [ACCUSATION] }, p1: { monsters: [SANGAN] }, p2: { monsters: [WITCH, BUG] } }),
    ],
  }),
  defineScenario({
    id: "compare-extra-ffa3-mistaken-accusation-no-single-opponent-has-more",
    title: "FFA3: Mistaken Accusation is NOT offered when the opponents have more cards together (2) but no single opponent has more than p0 (1 each)",
    source: OPP_PICK,
    rules: ["R-COMMON-OPP-PICK"],
    tags: ["multiplayer", "compare", "ffa3", "card:89883517"],
    setup: { format: "ffa3", p0: { spells: [{ card: ACCUSATION, pos: "set" }] }, p1: { monsters: [SANGAN] }, p2: { monsters: [WITCH] } },
    steps: [
      expectNotOffered("activate", ACCUSATION, "p0"),
      endTurn("p0"),
      everySeat("ffa3", { p0: { spells: [ACCUSATION] }, p1: { monsters: [SANGAN] }, p2: { monsters: [WITCH] } }),
    ],
  }),
  defineScenario({
    id: "compare-extra-ffa3-w10-sky-and-evenly-matched-chain",
    title: "FFA3 (W10, two links): Ultimate Sky of p0 on p1 and Evenly Matched of p1 on p0 in one chain: each link reads only its own opponent, p2 is not touched",
    source: OPP_PICK,
    rules: ["R-COMMON-OPP-PICK", "R-FFA-CHAIN"],
    tags: ["multiplayer", "compare", "chain", "ffa3", "card:38817295", "card:15693423"],
    // The third link of W10 (Scramble!! Scramble!! of p2, with a Mecha Phantom Beast token) is not driven: p2 is never offered it, see the report.
    // p0 has 5 cards on the field (Elf and 4 set Spells), p1 has 3 (2 monsters and the set Trap). Evenly Matched: p0 banishes 5 - 3 = 2 of its own cards.
    setup: {
      format: "ffa3",
      p0: { monsters: [ELF], spells: [{ card: "Ultimate Sky", pos: "set" }, { card: "Raigeki", pos: "set" }, { card: "Dark Hole", pos: "set" }, { card: "Hinotama", pos: "set" }] },
      p1: { monsters: [WITCH, BUG], spells: [{ card: "Evenly Matched", pos: "set" }] },
      p2: { monsters: [OX] },
    },
    steps: [
      endTurn("p0"),
      ...passWindows("p0", 4),
      endTurn("p1"),
      ...passWindows("p0", 5),
      endTurn("p2"),
      ...passWindows("p0", 5),
      changePhase("battle", "p0"),
      ...passWindows("p0", 1),
      changePhase("main2", "p0"),
      activate("Ultimate Sky", "p0"),
      select(WITCH),
      activate("Evenly Matched", "p1"),
      select("Raigeki", "Dark Hole"),
      everySeat("ffa3", {
        p0: { lp: 7200, monsters: [ELF], spells: ["Hinotama"], grave: ["Ultimate Sky"], banished: ["Raigeki", "Dark Hole"] },
        p1: { monsters: [WITCH, BUG], grave: ["Evenly Matched"] },
        p2: { monsters: [OX] },
      }),
    ],
  }),
];
