// Live scenarios of the compare and chooser overlay (F7 design, part P3a): count and compare cards ("your opponent controls more
// monsters than you do") and "your opponent chooses" cards at FFA3, FFA4 and Tag. Plain data, also read by scripts/rule-coverage.ts;
// tests/scenarios/multiplayer/compare.test.ts runs them on a live core (NSEAT_LIVE=1) with the overlay of domain-core/multi-scripts.
// Decisions: docs/adr/0002-multiplayer-duel-rules.md (question 2 and 5). FFA: the activator picks ONE opponent and compares with that
// opponent only. Tag: the joined field of the two opposing duelists, and the picked opposing duelist chooses.

import {
  activate, changePhase, defineScenario, endTurn, expectBoard, expectNotOffered, expectPickSeats,
  normalSummon, pickOpponent, select, expectTurn, specialSummon, yes, type Scenario, type Step,
} from "../../support/dsl.js";
import { ELF, SOURCE } from "./nseat-scenarios.js";

type Seat = "p0" | "p1" | "p2" | "p3";
const passTurns = (...seats: Seat[]): Step[] => seats.map((seat) => endTurn(seat));
// Vanilla monsters with no effect that matters here.
const RAT = "Giant Rat";
const OX = "Battle Ox";
const GUARDIAN = "Celtic Guardian";
const AXE = "Axe Raider";
const FANG = "Silver Fang";
const BEAVER = "Beaver Warrior";
// Effect monsters, so that Ultimate Sky can negate them.
const SANGAN = "Sangan";
const WITCH = "Witch of the Black Forest";
const BUG = "Man-Eater Bug";
const OPP_PICK = `${SOURCE} [R-COMMON-OPP-PICK]`;

