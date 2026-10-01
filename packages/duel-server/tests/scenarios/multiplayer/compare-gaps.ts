// Live scenarios of cards that compare monsters or cards of "your opponent" with yours, and that review A found without one:
// Kaiser Colosseum (a value of the summoning duelist), the five scan-gap cards (Three in One, Sangen Kaiho, Evilswarm Exciton Knight,
// Ghost Reaper & Winter Cherries, Mimighoul Slime), the target cap of Ultimate Sky and the per-opponent Mystic Mine.
// Each card has the same two cases: the SUM of the opponents passes but no single opponent does (the card is not offered, nothing changes),
// and one opponent passes (the card is offered and acts on that opponent). Plain data, also read by scripts/rule-coverage.ts;
// tests/scenarios/multiplayer/compare-gaps.test.ts runs them on a live core (NSEAT_LIVE=1). Every scenario ends with the state of every seat.
// Decisions: docs/adr/0002-multiplayer-duel-rules.md (question 2): FFA, the activator compares with ONE opponent.

import {
  activate, changePhase, choose, defineScenario, endTurn, expectBoard, expectNotOffered, expectOffered, expectPickOptions, expectPickSeats, expectTurn,
  normalSummon, pass, pickOpponent, select, type BoardExpect, type DuelistExpect, type Scenario, type Step,
} from "../../support/dsl.js";
import { ELF, SOURCE } from "./nseat-scenarios.js";

type Seat = "p0" | "p1" | "p2" | "p3";
const OPP_PICK = `${SOURCE} [R-COMMON-OPP-PICK]`;
const OX = "Battle Ox";
const GUARDIAN = "Celtic Guardian";
const AXE = "Axe Raider";
const FANG = "Silver Fang";
const BEAVER = "Beaver Warrior";
const SKULL = "Summoned Skull";
const RAT = "Giant Rat";
const SANGAN = "Sangan";
const WITCH = "Witch of the Black Forest";
const BUG = "Man-Eater Bug";
const RYU_RAN = "Ryu-Ran";
const NUMERON = "Number 100: Numeron Dragon";
const TIO = "Three in One";
const SANGEN = "Sangen Kaiho";
const GHOST = "Ghost Reaper & Winter Cherries";
const EXCITON = "Evilswarm Exciton Knight";
const SLIME = "Mimighoul Slime";

/**
 * The state of EVERY seat of a format, exact for the monster zones, the Spell and Trap zones, the Graveyard, the banished zone and
 * the Life Points (8000 for a seat, 16000 for the team of a Tag duel, unless given). A seat that the spec leaves out must be empty.
 * The hand is checked only when the spec names it.
 */
function everySeat(format: "ffa3" | "ffa4" | "tag", spec: Partial<Record<Seat, DuelistExpect>>): Step {
  const seats: Seat[] = format === "ffa3" ? ["p0", "p1", "p2"] : ["p0", "p1", "p2", "p3"];
  const board: BoardExpect = {};
  for (const seat of seats) board[seat] = { lp: format === "tag" ? 16000 : 8000, monsters: [], spells: [], grave: [], banished: [], ...spec[seat] };
  return expectBoard(board);
}