export const COMPARE_SCENARIOS: Scenario[] = [
  defineScenario({
    id: "compare-ffa3-activation-condition-one-opponent",
    title: "FFA3: Ultimate Sky is offered when ONE opponent controls more monsters, and the activation resolves (W1)",
    source: OPP_PICK,
    rules: ["R-COMMON-OPP-PICK"],
    tags: ["multiplayer", "compare", "ffa3", "card:38817295"],
    // p0 has 2 monsters. p1 has 1 (fewer), p2 has 3 (more). Only p2 passes the compare, so the card is offered and p2 is the bound seat.
    setup: {
      format: "ffa3",
      p0: { hand: ["Ultimate Sky"], monsters: [ELF, RAT] },
      p1: { monsters: [SANGAN] },
      p2: { monsters: [WITCH, BUG, "Mystical Elf - White Lightning"] },
    },
    steps: [
      activate("Ultimate Sky", "p0"),
      select(WITCH),
      expectBoard({ p0: { lp: 7200 } }),
    ],
  }),
  defineScenario({
    id: "compare-ffa3-sum-passes-no-single-opponent",
    title: "FFA3: the monsters of two opponents together beat yours but no single opponent does: Pineapple Blast is not offered (W2)",
    source: OPP_PICK,
    rules: ["R-COMMON-OPP-PICK"],
    tags: ["multiplayer", "compare", "ffa3", "card:90669991"],
    setup: {
      format: "ffa3",
      p0: { hand: [BEAVER], spells: [{ card: "Pineapple Blast", pos: "set" }] },
      p1: { monsters: [OX] },
      p2: { monsters: [GUARDIAN] },
    },
    steps: [
      normalSummon(BEAVER, "p0"),
      expectNotOffered("choice", "Pineapple Blast", "p0"),
      expectBoard({ p0: { monsters: [BEAVER] }, p1: { monsters: [OX] }, p2: { monsters: [GUARDIAN] } }),
    ],
  }),
  defineScenario({
    id: "compare-ffa3-first-opponent-fails-second-passes",
    title: "FFA3: p0 controls more monsters than the first opponent but fewer than the second: Pineapple Blast is offered and hits the second (W3)",
    source: OPP_PICK,
    rules: ["R-COMMON-OPP-PICK"],
    tags: ["multiplayer", "compare", "ffa3", "card:90669991"],
    setup: {
      format: "ffa3",
      p0: { hand: [BEAVER], monsters: [ELF], spells: [{ card: "Pineapple Blast", pos: "set" }] },
      p1: { monsters: [SANGAN] },
      p2: { monsters: [WITCH, BUG, OX] },
    },
    steps: [
      normalSummon(BEAVER, "p0"),
      activate("Pineapple Blast", "p0"),
      // p2 keeps as many monsters as p0 controls (2) and the rest is destroyed. p1 is not touched.
      select(WITCH, BUG),
      expectBoard({ p0: { monsters: [ELF, BEAVER] }, p1: { monsters: [SANGAN] }, p2: { monsters: { count: 2, include: [WITCH, BUG] }, grave: [OX] } }),
    ],
  }),
  defineScenario({
    id: "compare-ffa3-pineapple-blast-pick-and-choice",
    title: "FFA3: Pineapple Blast asks which opponent at activation, the picked opponent chooses, only that opponent loses monsters (W4r, F1)",
    source: OPP_PICK,
    rules: ["R-COMMON-OPP-PICK"],
    tags: ["multiplayer", "compare", "chooser", "ffa3", "card:90669991"],
    setup: {
      format: "ffa3",
      p0: { hand: [BEAVER], spells: [{ card: "Pineapple Blast", pos: "set" }] },
      p1: { monsters: [SANGAN, WITCH] },
      p2: { monsters: [BUG, OX, GUARDIAN] },
    },
    steps: [
      normalSummon(BEAVER, "p0"),
      activate("Pineapple Blast", "p0"),
      expectPickSeats(["p1", "p2"], "p0"),
      pickOpponent("p2", "p0"),
      // p2 keeps 1 monster (p0 controls 1) and 2 are destroyed. p1 keeps both monsters.
      select(OX),
      expectBoard({ p1: { monsters: [SANGAN, WITCH] }, p2: { monsters: [OX], grave: [BUG, GUARDIAN] } }),
    ],
  }),
  defineScenario({
    id: "compare-ffa3-window-closes-after-evenly-matched",
    title: "FFA3: after Evenly Matched resolved on one opponent, Raigeki of the same duelist destroys the monsters of EVERY opponent (W5)",
    source: `${SOURCE} [R-COMMON-OPP-FIELD]`,
    rules: ["R-COMMON-OPP-FIELD", "R-COMMON-OPP-PICK"],
    tags: ["multiplayer", "compare", "chooser", "ffa3", "card:15693423", "card:12580477"],
    // Evenly Matched is a Trap that p0 activates from the hand in the Battle Phase (no card on the field, an opponent with 2 or more).
    setup: {
      format: "ffa3",
      p0: { hand: ["Evenly Matched", "Raigeki"] },
      p1: { monsters: [SANGAN, WITCH, BUG] },
      p2: { monsters: [OX, GUARDIAN] },
    },
    steps: [
      ...passTurns("p0", "p1", "p2"),
      expectTurn("p0", 4),
      changePhase("battle", "p0"),
      // The condition reads PHASE_BATTLE, the end of the Battle Phase: the window opens when p0 leaves it.
      changePhase("main2", "p0"),
      activate("Evenly Matched", "p0"),
      expectPickSeats(["p1", "p2"], "p0"),
      pickOpponent("p1", "p0"),
      // p1 banishes 3 - 0 - 1 (the card in the hand) = 2 of its own cards. p2 is not touched.
      select(SANGAN, WITCH),
      expectBoard({ p1: { monsters: [BUG] }, p2: { monsters: [OX, GUARDIAN] } }),
      activate("Raigeki", "p0"),
      expectBoard({ p1: { monsters: { count: 0 } }, p2: { monsters: { count: 0 } } }),
    ],
  }),
  defineScenario({
    id: "compare-ffa3-chain-of-three-each-link-its-own-opponent",
    title: "FFA3: Ultimate Sky of p0, Balance of Judgment of p1 and Ultimate Sky of p2 in one chain: each link reads only its own opponent (W10)",
    source: OPP_PICK,
    rules: ["R-COMMON-OPP-PICK", "R-FFA-CHAIN"],
    tags: ["multiplayer", "compare", "chain", "ffa3", "card:38817295", "card:67443336"],
    // The design names Evenly Matched and Scramble!! Scramble!! for this test. Evenly Matched needs the end of the Battle Phase and
    // Scramble!! Scramble!! a Mecha Phantom Beast token, so the scan swapped them for Balance of Judgment (a Trap without a phase,
    // it draws opponent cards on the field minus own cards in hand and on the field) and a second Ultimate Sky.
    // p0 has 5 cards on the field (1 monster, 4 Spells), p1 has 3 (2 monsters, the Trap), p2 has 2 (1 monster, the Quick-Play).
    // Each link has ONE opponent that passes, so no pick is asked. Balance of Judgment of p1 reads p0 only: 5 - 3 = 2 cards.
    // The sum of both opponents would be 7 - 3 = 4 cards.
    setup: {
      format: "ffa3",
      p0: {
        monsters: [SANGAN],
        spells: [{ card: "Ultimate Sky", pos: "set" }, { card: "Raigeki", pos: "set" }, { card: "Dark Hole", pos: "set" }, { card: "Hinotama", pos: "set" }],
      },
      p1: { monsters: [WITCH, BUG], spells: [{ card: "Balance of Judgment", pos: "set" }] },
      p2: { monsters: [AXE], spells: [{ card: "Ultimate Sky", pos: "set" }] },
    },
    steps: [
      activate("Ultimate Sky", "p0"),
      select(WITCH),
      activate("Balance of Judgment", "p1"),
      activate("Ultimate Sky", "p2"),
      select(BUG),
      expectBoard({ p0: { lp: 7200 }, p1: { hand: { count: 2 } }, p2: { lp: 7200 } }),
    ],
  }),
  defineScenario({
    id: "compare-ffa3-trigger-compare-pick-and-destroy",
    title: "FFA3: the Core Blast trigger is offered when one opponent controls more monsters, asks which opponent and destroys cards of that opponent only (W12)",
    source: OPP_PICK,
    rules: ["R-COMMON-OPP-PICK"],
    tags: ["multiplayer", "compare", "trigger", "ffa3", "card:18517177"],
    setup: {
      format: "ffa3",
      p0: { monsters: ["Koa'ki Meiru Wall"], spells: ["Core Blast"] },
      p1: { monsters: [WITCH, BUG, OX], spells: [{ card: "Dark Hole", pos: "set" }] },
      p2: { monsters: [AXE, GUARDIAN] },
    },
    steps: [
      // The trigger of p0 is offered at the Standby Phase of turn 1.
      yes("p0"),
      expectPickSeats(["p1", "p2"], "p0"),
      pickOpponent("p1", "p0"),
      // p1 has 4 cards on the field, p0 controls 1 monster: p0 destroys 3 cards of p1. p2 is not touched.
      select(WITCH, BUG, OX),
      expectBoard({ p1: { monsters: { count: 0 }, spells: { count: 1 } }, p2: { monsters: [AXE, GUARDIAN] } }),
    ],
  }),
  defineScenario({
    id: "compare-ffa4-pineapple-blast-three-opponents",
    title: "FFA4: Pineapple Blast asks which of the three opponents, the picked one chooses and loses monsters, the other two are unchanged (F1)",
    source: OPP_PICK,
    rules: ["R-COMMON-OPP-PICK"],
    tags: ["multiplayer", "compare", "chooser", "ffa4", "card:90669991"],
    setup: {
      format: "ffa4",
      p0: { hand: [BEAVER], spells: [{ card: "Pineapple Blast", pos: "set" }] },
      p1: { monsters: [SANGAN, WITCH] },
      p2: { monsters: [BUG, OX] },
      p3: { monsters: [AXE, GUARDIAN, FANG] },
    },
    steps: [
      normalSummon(BEAVER, "p0"),
      activate("Pineapple Blast", "p0"),
      expectPickSeats(["p1", "p2", "p3"], "p0"),
      pickOpponent("p3", "p0"),
      // p3 keeps 1 monster (p0 controls 1) and 2 are destroyed.
      select(FANG),
      expectBoard({ p1: { monsters: [SANGAN, WITCH] }, p2: { monsters: [BUG, OX] }, p3: { monsters: [FANG], grave: [AXE, GUARDIAN] } }),
    ],
  }),
  defineScenario({
    id: "compare-ffa4-evenly-matched-three-opponents",
    title: "FFA4: Evenly Matched asks which of the three opponents and the picked one banishes cards, the other two are unchanged (F1)",
    source: OPP_PICK,
    rules: ["R-COMMON-OPP-PICK"],
    tags: ["multiplayer", "compare", "chooser", "ffa4", "card:15693423"],
    setup: {
      format: "ffa4",
      p0: { hand: ["Evenly Matched"] },
      p1: { monsters: [SANGAN, WITCH] },
      p2: { monsters: [BUG, OX] },
      p3: { monsters: [AXE, GUARDIAN, FANG] },
    },
    steps: [
      ...passTurns("p0", "p1", "p2", "p3"),
      expectTurn("p0", 5),
      changePhase("battle", "p0"),
      changePhase("main2", "p0"),
      activate("Evenly Matched", "p0"),
      expectPickSeats(["p1", "p2", "p3"], "p0"),
      pickOpponent("p3", "p0"),
      // p3 has 3 cards, p0 has 0 on the field and the card in the hand: p3 banishes 3 - 0 - 1 = 2 cards.
      select(AXE, GUARDIAN),
      expectBoard({ p1: { monsters: [SANGAN, WITCH] }, p2: { monsters: [BUG, OX] }, p3: { monsters: [FANG] } }),
    ],
  }),
  defineScenario({
    id: "compare-ffa3-dark-coffin-pick-and-choice",
    title: "FFA3: Dark Coffin asks which opponent when it is destroyed face-down, and only that opponent chooses and loses a monster (F1)",
    source: `${SOURCE} [R-COMMON-OPP-PICK]`,
    rules: ["R-COMMON-OPP-PICK"],
    tags: ["multiplayer", "chooser", "trigger", "ffa3", "card:1804528"],
    setup: {
      format: "ffa3",
      p0: { hand: ["Heavy Storm"], spells: [{ card: "Dark Coffin", pos: "set" }] },
      p1: { monsters: [SANGAN, WITCH] },
      p2: { monsters: [BUG, OX] },
    },
    steps: [
      activate("Heavy Storm", "p0"),
      expectPickSeats(["p1", "p2"], "p0"),
      pickOpponent("p2", "p0"),
      // p2 has no card in the hand, so only "destroy a monster" is left and p2 picks the monster.
      select(OX),
      expectBoard({ p1: { monsters: [SANGAN, WITCH] }, p2: { monsters: [BUG], grave: [OX] } }),
    ],
  }),
  defineScenario({
    id: "compare-ffa3-kuribabylon-graveyard-one-opponent",
    title: "FFA3: Kuribabylon is offered from the hand when ONE opponent has fewer monsters in the Graveyard, the Graveyard of the other does not count (F2)",
    source: OPP_PICK,
    rules: ["R-COMMON-OPP-PICK"],
    tags: ["multiplayer", "compare", "ffa3", "card:70914287"],
    // p0 has 1 monster in the Graveyard, p1 has 2 and p2 has 0. The compare reads 1-tp: without the overlay it reads p1 and fails.
    setup: { format: "ffa3", p0: { hand: ["Kuribabylon"], grave: [ELF] }, p1: { grave: [SANGAN, WITCH] }, p2: {} },
    steps: [activate("Kuribabylon", "p0"), expectBoard({ p0: { monsters: ["Kuribabylon"] } })],
  }),
  defineScenario({
    id: "compare-ffa4-kuribabylon-graveyard-one-opponent",
    title: "FFA4: Kuribabylon is offered when only the third opponent has fewer monsters in the Graveyard (F2)",
    source: OPP_PICK,
    rules: ["R-COMMON-OPP-PICK"],
    tags: ["multiplayer", "compare", "ffa4", "card:70914287"],
    setup: { format: "ffa4", p0: { hand: ["Kuribabylon"], grave: [ELF] }, p1: { grave: [SANGAN, WITCH] }, p2: { grave: [BUG, OX] }, p3: {} },
    steps: [activate("Kuribabylon", "p0"), expectBoard({ p0: { monsters: ["Kuribabylon"] } })],
  }),
  defineScenario({
    id: "compare-ffa3-thundercross-banished-one-opponent",
    title: "FFA3: Gigantic Thundercross counts the banished cards of the picked opponent only (F2)",
    source: OPP_PICK,
    rules: ["R-COMMON-OPP-PICK"],
    tags: ["multiplayer", "compare", "ffa3", "card:34047456"],
    // p0 has 1 banished card, p1 has 3 and p2 has 2. Bound p1: 2 targets. All opponents together would be 4 targets.
    setup: {
      format: "ffa3",
      p0: { spells: [{ card: "Gigantic Thundercross", pos: "set" }], banished: [ELF] },
      p1: { monsters: [OX, GUARDIAN], banished: [SANGAN, WITCH, BUG] },
      p2: { monsters: [AXE], banished: [FANG, RAT] },
    },
    steps: [
      // A Trap: p0 activates it on the turn of p1, in response to the Normal Summon of p1.
      endTurn("p0"),
      normalSummon(ELF, "p1"),
      activate("Gigantic Thundercross", "p0"),
      expectPickSeats(["p1", "p2"], "p0"),
      pickOpponent("p1", "p0"),
      select(OX, GUARDIAN),
      expectBoard({ p1: { monsters: [ELF] }, p2: { monsters: [AXE] } }),
    ],
  }),
  defineScenario({
    id: "compare-tag-pineapple-blast-joined-field-picked-duelist-chooses",
    title: "Tag: Pineapple Blast compares the joined opposing field and the picked opposing duelist chooses which monsters are destroyed (T2)",
    source: OPP_PICK,
    rules: ["R-COMMON-OPP-PICK"],
    tags: ["multiplayer", "compare", "chooser", "tag", "card:90669991"],
    // Team 0 is p0 and p2, team 1 is p1 and p3. p0 has 1 monster after the summon, p1 has 1 and p3 has 2: the compare reads the joined opposing field of 3.
    setup: {
      format: "tag",
      p0: { hand: [BEAVER], spells: [{ card: "Pineapple Blast", pos: "set" }] },
      p1: { monsters: [SANGAN] },
      p3: { monsters: [BUG, OX] },
    },
    steps: [
      normalSummon(BEAVER, "p0"),
      activate("Pineapple Blast", "p0"),
      expectPickSeats(["p1", "p3"], "p0"),
      pickOpponent("p3", "p0"),
      // p3 chooses among the joined opposing field (3 monsters) which 1 monster is not destroyed: p0 controls 1 monster.
      select(SANGAN),
      expectBoard({ p1: { monsters: [SANGAN] }, p3: { monsters: { count: 0 }, grave: [BUG, OX] } }),
    ],
  }),
  defineScenario({
    id: "compare-tag-evenly-matched-joined-field-picked-duelist-banishes",
    title: "Tag: Evenly Matched from the hand compares the joined opposing field and the picked opposing duelist banishes the cards (T2)",
    source: OPP_PICK,
    rules: ["R-COMMON-OPP-PICK"],
    tags: ["multiplayer", "compare", "chooser", "tag", "card:15693423"],
    // Team 0 (p0, p2) controls no card. The opposing team controls 3: p1 has 1 and p3 has 2. The hand activation needs "1 card more", the banish count is 3 - 0 - 1.
    setup: {
      format: "tag",
      p0: { hand: ["Evenly Matched"] },
      p1: { monsters: [SANGAN] },
      p3: { monsters: [WITCH, BUG] },
    },
    steps: [
      ...passTurns("p0", "p1", "p2", "p3"),
      expectTurn("p0", 5),
      changePhase("battle", "p0"),
      changePhase("main2", "p0"),
      activate("Evenly Matched", "p0"),
      expectPickSeats(["p1", "p3"], "p0"),
      pickOpponent("p3", "p0"),
      // p3 chooses among the joined opposing field: 2 of the 3 cards are banished.
      select(SANGAN, WITCH),
      expectBoard({ p1: { monsters: { count: 0 } }, p3: { monsters: [BUG] } }),
    ],
  }),
  defineScenario({
    id: "compare-ffa3-mandragora-special-summon-procedure",
    title: "FFA3: Evilswarm Mandragora can be Special Summoned from the hand when only ONE opponent controls more monsters (F3)",
    source: OPP_PICK,
    rules: ["R-COMMON-OPP-PICK"],
    tags: ["multiplayer", "compare", "ffa3", "card:8814959"],
    // p0 controls 1 monster, p1 has 1 and p2 has 2: the second opponent passes the compare, the first one does not.
    setup: { format: "ffa3", p0: { hand: ["Evilswarm Mandragora"], monsters: [ELF] }, p1: { monsters: [SANGAN] }, p2: { monsters: [WITCH, BUG] } },
    steps: [specialSummon("Evilswarm Mandragora", "p0"), expectBoard({ p0: { monsters: [ELF, "Evilswarm Mandragora"] } })],
  }),
  defineScenario({
    id: "compare-ffa3-mandragora-no-opponent-passes",
    title: "FFA3: Evilswarm Mandragora is not offered when no single opponent controls more monsters, although all opponents together do (F3)",
    source: OPP_PICK,
    rules: ["R-COMMON-OPP-PICK"],
    tags: ["multiplayer", "compare", "ffa3", "card:8814959"],
    setup: { format: "ffa3", p0: { hand: ["Evilswarm Mandragora"], monsters: [ELF, RAT] }, p1: { monsters: [SANGAN, WITCH] }, p2: { monsters: [BUG, OX] } },
    steps: [
      expectNotOffered("specialSummon", "Evilswarm Mandragora", "p0"),
      endTurn("p0"),
      expectBoard({ p0: { monsters: [ELF, RAT] }, p1: { monsters: [SANGAN, WITCH] }, p2: { monsters: [BUG, OX] } }),
    ],
  }),
  defineScenario({
    id: "compare-ffa3-mystic-mine-destroys-itself-on-any-equal-opponent",
    title: "FFA3: Mystic Mine destroys itself at the End Phase when the monster count of p0 equals the count of any ONE opponent (F4)",
    source: OPP_PICK,
    rules: ["R-COMMON-OPP-PICK"],
    tags: ["multiplayer", "compare", "trigger", "ffa3", "card:76375976"],
    setup: { format: "ffa3", p0: { hand: ["Mystic Mine"], monsters: [ELF] }, p1: { monsters: [SANGAN, WITCH] }, p2: { monsters: [BUG] } },
    steps: [activate("Mystic Mine", "p0"), endTurn("p0"), expectBoard({ p0: { grave: ["Mystic Mine"] } })],
  }),
  defineScenario({
    id: "compare-ffa3-kairyu-shin-each-opponent-keeps-one",
    title: "FFA3: Ocean Dragon Lord - Kairyu-Shin lets EACH opponent keep one face-up non-WATER monster, every other one is sent to the Graveyard (F6)",
    source: OPP_PICK,
    rules: ["R-COMMON-EACH-PLAYER"],
    tags: ["multiplayer", "each-player", "ffa3", "card:23931679"],
    setup: {
      format: "ffa3",
      p0: { hand: ["Ocean Dragon Lord - Kairyu-Shin", "Umi"], monsters: [RAT] },
      p1: { monsters: [SANGAN, WITCH] },
      p2: { monsters: [BUG, OX] },
    },
    steps: [
      // The effect needs a face-up Umi.
      activate("Umi", "p0"),
      normalSummon("Ocean Dragon Lord - Kairyu-Shin", "p0"),
      select(RAT),
      // p1 and then p2 choose the one monster to keep.
      select(SANGAN),
      select(BUG),
      expectBoard({ p1: { monsters: [SANGAN], grave: [WITCH] }, p2: { monsters: [BUG], grave: [OX] } }),
    ],
  }),
  defineScenario({
    id: "compare-ffa3-dominus-spiral-only-opponent-with-a-monster",
    title: "FFA3: Dominus Spiral is bound to the only opponent that has a monster: no pick of the opponent without one, Sangan returns to the hand",
    source: OPP_PICK,
    rules: ["R-COMMON-OPP-PICK"],
    tags: ["multiplayer", "chooser", "ffa3", "card:42091632"],
    // p1 has Sangan, p2 has no monster. The probe run for p2 finds no target, so p0 is not asked and the bound opponent is p1.
    setup: { format: "ffa3", p0: { spells: [{ card: "Dominus Spiral", pos: "set" }] }, p1: { monsters: [SANGAN] } },
    steps: [
      activate("Dominus Spiral", "p0"),
      expectBoard({
        p0: { lp: 8000, monsters: [], spells: [], grave: ["Dominus Spiral"], banished: [] },
        p1: { lp: 8000, monsters: [], spells: [], hand: [SANGAN], grave: [], banished: [] },
        p2: { lp: 8000, monsters: [], spells: [], hand: [], grave: [], banished: [] },
      }),
    ],
  }),
];