export const COMPARE_GAP_SCENARIOS: Scenario[] = [
  defineScenario({
    id: "compare-gaps-ffa3-kaiser-colosseum-limit-counts-the-summoner-only",
    title: "FFA3: Kaiser Colosseum limits the Tribute of a monster of p0 by the monsters of the SUMMONING duelist (p1: none), not by the sum of the opponents of p0",
    source: OPP_PICK,
    rules: ["R-COMMON-OPP-PICK"],
    tags: ["multiplayer", "compare", "ffa3", "card:35059553", "card:68005187"],
    // p0 controls 2 monsters and Kaiser Colosseum. p1 has none, p2 has 1. Soul Exchange of p1 Tributes a monster of p0: one Tribute leaves p1 with 1 monster,
    // not more than p0 (1 after the Tribute). The sum of p1 and p2 (1) would block it.
    setup: {
      format: "ffa3",
      p0: { monsters: [OX, GUARDIAN], spells: ["Kaiser Colosseum"] },
      p1: { hand: [SKULL, "Soul Exchange"] },
      p2: { monsters: [BEAVER] },
    },
    steps: [
      endTurn("p0"),
      activate("Soul Exchange", "p1"),
      // Soul Exchange targets a monster of any opponent (no overlay file): p1 picks the monster of p0.
      select(OX),
      expectOffered("tributeSummon", SKULL, "p1"),
      normalSummon(SKULL, "p1"),
      select(OX),
      everySeat("ffa3", {
        p0: { monsters: [GUARDIAN], spells: ["Kaiser Colosseum"], grave: [OX] },
        p1: { monsters: [SKULL], grave: ["Soul Exchange"], hand: [ELF] },
        p2: { monsters: [BEAVER] },
      }),
    ],
  }),
  // Three in One: Quick-Play Spell, End Phase of an opponent turn, "your opponent has more cards in the hand and on the field".
  // p0 holds 3 cards (the set Three in One and 2 in the hand). p1 draws in its turn and holds 3 in its End Phase.
  defineScenario({
    id: "compare-gaps-ffa3-three-in-one-sum-passes-no-single-opponent",
    title: "FFA3: p1 and p2 hold 3 cards each and p0 holds 3: the sum (6) is more but no single opponent is: Three in One is not offered in the End Phase of p1",
    source: OPP_PICK,
    rules: ["R-COMMON-OPP-PICK"],
    tags: ["multiplayer", "compare", "ffa3", "card:50838440"],
    setup: {
      format: "ffa3",
      p0: { hand: [FANG, BEAVER], spells: [{ card: TIO, pos: "set" }], grave: [OX, GUARDIAN, AXE] },
      p1: { hand: [RAT, FANG] },
      p2: { hand: [RAT, OX, GUARDIAN] },
    },
    steps: [
      endTurn("p0"),
      // p0 gets no window in the End Phase of p1 (nothing of p0 can be activated): the turn goes on to p2.
      endTurn("p1"),
      expectTurn("p2", 3),
      everySeat("ffa3", {
        p0: { hand: [FANG, BEAVER], spells: [TIO], grave: [OX, GUARDIAN, AXE] },
        p1: { hand: [RAT, FANG, ELF] },
        p2: { hand: [RAT, OX, GUARDIAN, ELF] },
      }),
    ],
  }),
  defineScenario({
    id: "compare-gaps-ffa3-three-in-one-one-opponent-has-more",
    title: "FFA3: p2 holds 4 cards, more than p0 (3): Three in One is offered in the End Phase of p1 and Special Summons 3 Normal Monsters from the Graveyard of p0",
    source: OPP_PICK,
    rules: ["R-COMMON-OPP-PICK"],
    tags: ["multiplayer", "compare", "ffa3", "card:50838440"],
    setup: {
      format: "ffa3",
      p0: { hand: [FANG, BEAVER], spells: [{ card: TIO, pos: "set" }], grave: [OX, GUARDIAN, AXE] },
      p1: { hand: [RAT, FANG] },
      p2: { hand: [RAT, OX, GUARDIAN, ELF] },
    },
    steps: [
      endTurn("p0"),
      changePhase("end", "p1"),
      expectOffered("activate", TIO, "p0"),
      activate(TIO, "p0"),
      // Exactly 3 Normal Monsters in the Graveyard: the engine summons them with no pick, then the turn goes on to p2.
      expectTurn("p2", 3),
      everySeat("ffa3", {
        p0: { hand: [FANG, BEAVER], monsters: [OX, GUARDIAN, AXE], grave: [TIO] },
        p1: { hand: [RAT, FANG, ELF] },
        p2: { hand: [RAT, OX, GUARDIAN, ELF, ELF] },
      }),
    ],
  }),
  // Sangen Kaiho: Quick-Play Spell, "you control only FIRE Dragon monsters and your opponent controls more monsters".
  defineScenario({
    id: "compare-gaps-ffa3-sangen-kaiho-sum-passes-no-single-opponent",
    title: "FFA3: p0 controls 1 monster (Ryu-Ran), p1 and p2 control 1 each (sum 2): Sangen Kaiho is not offered",
    source: OPP_PICK,
    rules: ["R-COMMON-OPP-PICK"],
    tags: ["multiplayer", "compare", "ffa3", "card:25388971"],
    setup: {
      format: "ffa3",
      p0: { monsters: [RYU_RAN], spells: [{ card: SANGEN, pos: "set" }] },
      p1: { monsters: [OX] },
      p2: { monsters: [GUARDIAN] },
    },
    steps: [
      expectNotOffered("activate", SANGEN, "p0"),
      endTurn("p0"),
      everySeat("ffa3", { p0: { monsters: [RYU_RAN], spells: [SANGEN] }, p1: { hand: [ELF], monsters: [OX] }, p2: { monsters: [GUARDIAN] } }),
    ],
  }),
  defineScenario({
    id: "compare-gaps-ffa3-sangen-kaiho-one-opponent-has-more",
    title: "FFA3: p2 controls 2 monsters, more than p0 (1): Sangen Kaiho is offered and resolves",
    source: OPP_PICK,
    rules: ["R-COMMON-OPP-PICK"],
    tags: ["multiplayer", "compare", "ffa3", "card:25388971"],
    setup: {
      format: "ffa3",
      p0: { monsters: [RYU_RAN], spells: [{ card: SANGEN, pos: "set" }] },
      p1: { monsters: [OX] },
      p2: { monsters: [GUARDIAN, AXE] },
    },
    steps: [
      expectOffered("activate", SANGEN, "p0"),
      activate(SANGEN, "p0"),
      everySeat("ffa3", { p0: { monsters: [RYU_RAN], grave: [SANGEN] }, p1: { monsters: [OX] }, p2: { monsters: [GUARDIAN, AXE] } }),
    ],
  }),
  // Ghost Reaper & Winter Cherries: Quick Effect from the hand, "your opponent controls more monsters than you"; it banishes the copies
  // of the chosen Extra Deck card from the Extra Deck of the opponent. Every seat holds one Numeron Dragon in its Extra Deck.
  defineScenario({
    id: "compare-gaps-ffa3-ghost-reaper-sum-passes-no-single-opponent",
    title: "FFA3: p0 controls 1 monster, p1 and p2 control 1 each (sum 2): Ghost Reaper & Winter Cherries is not offered",
    source: OPP_PICK,
    rules: ["R-COMMON-OPP-PICK"],
    tags: ["multiplayer", "compare", "ffa3", "card:62015408"],
    setup: {
      format: "ffa3",
      p0: { hand: [GHOST], monsters: [ELF], extra: [NUMERON] },
      p1: { monsters: [SANGAN], extra: [NUMERON] },
      p2: { monsters: [WITCH], extra: [NUMERON] },
    },
    steps: [
      expectNotOffered("activate", GHOST, "p0"),
      endTurn("p0"),
      everySeat("ffa3", {
        p0: { hand: [GHOST], monsters: [ELF], extra: [NUMERON] },
        p1: { hand: [ELF], monsters: [SANGAN], extra: [NUMERON] },
        p2: { monsters: [WITCH], extra: [NUMERON] },
      }),
    ],
  }),
  defineScenario({
    id: "compare-gaps-ffa3-ghost-reaper-one-opponent-has-more",
    title: "FFA3: p2 controls 2 monsters, more than p0 (1): Ghost Reaper & Winter Cherries is offered and acts on the Extra Deck of the opponent",
    source: OPP_PICK,
    rules: ["R-COMMON-OPP-PICK"],
    tags: ["multiplayer", "compare", "ffa3", "card:62015408"],
    setup: {
      format: "ffa3",
      p0: { hand: [GHOST], monsters: [ELF], extra: [NUMERON] },
      p1: { monsters: [SANGAN], extra: [NUMERON] },
      p2: { monsters: [WITCH, BUG], extra: [NUMERON] },
    },
    steps: [
      expectOffered("activate", GHOST, "p0"),
      activate(GHOST, "p0"),
      everySeat("ffa3", {
        p0: { hand: [], monsters: [ELF], extra: [NUMERON], grave: [GHOST] },
        p1: { monsters: [SANGAN], extra: [NUMERON] },
        p2: { monsters: [WITCH, BUG], extra: [], banished: [NUMERON] },
      }),
    ],
  }),
  // Evilswarm Exciton Knight: Quick Effect, "your opponent has more cards in the hand and on the field than you"; it destroys all other cards on the field.
  defineScenario({
    id: "compare-gaps-ffa3-exciton-knight-sum-passes-no-single-opponent",
    title: "FFA3: p0 holds 1 card (the Xyz monster), p1 and p2 hold 1 each (sum 2): Evilswarm Exciton Knight is not offered",
    source: OPP_PICK,
    rules: ["R-COMMON-OPP-PICK"],
    tags: ["multiplayer", "compare", "ffa3", "card:46772449"],
    setup: {
      format: "ffa3",
      p0: { monsters: [{ card: EXCITON, materials: [AXE, BEAVER] }] },
      p1: { monsters: [RAT] },
      p2: { monsters: [OX] },
    },
    steps: [
      expectNotOffered("activate", EXCITON, "p0"),
      endTurn("p0"),
      everySeat("ffa3", { p0: { monsters: [EXCITON] }, p1: { hand: [ELF], monsters: [RAT] }, p2: { monsters: [OX] } }),
    ],
  }),
  defineScenario({
    id: "compare-gaps-ffa3-exciton-knight-one-opponent-has-more",
    title: "FFA3: p2 holds 2 cards, more than p0 (1): Evilswarm Exciton Knight is offered and destroys the other cards on the field",
    source: OPP_PICK,
    rules: ["R-COMMON-OPP-PICK"],
    tags: ["multiplayer", "compare", "ffa3", "card:46772449"],
    setup: {
      format: "ffa3",
      p0: { monsters: [{ card: EXCITON, materials: [AXE, BEAVER] }] },
      p1: { monsters: [RAT] },
      p2: { monsters: [OX, GUARDIAN] },
    },
    steps: [
      expectOffered("activate", EXCITON, "p0"),
      activate(EXCITON, "p0"),
      select(AXE),
      everySeat("ffa3", { p0: { monsters: [EXCITON], grave: [AXE] }, p1: { grave: [RAT] }, p2: { grave: [OX, GUARDIAN] } }),
    ],
  }),
  // Mimighoul Slime: ignition effect from the hand. It is summoned face-down to the field of an opponent, or face-up to your own when
  // ONE opponent controls more monsters than you (the second branch is the compare).
  defineScenario({
    id: "compare-gaps-ffa3-mimighoul-slime-sum-passes-no-single-opponent",
    title: "FFA3: p0 controls 1 monster, p1 and p2 control 1 each (sum 2): Mimighoul Slime offers only the face-down branch, not the summon to the own field",
    source: OPP_PICK,
    rules: ["R-COMMON-OPP-PICK"],
    tags: ["multiplayer", "compare", "ffa3", "card:80551022"],
    setup: {
      format: "ffa3",
      p0: { hand: [SLIME], monsters: [ELF] },
      p1: { monsters: [SANGAN] },
      p2: { monsters: [WITCH] },
    },
    steps: [
      activate(SLIME, "p0"),
      expectPickSeats(["p1", "p2"], "p0"),
      pickOpponent("p2", "p0"),
      // No opponent passes the compare alone: there is no option prompt, the card goes face-down to the picked opponent.
      everySeat("ffa3", { p0: { hand: [], monsters: [ELF] }, p1: { monsters: [SANGAN] }, p2: { monsters: [WITCH, SLIME] } }),
    ],
  }),
  defineScenario({
    id: "compare-gaps-ffa3-mimighoul-slime-one-opponent-has-more",
    title: "FFA3: p2 controls 2 monsters, more than p0 (1): Mimighoul Slime offers both branches and the summon to the own field works",
    source: OPP_PICK,
    rules: ["R-COMMON-OPP-PICK"],
    tags: ["multiplayer", "compare", "ffa3", "card:80551022"],
    setup: {
      format: "ffa3",
      p0: { hand: [SLIME], monsters: [ELF] },
      p1: { monsters: [SANGAN] },
      p2: { monsters: [WITCH, BUG] },
    },
    steps: [
      activate(SLIME, "p0"),
      pickOpponent("p2", "p0"),
      // The picked opponent p2 passes the compare: both branches are offered.
      expectPickOptions({ count: 2 }, "p0"),
      choose("face-up on your field", "p0"),
      everySeat("ffa3", { p0: { hand: [], monsters: [ELF, SLIME] }, p1: { monsters: [SANGAN] }, p2: { monsters: [WITCH, BUG] } }),
    ],
  }),
  defineScenario({
    id: "compare-gaps-ffa3-mimighoul-slime-picked-opponent-does-not-pass",
    title: "FFA3: p2 controls 2 monsters (more than p0) but p1 controls 1: p0 picks p1, so the face-up branch is not offered and the card goes face-down to p1",
    source: OPP_PICK,
    rules: ["R-COMMON-OPP-PICK"],
    tags: ["multiplayer", "compare", "ffa3", "card:80551022"],
    setup: {
      format: "ffa3",
      p0: { hand: [SLIME], monsters: [ELF] },
      p1: { monsters: [SANGAN] },
      p2: { monsters: [WITCH, BUG] },
    },
    steps: [
      activate(SLIME, "p0"),
      pickOpponent("p1", "p0"),
      everySeat("ffa3", { p0: { hand: [], monsters: [ELF] }, p1: { monsters: [SANGAN, SLIME] }, p2: { monsters: [WITCH, BUG] } }),
    ],
  }),
];
