// Live scenarios of the seat state in the overlay (F7 design, part P3b): R2 (ADR 0002, R-COMMON-SEAT-STATE, Q6: a per-player flag or counter
// is kept per seat in FFA and per team in Tag) and the Q10 label fixes (Curse of the Circle, Wiseman's Chalice). Plain data, also read by
// scripts/rule-coverage.ts; tests/scenarios/multiplayer/seats-r2.test.ts runs them on a live core with the core seats (patch 0053 and later,
// NSEAT_LIVE=1). Every scenario uses the real card scripts plus the overlay, and ends with the state of EVERY seat.

import {
  activate, attack, changePhase, changePosition, defineScenario, endTurn, expectBoard, expectNotOffered, expectOffered, expectPrompt, faceDown, pass, pickOpponent,
  announce, normalSummon, select, setCard, zone, type BoardExpect, type DuelistExpect, type Scenario, type Step,
} from "../../support/dsl.js";
import { SOURCE } from "./nseat-scenarios.js";

type Seat = "p0" | "p1" | "p2" | "p3";
type Format = "ffa3" | "ffa4" | "tag";
const STATE = `${SOURCE} [R-COMMON-SEAT-STATE]`;

const CURSE = "Curse of the Circle";
const CHALICE = "Wiseman's Chalice";
const ABACUS = "Fatal Abacus";
const JAR = "Absorbing Jar";
const HOLE = "Dark Hole";
const BURIAL = "Extra-Foolish Burial";
const DROLL = "Droll & Lock Bird";
const OGRE = "Ogre of the Scarlet Sorrow";
const REINFORCE = "Reinforcement of the Army";
const GOYO = "Goyo Guardian";
const TUNER = "Kagemusha of the Six Samurai";
const OX = "Battle Ox";
const AXE = "Axe Raider";
const FANG = "Silver Fang";
const ELF = "Mystical Elf";
const RAT = "Giant Rat";
const SANGAN = "Sangan";
const LAM = "Life Absorbing Machine";
const PREMATURE = "Premature Burial";
const GARDEN = "Black Garden";
const ROSE = "Rose Token";
const GRAVEKEEPER = "Gravekeeper's Trap";
const COUNTER = "Metalfoes Counter";
const SILVERD = "Metalfoes Silverd";
const CHAFF = "Confusion Chaff";
const ELF_ATK = 800;

/** The state of EVERY seat: LP, monsters, Spell and Trap zones, Graveyard and banished zone are exact; the hand only when the spec names it. */
function everySeat(format: Format, spec: Partial<Record<Seat, DuelistExpect>>): Step {
  const seats: Seat[] = format === "ffa3" ? ["p0", "p1", "p2"] : ["p0", "p1", "p2", "p3"];
  const board: BoardExpect = {};
  for (const seat of seats) board[seat] = { lp: format === "tag" ? 16000 : 8000, monsters: [], spells: [], grave: [], banished: [], ...spec[seat] };
  return expectBoard(board);
}

/** The turns before the first attack (nobody attacks in the first round). */
const passTurns = (...seats: Seat[]): Step[] => seats.map((seat) => endTurn(seat));

/**
 * The holder of a hand or Set card reads its OWN key (aux.MPKey(tp)), not the key of Lua player 0. In FFA the two are the same; in Tag the
 * Lua value of team 1 is 1 and Lua 0 is the OTHER team, so a team-1 holder (p1 or p3) read the key of team 0. These scenarios put the holder on
 * team 1 (and the partner of the actor on the same team), and FFA3 puts it on seat 2, and assert every seat at the end.
 */
const ownKeyScenarios = (): Scenario[] => [
  defineScenario({
    id: "seats-r2-tag-droll-and-lock-bird-of-team-1-answers-a-search-of-team-0",
    title: "Tag: p2 (team 0) adds Axe Raider from the Deck with Reinforcement of the Army: Droll & Lock Bird of p1 (team 1) is offered and answers (the own key of p1 is the key of team 1, not the key of Lua player 0)",
    source: STATE,
    rules: ["R-COMMON-SEAT-STATE", "R-TAG-PARTNER"],
    tags: ["multiplayer", "r2", "own-key", "tag", "card:94145021"],
    setup: { format: "tag", p1: { hand: [DROLL] }, p2: { hand: [REINFORCE], deck: [ELF, AXE] } },
    steps: [
      ...passTurns("p0", "p1"),
      activate(REINFORCE, "p2"),
      zone("p2", "s0", "p2"),
      activate(DROLL, "p1"),
      everySeat("tag", { p1: { hand: [ELF], grave: [DROLL] }, p2: { hand: [ELF, AXE], grave: [REINFORCE] } }),
    ],
  }),
  defineScenario({
    id: "seats-r2-tag-droll-and-lock-bird-of-team-1-answers-a-search-of-p0",
    title: "Tag: p0 (team 0) adds Axe Raider from the Deck with Reinforcement of the Army: Droll & Lock Bird of p3 (team 1) is offered and answers",
    source: STATE,
    rules: ["R-COMMON-SEAT-STATE", "R-TAG-PARTNER"],
    tags: ["multiplayer", "r2", "own-key", "tag", "card:94145021"],
    setup: { format: "tag", p0: { hand: [REINFORCE], deck: [ELF, AXE] }, p3: { hand: [DROLL] } },
    steps: [
      activate(REINFORCE, "p0"),
      zone("p0", "s0", "p0"),
      activate(DROLL, "p3"),
      everySeat("tag", { p0: { hand: [AXE], grave: [REINFORCE] }, p3: { hand: [], grave: [DROLL] } }),
    ],
  }),
  defineScenario({
    id: "seats-r2-tag-droll-and-lock-bird-of-team-1-is-not-offered-for-a-search-of-the-partner",
    title: "Tag: p3 adds Axe Raider from the Deck with Reinforcement of the Army: Droll & Lock Bird of its partner p1 is not offered (a search of the own team does not count)",
    source: STATE,
    rules: ["R-COMMON-SEAT-STATE", "R-TAG-PARTNER"],
    tags: ["multiplayer", "r2", "own-key", "tag", "card:94145021"],
    setup: { format: "tag", p1: { hand: [DROLL] }, p3: { hand: [REINFORCE], deck: [ELF, AXE] } },
    steps: [
      ...passTurns("p0", "p1", "p2"),
      activate(REINFORCE, "p3"),
      zone("p3", "s0", "p3"),
      // p1 gets no chain prompt: the next prompt is the main phase action of p3
      expectPrompt({ by: "p3", context: "action" }),
      everySeat("tag", { p1: { hand: [DROLL, ELF] }, p3: { hand: [ELF, AXE], grave: [REINFORCE] } }),
    ],
  }),
  defineScenario({
    id: "seats-r2-tag-ogre-of-the-scarlet-sorrow-of-team-1-after-two-direct-attacks-at-its-team",
    title: "Tag: p0 attacks the team of p1 directly twice: p1 (team 1) can Special Summon Ogre of the Scarlet Sorrow from the hand (the count is read with the own key of the holder)",
    source: STATE,
    rules: ["R-COMMON-SEAT-STATE", "R-TAG-PARTNER"],
    tags: ["multiplayer", "r2", "own-key", "tag", "card:82670878"],
    setup: { format: "tag", p0: { monsters: [ELF, ELF] }, p1: { hand: [OGRE] } },
    steps: [
      ...passTurns("p0", "p1", "p2", "p3"),
      changePhase("battle", "p0"),
      attack(ELF, "direct", "p0"),
      pickOpponent("p1", "p0"),
      attack(ELF, "direct", "p0"),
      pickOpponent("p1", "p0"),
      activate(OGRE, "p1"),
      everySeat("tag", {
        p0: { monsters: [ELF, ELF] },
        p1: { lp: 16000 - ELF_ATK, hand: [ELF], monsters: [OGRE] },
        p3: { lp: 16000 - ELF_ATK },
      }),
    ],
  }),
  defineScenario({
    id: "seats-r2-ffa3-ogre-of-the-scarlet-sorrow-two-direct-attacks-at-seat-2",
    title: "FFA3: p0 attacks p2 directly twice: p2 can Special Summon Ogre of the Scarlet Sorrow from the hand (the count is kept per attacked seat)",
    source: STATE,
    rules: ["R-COMMON-SEAT-STATE", "R-FFA-ATTACK"],
    tags: ["multiplayer", "r2", "own-key", "ffa3", "card:82670878"],
    setup: { format: "ffa3", p0: { monsters: [ELF, ELF] }, p2: { hand: [OGRE] } },
    steps: [
      ...passTurns("p0", "p1", "p2"),
      changePhase("battle", "p0"),
      attack(ELF, "direct", "p0"),
      pickOpponent("p2", "p0"),
      attack(ELF, "direct", "p0"),
      pickOpponent("p2", "p0"),
      activate(OGRE, "p2"),
      everySeat("ffa3", {
        p0: { monsters: [ELF, ELF] },
        p2: { lp: 8000 - ELF_ATK, hand: [ELF], monsters: [OGRE] },
      }),
    ],
  }),
  defineScenario({
    id: "seats-r2-tag-metalfoes-counter-of-team-1-after-its-monster-is-destroyed",
    title: "Tag: Dark Hole of p0 destroys only the Mystical Elf of p1 (team 1): Metalfoes Counter of p1 is offered and Special Summons Metalfoes Silverd from the Deck (the own key of p1 is the key of team 1)",
    source: STATE,
    rules: ["R-COMMON-SEAT-STATE", "R-TAG-PARTNER"],
    tags: ["multiplayer", "r2", "own-key", "tag", "card:33327029"],
    setup: { format: "tag", p0: { hand: [HOLE] }, p1: { monsters: [ELF], spells: [faceDown(COUNTER)], deck: [SILVERD] } },
    steps: [
      activate(HOLE, "p0"),
      expectOffered("activate", COUNTER, "p1"),
      activate(COUNTER, "p1"),
      everySeat("tag", { p0: { grave: [HOLE] }, p1: { monsters: [SILVERD], grave: [ELF, COUNTER] } }),
    ],
  }),
  defineScenario({
    id: "seats-r2-ffa3-metalfoes-counter-of-seat-2-after-its-monster-is-destroyed",
    title: "FFA3: Dark Hole of p0 destroys only the Mystical Elf of p2: Metalfoes Counter of p2 is offered and Special Summons Metalfoes Silverd from the Deck",
    source: STATE,
    rules: ["R-COMMON-SEAT-STATE", "R-COMMON-EACH-PLAYER"],
    tags: ["multiplayer", "r2", "own-key", "ffa3", "card:33327029"],
    setup: { format: "ffa3", p0: { hand: [HOLE] }, p2: { monsters: [ELF], spells: [faceDown(COUNTER)], deck: [SILVERD] } },
    steps: [
      activate(HOLE, "p0"),
      expectOffered("activate", COUNTER, "p2"),
      activate(COUNTER, "p2"),
      everySeat("ffa3", { p0: { grave: [HOLE] }, p2: { monsters: [SILVERD], grave: [ELF, COUNTER] } }),
    ],
  }),
  defineScenario({
    id: "seats-r2-tag-confusion-chaff-of-team-1-at-the-second-direct-attack",
    title: "Tag: p0 attacks the team of p1 directly with two monsters: at the second attack Confusion Chaff of p1 (team 1) is offered (the count and the first attacker are read with the own key of the holder)",
    source: STATE,
    rules: ["R-COMMON-SEAT-STATE", "R-TAG-PARTNER"],
    tags: ["multiplayer", "r2", "own-key", "tag", "card:67630339"],
    setup: { format: "tag", p0: { monsters: [ELF, ELF] }, p1: { spells: [faceDown(CHAFF)] } },
    steps: [
      ...passTurns("p0", "p1", "p2", "p3"),
      changePhase("battle", "p0"),
      attack(ELF, "direct", "p0"),
      pickOpponent("p1", "p0"),
      attack(ELF, "direct", "p0"),
      pickOpponent("p1", "p0"),
      expectOffered("activate", CHAFF, "p1"),
      activate(CHAFF, "p1"),
      everySeat("tag", { p0: { grave: [ELF, ELF] }, p1: { lp: 16000 - ELF_ATK, grave: [CHAFF] }, p3: { lp: 16000 - ELF_ATK } }),
    ],
  }),
  defineScenario({
    id: "seats-r2-ffa3-confusion-chaff-of-seat-2-at-the-second-direct-attack",
    title: "FFA3: p0 attacks p2 directly with two monsters: at the second attack Confusion Chaff of p2 is offered",
    source: STATE,
    rules: ["R-COMMON-SEAT-STATE", "R-FFA-ATTACK"],
    tags: ["multiplayer", "r2", "own-key", "ffa3", "card:67630339"],
    setup: { format: "ffa3", p0: { monsters: [ELF, ELF] }, p2: { spells: [faceDown(CHAFF)] } },
    steps: [
      ...passTurns("p0", "p1", "p2"),
      changePhase("battle", "p0"),
      attack(ELF, "direct", "p0"),
      pickOpponent("p2", "p0"),
      attack(ELF, "direct", "p0"),
      pickOpponent("p2", "p0"),
      expectOffered("activate", CHAFF, "p2"),
      activate(CHAFF, "p2"),
      everySeat("ffa3", { p0: { grave: [ELF, ELF] }, p2: { lp: 8000 - ELF_ATK, grave: [CHAFF] } }),
    ],
  }),
];

export const SEATS_R2_SCENARIOS: Scenario[] = [
  // --- label fixes (Q10): Curse of the Circle ---------------------------------------------------------------------------------------
  defineScenario({
    id: "seats-r2-ffa3-curse-of-the-circle-blocks-only-the-seat-of-the-cursed-monster",
    title: "FFA3: p0 activates Curse of the Circle on the Battle Ox of p1: p1 cannot use that Battle Ox as Synchro Material, p0 and p2 can use their own Battle Ox",
    source: STATE,
    rules: ["R-COMMON-SEAT-STATE", "R-COMMON-OPP-PICK"],
    tags: ["multiplayer", "r2", "label", "q10", "ffa3", "card:12863633"],
    // The stock label is 1-tp (the folded opponent). The overlay keeps the real seat of the cursed monster and compares it with the seat of the Synchro Monster.
    // Every seat has a Tuner and a Battle Ox (level 2 + 4 = 6) and a Goyo Guardian in the Extra Deck.
    setup: {
      format: "ffa3",
      p0: { monsters: [TUNER, OX], spells: [faceDown(CURSE)], extra: [GOYO] },
      p1: { monsters: [TUNER, OX], extra: [GOYO] },
      p2: { monsters: [TUNER, OX], extra: [GOYO] },
    },
    steps: [
      expectOffered("specialSummon", GOYO, "p0"),
      activate(CURSE, "p0"),
      select({ card: OX, owner: "p1" }),
      expectOffered("specialSummon", GOYO, "p0"),
      endTurn("p0"),
      expectNotOffered("specialSummon", GOYO, "p1"),
      endTurn("p1"),
      expectOffered("specialSummon", GOYO, "p2"),
      everySeat("ffa3", {
        p0: { monsters: [TUNER, OX], grave: [CURSE] },
        p1: { monsters: [TUNER, OX] },
        p2: { monsters: [TUNER, OX] },
      }),
    ],
  }),

  // --- label fixes (Q10): Wiseman's Chalice -----------------------------------------------------------------------------------------
  defineScenario({
    id: "seats-r2-ffa3-wisemans-chalice-gives-the-monster-back-to-the-seat-it-came-from",
    title: "FFA3: p0 summons the Giant Rat of the Graveyard of p2 with Wiseman's Chalice: at the end of the turn the Giant Rat goes back to p2 (not to p1)",
    source: STATE,
    rules: ["R-COMMON-SEAT-STATE", "R-COMMON-OPP-PICK"],
    tags: ["multiplayer", "r2", "label", "q10", "ffa3", "card:35262428"],
    // The stock label is 1-tp, a folded value: in FFA3 the monster of p2 would go to p1. The overlay keeps the real seat it came from.
    setup: {
      format: "ffa3",
      p0: { hand: [CHALICE] },
      p1: { grave: [AXE] },
      p2: { grave: [RAT] },
    },
    steps: [
      activate(CHALICE, "p0"),
      zone("p0", "s0", "p0"),
      select({ card: RAT, owner: "p2" }),
      endTurn("p0"),
      everySeat("ffa3", {
        p0: { grave: [CHALICE] },
        p1: { grave: [AXE] },
        p2: { monsters: [RAT] },
      }),
    ],
  }),
  defineScenario({
    id: "seats-r2-tag-wisemans-chalice-gives-the-monster-back-to-the-duelist-it-came-from",
    title: "Tag: p0 summons the Giant Rat of the Graveyard of p3 with Wiseman's Chalice: at the end of the turn the Giant Rat goes back to p3 (not to its partner p1); the key of the card is the team",
    source: STATE,
    rules: ["R-COMMON-SEAT-STATE", "R-COMMON-OPP-PICK", "R-TAG-PARTNER"],
    tags: ["multiplayer", "r2", "label", "q10", "tag", "card:35262428"],
    setup: {
      format: "tag",
      p0: { hand: [CHALICE] },
      p1: { grave: [AXE] },
      p3: { grave: [RAT] },
    },
    steps: [
      activate(CHALICE, "p0"),
      zone("p0", "s0", "p0"),
      select({ card: RAT, owner: "p3" }),
      endTurn("p0"),
      everySeat("tag", {
        p0: { grave: [CHALICE] },
        p1: { grave: [AXE] },
        p3: { monsters: [RAT] },
      }),
    ],
  }),

  // --- Life Absorbing Machine: the list of LP costs of the last turn, kept per seat (FFA) and per team (Tag) ---------------------------
  defineScenario({
    id: "seats-r2-ffa3-life-absorbing-machine-recovers-half-of-the-cost-of-its-own-seat",
    title: "FFA3: p0 pays 800 LP twice and p2 pays 800 LP once for Premature Burial; in its next own Standby Phase the Life Absorbing Machine of p0 gives p0 400 LP twice and the one of p2 gives p2 400 LP once (one list per seat, p2 does not read the list of p0), p1 gets nothing",
    source: STATE,
    rules: ["R-COMMON-SEAT-STATE"],
    tags: ["multiplayer", "r2", "seat-table", "ffa3", "card:14318794"],
    // The stock lists are s[p] and s[p+2] for p = 0 and 1. The overlay keeps a list for every seat (seat 2 has its own list, not the one of seat 0).
    setup: {
      format: "ffa3",
      p0: { hand: [PREMATURE, PREMATURE], grave: [OX, AXE], spells: [LAM] },
      p1: {},
      p2: { hand: [PREMATURE], grave: [FANG], spells: [LAM] },
    },
    steps: [
      activate(PREMATURE, "p0"),
      zone("p0", "s1", "p0"),
      select({ card: OX, owner: "p0" }),
      activate(PREMATURE, "p0"),
      zone("p0", "s2", "p0"),
      endTurn("p0"),
      endTurn("p1"),
      // The Standby Phase of p2: its list of the last turn is empty, so p2 recovers nothing (the 2 payments of p0 are not on its list).
      everySeat("ffa3", {
        p0: { lp: 6400, monsters: [OX, AXE], spells: [LAM, PREMATURE, PREMATURE] },
        p2: { lp: 8000, spells: [LAM], grave: [FANG] },
      }),
      activate(PREMATURE, "p2"),
      zone("p2", "s1", "p2"),
      endTurn("p2"),
      // The Standby Phase of p0: its list is [400, 400].
      everySeat("ffa3", {
        p0: { lp: 7200, monsters: [OX, AXE], spells: [LAM, PREMATURE, PREMATURE] },
        p2: { lp: 7200, monsters: [FANG], spells: [LAM, PREMATURE] },
      }),
      endTurn("p0"),
      endTurn("p1"),
      // The Standby Phase of p2: its list is [400].
      everySeat("ffa3", {
        p0: { lp: 7200, monsters: [OX, AXE], spells: [LAM, PREMATURE, PREMATURE] },
        p2: { lp: 7600, monsters: [FANG], spells: [LAM, PREMATURE] },
      }),
    ],
  }),
  defineScenario({
    id: "seats-r2-tag-life-absorbing-machine-recovers-half-of-the-cost-of-the-team",
    title: "Tag: p0 pays 800 LP twice and p1 pays 800 LP once for Premature Burial; the Life Absorbing Machine of the partner p2 gives team 0 800 LP and the one of p3 gives team 1 400 LP (one list per team, the partner reads the list of the team)",
    source: STATE,
    rules: ["R-COMMON-SEAT-STATE", "R-TAG-LP", "R-TAG-ORDER"],
    tags: ["multiplayer", "r2", "seat-table", "tag", "card:14318794"],
    // The key is the team: the costs of p0 are on the list of team 0 and p2 (its partner) reads that list in its own Standby Phase.
    setup: {
      format: "tag",
      p0: { hand: [PREMATURE, PREMATURE], grave: [OX, AXE] },
      p1: { hand: [PREMATURE], grave: [FANG] },
      p2: { spells: [LAM] },
      p3: { spells: [LAM] },
    },
    steps: [
      activate(PREMATURE, "p0"),
      zone("p0", "s0", "p0"),
      select({ card: OX, owner: "p0" }),
      activate(PREMATURE, "p0"),
      zone("p0", "s1", "p0"),
      endTurn("p0"),
      everySeat("tag", {
        p0: { lp: 14400, monsters: [OX, AXE], spells: [PREMATURE, PREMATURE] },
        p1: { grave: [FANG] },
        p2: { lp: 14400, spells: [LAM] },
        p3: { spells: [LAM] },
      }),
      activate(PREMATURE, "p1"),
      zone("p1", "s0", "p1"),
      endTurn("p1"),
      // The Standby Phase of p2: the list of team 0 is [400, 400].
      everySeat("tag", {
        p0: { lp: 15200, monsters: [OX, AXE], spells: [PREMATURE, PREMATURE] },
        p1: { lp: 15200, monsters: [FANG], spells: [PREMATURE] },
        p2: { lp: 15200, spells: [LAM] },
        p3: { lp: 15200, spells: [LAM] },
      }),
      endTurn("p2"),
      // The Standby Phase of p3: the list of team 1 is [400].
      everySeat("tag", {
        p0: { lp: 15200, monsters: [OX, AXE], spells: [PREMATURE, PREMATURE] },
        p1: { lp: 15600, monsters: [FANG], spells: [PREMATURE] },
        p2: { lp: 15200, spells: [LAM] },
        p3: { lp: 15600, spells: [LAM] },
      }),
    ],
  }),

  // --- Black Garden: the token of the own side goes to ONE opponent the controller picks, the token of an opponent goes to the controller -----
  defineScenario({
    id: "seats-r2-ffa3-black-garden-token-goes-to-one-picked-opponent-or-to-the-controller",
    title: "FFA3: p1 controls Black Garden. p0 summons Battle Ox: the ATK halves and p1 gets the Rose Token. p1 summons Axe Raider: the ATK halves and p1 picks p2 for the token (not p0). p2 summons Silver Fang: the ATK halves and p1 gets the token. In its next turn p0 attacks Silver Fang with Battle Ox (850 against 600): p2 loses 250 LP",
    source: STATE,
    rules: ["R-COMMON-SEAT-STATE", "R-COMMON-OPP-PICK"],
    tags: ["multiplayer", "r2", "seat-table", "ffa3", "card:71645242"],
    // The stock trap c was the unbound GetLocationCount(1-tp) in the operation step. The target step binds ONE opponent (the pick of the controller).
    setup: {
      format: "ffa3",
      p0: { hand: [OX] },
      p1: { hand: [AXE], field: GARDEN },
      p2: { hand: [FANG] },
    },
    steps: [
      normalSummon(OX, "p0"),
      endTurn("p0"),
      normalSummon(AXE, "p1"),
      pickOpponent("p2", "p1"),
      endTurn("p1"),
      normalSummon(FANG, "p2"),
      endTurn("p2"),
      changePhase("battle", "p0"),
      attack(OX, FANG, "p0"),
      everySeat("ffa3", {
        p0: { monsters: [OX] },
        p1: { monsters: [AXE, ROSE, ROSE], spells: [GARDEN] },
        p2: { lp: 8000 - 250, monsters: [ROSE], grave: [FANG] },
      }),
    ],
  }),
  defineScenario({
    id: "seats-r2-tag-black-garden-token-goes-to-one-picked-opponent-or-to-the-controller",
    title: "Tag: p1 controls Black Garden. p0 summons Battle Ox: its ATK halves and p1 gets the Rose Token. p1 summons Axe Raider: its ATK halves and p1 picks p2 for the token (not p0). p2 summons Silver Fang: p1 gets the token. p3 summons Mystical Elf: the ATK halves and p1 (the controller of the card, not p3) picks p0 for the token",
    source: STATE,
    rules: ["R-COMMON-SEAT-STATE", "R-COMMON-OPP-PICK", "R-TAG-PARTNER"],
    tags: ["multiplayer", "r2", "seat-table", "tag", "card:71645242"],
    setup: {
      format: "tag",
      p0: { hand: [OX] },
      p1: { hand: [AXE], field: GARDEN },
      p2: { hand: [FANG] },
      p3: { hand: [ELF] },
    },
    steps: [
      normalSummon(OX, "p0"),
      endTurn("p0"),
      normalSummon(AXE, "p1"),
      pickOpponent("p2", "p1"),
      endTurn("p1"),
      normalSummon(FANG, "p2"),
      endTurn("p2"),
      normalSummon(ELF, "p3"),
      pickOpponent("p0", "p1"),
      endTurn("p3"),
      everySeat("tag", {
        p0: { monsters: [OX, ROSE] },
        p1: { monsters: [AXE, ROSE, ROSE], spells: [GARDEN] },
        p2: { monsters: [FANG, ROSE] },
        p3: { monsters: [ELF] },
      }),
    ],
  }),

  // --- Gravekeeper's Trap: the declared card is checked against the draw of the TURN PLAYER, one opponent at a time -----------------------
  defineScenario({
    id: "seats-r2-ffa3-gravekeepers-trap-checks-the-draw-of-the-turn-player",
    title: "FFA3: p0 controls Gravekeeper's Trap and declares Silver Fang before the draw of p1 and of p2. p1 draws Silver Fang: it goes to the Graveyard of p1. p2 draws Axe Raider: it stays in the hand of p2. The draw of p0 and the hand of the other seats are not touched",
    source: STATE,
    rules: ["R-COMMON-SEAT-STATE", "R-COMMON-OPP-PICK"],
    tags: ["multiplayer", "r2", "turn-player", "ffa3", "card:98715423"],
    // The stock trap c was GetDrawCount(1-tp) in the operation step (an unbound opponent). The opponent is the player of the draw: the turn player.
    setup: {
      format: "ffa3",
      p0: { spells: [GRAVEKEEPER], deck: [RAT] },
      p1: { deck: [FANG] },
      p2: { deck: [AXE] },
    },
    steps: [
      endTurn("p0"),
      announce(FANG, "p0"),
      endTurn("p1"),
      announce(FANG, "p0"),
      endTurn("p2"),
      everySeat("ffa3", {
        p0: { hand: [RAT], spells: [GRAVEKEEPER] },
        p1: { grave: [FANG] },
        p2: { hand: [AXE] },
      }),
    ],
  }),

  defineScenario({
    id: "seats-r2-tag-gravekeepers-trap-checks-the-draw-of-the-opposing-turn-player-only",
    title: "Tag: p0 controls Gravekeeper's Trap and declares Silver Fang before the draw of p1 and of p3 (not before the draw of its partner p2). p1 draws Silver Fang: it goes to the Graveyard of p1. p3 draws Axe Raider: it stays in the hand of p3. p2 draws Mystical Elf and keeps it",
    source: STATE,
    rules: ["R-COMMON-SEAT-STATE", "R-TAG-PARTNER", "R-TAG-ORDER"],
    tags: ["multiplayer", "r2", "turn-player", "tag", "card:98715423"],
    setup: {
      format: "tag",
      p0: { spells: [GRAVEKEEPER], deck: [RAT] },
      p1: { deck: [FANG] },
      p2: { deck: [ELF] },
      p3: { deck: [AXE] },
    },
    steps: [
      endTurn("p0"),
      announce(FANG, "p0"),
      endTurn("p1"),
      endTurn("p2"),
      announce(FANG, "p0"),
      endTurn("p3"),
      everySeat("tag", {
        p0: { hand: [RAT], spells: [GRAVEKEEPER] },
        p1: { grave: [FANG] },
        p2: { hand: [ELF] },
        p3: { hand: [AXE] },
      }),
    ],
  }),

  // --- a card of the real controller (aux.MPForEachController) -----------------------------------------------------------------------
  defineScenario({
    id: "seats-r2-ffa3-absorbing-jar-each-controller-draws-for-its-own-destroyed-cards",
    title: "FFA3: p0 flips Absorbing Jar: the 4 set cards are destroyed and p0 draws 1 card, p1 draws 2 and p2 draws 1 (each real controller draws for its own cards)",
    source: STATE,
    rules: ["R-COMMON-SEAT-STATE", "R-COMMON-EACH-PLAYER"],
    tags: ["multiplayer", "r2", "each-controller", "ffa3", "card:3900605"],
    setup: {
      format: "ffa3",
      p0: { monsters: [faceDown(JAR)], spells: [faceDown(HOLE)], deck: [RAT, OX] },
      p1: { spells: [faceDown(HOLE), faceDown(HOLE)], deck: [AXE, FANG] },
      p2: { spells: [faceDown(HOLE)], deck: [ELF, SANGAN] },
    },
    steps: [
      changePosition(JAR, "p0"),
      everySeat("ffa3", {
        p0: { hand: [RAT], monsters: [JAR], grave: [HOLE] },
        p1: { hand: [AXE, FANG], grave: [HOLE, HOLE] },
        p2: { hand: [ELF], grave: [HOLE] },
      }),
    ],
  }),
  defineScenario({
    id: "seats-r2-tag-absorbing-jar-each-controller-draws-for-its-own-destroyed-cards",
    title: "Tag: p0 flips Absorbing Jar: p0 and its partner p2 draw 1 card each for their own set card, p1 draws 2, p3 draws nothing (the controller is the real seat, not the team)",
    source: STATE,
    rules: ["R-COMMON-SEAT-STATE", "R-COMMON-EACH-PLAYER", "R-TAG-PARTNER"],
    tags: ["multiplayer", "r2", "each-controller", "tag", "card:3900605"],
    setup: {
      format: "tag",
      p0: { monsters: [faceDown(JAR)], spells: [faceDown(HOLE)], deck: [RAT] },
      p1: { spells: [faceDown(HOLE), faceDown(HOLE)], deck: [AXE, FANG] },
      p2: { spells: [faceDown(HOLE)], deck: [ELF] },
      p3: { deck: [SANGAN] },
    },
    steps: [
      changePosition(JAR, "p0"),
      everySeat("tag", {
        p0: { hand: [RAT], monsters: [JAR], grave: [HOLE] },
        p1: { hand: [AXE, FANG], grave: [HOLE, HOLE] },
        p2: { hand: [ELF], grave: [HOLE] },
        p3: { hand: [] },
      }),
    ],
  }),
  defineScenario({
    id: "seats-r2-ffa3-fatal-abacus-damages-each-real-controller-of-the-destroyed-monsters",
    title: "FFA3: with Fatal Abacus on the field p0 destroys all monsters with Dark Hole: p0 loses 500 LP for its 1 monster, p1 loses 1000 LP for its 2 and p2 loses 500 LP for its 1",
    source: STATE,
    rules: ["R-COMMON-SEAT-STATE", "R-COMMON-EACH-PLAYER"],
    tags: ["multiplayer", "r2", "each-controller", "ffa3", "card:77910045"],
    setup: {
      format: "ffa3",
      p0: { hand: [HOLE], spells: [faceDown(ABACUS)], monsters: [OX] },
      p1: { monsters: [AXE, FANG] },
      p2: { monsters: [ELF] },
    },
    steps: [
      activate(ABACUS, "p0"),
      activate(HOLE, "p0"),
      zone("p0", "s1", "p0"),
      everySeat("ffa3", {
        p0: { lp: 7500, spells: [ABACUS], grave: [HOLE, OX] },
        p1: { lp: 7000, grave: [AXE, FANG] },
        p2: { lp: 7500, grave: [ELF] },
      }),
    ],
  }),
  defineScenario({
    id: "seats-r2-tag-fatal-abacus-damages-the-team-of-each-real-controller",
    title: "Tag: with Fatal Abacus on the field p0 destroys all monsters with Dark Hole: team 0 loses 500 LP for the monster of p0 and 500 LP for the monster of p2, team 1 loses 1000 LP for the 2 monsters of p1",
    source: STATE,
    rules: ["R-COMMON-SEAT-STATE", "R-COMMON-EACH-PLAYER", "R-TAG-LP"],
    tags: ["multiplayer", "r2", "each-controller", "tag", "card:77910045"],
    setup: {
      format: "tag",
      p0: { hand: [HOLE], spells: [faceDown(ABACUS)], monsters: [OX] },
      p1: { monsters: [AXE, FANG] },
      p2: { monsters: [ELF] },
    },
    steps: [
      activate(ABACUS, "p0"),
      activate(HOLE, "p0"),
      zone("p0", "s1", "p0"),
      everySeat("tag", {
        p0: { lp: 15000, spells: [ABACUS], grave: [HOLE, OX] },
        p1: { lp: 15000, grave: [AXE, FANG] },
        p2: { lp: 15000, grave: [ELF] },
        p3: { lp: 15000 },
      }),
    ],
  }),

  // --- a global flag of a duelist (R2_NO_CHANGE: the core rule keeps the flag of the real seat, the team in Tag) -------------------------
  defineScenario({
    id: "seats-r2-ffa3-extra-foolish-burial-is-locked-after-p2-sets-a-card",
    title: "FFA3: p2 can activate Extra-Foolish Burial until p2 Sets a card; after that the global check has set the flag of seat 2 and the card is no longer offered",
    source: STATE,
    rules: ["R-COMMON-SEAT-STATE"],
    tags: ["multiplayer", "r2", "global-flag", "no-change", "ffa3", "card:57995165"],
    // No overlay file: the card is in the R2 no-change list, and this scenario is the live proof for seat 2.
    setup: {
      format: "ffa3",
      p2: { hand: [BURIAL, HOLE], extra: [GOYO] },
    },
    steps: [
      ...passTurns("p0", "p1"),
      expectOffered("activate", BURIAL, "p2"),
      setCard(HOLE, "p2"),
      zone("p2", "s0", "p2"),
      expectNotOffered("activate", BURIAL, "p2"),
      everySeat("ffa3", { p2: { hand: [BURIAL, ELF], spells: [HOLE] } }),
    ],
  }),
  defineScenario({
    id: "seats-r2-tag-extra-foolish-burial-is-locked-after-p3-sets-a-card",
    title: "Tag: p3 can activate Extra-Foolish Burial until p3 Sets a card; after that the flag of team 1 is set and the card is no longer offered to p3",
    source: STATE,
    rules: ["R-COMMON-SEAT-STATE", "R-TAG-PARTNER"],
    tags: ["multiplayer", "r2", "global-flag", "no-change", "tag", "card:57995165"],
    setup: {
      format: "tag",
      p3: { hand: [BURIAL, HOLE], extra: [GOYO] },
    },
    steps: [
      ...passTurns("p0", "p1", "p2"),
      expectOffered("activate", BURIAL, "p3"),
      setCard(HOLE, "p3"),
      zone("p3", "s0", "p3"),
      expectNotOffered("activate", BURIAL, "p3"),
      everySeat("tag", { p3: { hand: [BURIAL, ELF], spells: [HOLE] } }),
    ],
  }),

  // --- Droll & Lock Bird: the added card at seat 2 and seat 3 -----------------------------------------------------------------------
  defineScenario({
    id: "seats-r2-ffa3-droll-and-lock-bird-answers-a-search-of-seat-2",
    title: "FFA3: p2 adds Axe Raider from the Deck with Reinforcement of the Army: p0 holds Droll & Lock Bird and gets the answer (the event names seat 2, the stock literals 0 and 1 did not)",
    source: STATE,
    rules: ["R-COMMON-SEAT-STATE"],
    tags: ["multiplayer", "r2", "global-flag", "ffa3", "card:94145021"],
    setup: {
      format: "ffa3",
      p0: { hand: [DROLL] },
      p2: { hand: [REINFORCE], deck: [ELF, AXE] },
    },
    steps: [
      ...passTurns("p0", "p1"),
      activate(REINFORCE, "p2"),
      zone("p2", "s0", "p2"),
      activate(DROLL, "p0"),
      everySeat("ffa3", { p0: { hand: [], grave: [DROLL] }, p2: { hand: [ELF, AXE], grave: [REINFORCE] } }),
    ],
  }),
  defineScenario({
    id: "seats-r2-ffa4-droll-and-lock-bird-answers-a-search-of-seat-3",
    title: "FFA4: p3 adds Axe Raider from the Deck with Reinforcement of the Army: p0 holds Droll & Lock Bird and gets the answer (the event names seat 3)",
    source: STATE,
    rules: ["R-COMMON-SEAT-STATE"],
    tags: ["multiplayer", "r2", "global-flag", "ffa4", "card:94145021"],
    setup: {
      format: "ffa4",
      p0: { hand: [DROLL] },
      p3: { hand: [REINFORCE], deck: [ELF, AXE] },
    },
    steps: [
      ...passTurns("p0", "p1", "p2"),
      activate(REINFORCE, "p3"),
      zone("p3", "s0", "p3"),
      activate(DROLL, "p0"),
      everySeat("ffa4", { p0: { hand: [], grave: [DROLL] }, p3: { hand: [ELF, AXE], grave: [REINFORCE] } }),
    ],
  }),
  defineScenario({
    id: "seats-r2-ffa3-droll-and-lock-bird-is-not-offered-to-the-seat-that-added-the-card",
    title: "FFA3: p2 holds Droll & Lock Bird and adds Axe Raider from the Deck itself: Droll & Lock Bird is not offered to p2 (only an addition by another seat counts)",
    source: STATE,
    rules: ["R-COMMON-SEAT-STATE"],
    tags: ["multiplayer", "r2", "global-flag", "ffa3", "card:94145021"],
    setup: {
      format: "ffa3",
      p2: { hand: [DROLL, REINFORCE], deck: [ELF, AXE] },
    },
    steps: [
      ...passTurns("p0", "p1"),
      activate(REINFORCE, "p2"),
      zone("p2", "s0", "p2"),
      expectNotOffered("activate", DROLL, "p2"),
      everySeat("ffa3", { p2: { hand: [DROLL, ELF, AXE], grave: [REINFORCE] } }),
    ],
  }),

  // --- Ogre of the Scarlet Sorrow: direct attacks counted per attacked seat ----------------------------------------------------------
  defineScenario({
    id: "seats-r2-ffa4-ogre-of-the-scarlet-sorrow-two-direct-attacks-at-seat-3",
    title: "FFA4: p0 attacks p3 directly twice: p3 can Special Summon Ogre of the Scarlet Sorrow from the hand (the count is kept per attacked seat)",
    source: STATE,
    rules: ["R-COMMON-SEAT-STATE", "R-FFA-ATTACK"],
    tags: ["multiplayer", "r2", "global-counter", "ffa4", "card:82670878"],
    setup: {
      format: "ffa4",
      p0: { monsters: [ELF, ELF] },
      p3: { hand: [OGRE] },
    },
    steps: [
      ...passTurns("p0", "p1", "p2", "p3"),
      changePhase("battle", "p0"),
      attack(ELF, "direct", "p0"),
      pickOpponent("p3", "p0"),
      attack(ELF, "direct", "p0"),
      pickOpponent("p3", "p0"),
      activate(OGRE, "p3"),
      everySeat("ffa4", {
        p0: { monsters: [ELF, ELF] },
        p3: { lp: 8000 - ELF_ATK, hand: [ELF], monsters: [OGRE] },
      }),
    ],
  }),
  defineScenario({
    id: "seats-r2-ffa4-ogre-of-the-scarlet-sorrow-one-direct-attack-at-each-of-two-seats",
    title: "FFA4: p0 attacks p2 directly once and p3 directly once: Ogre of the Scarlet Sorrow in the hand of p3 is not offered (each seat faced one attack, the stock count would have been 2)",
    source: STATE,
    rules: ["R-COMMON-SEAT-STATE", "R-FFA-ATTACK"],
    tags: ["multiplayer", "r2", "global-counter", "ffa4", "card:82670878"],
    setup: {
      format: "ffa4",
      p0: { monsters: [ELF, ELF] },
      p3: { hand: [OGRE] },
    },
    steps: [
      ...passTurns("p0", "p1", "p2", "p3"),
      changePhase("battle", "p0"),
      attack(ELF, "direct", "p0"),
      pickOpponent("p2", "p0"),
      attack(ELF, "direct", "p0"),
      pickOpponent("p3", "p0"),
      // p3 gets no chain prompt: the next prompt is the battle action of p0.
      expectPrompt({ by: "p0", offers: ["to_m2", "to_ep"] }),
      everySeat("ffa4", {
        p0: { monsters: [ELF, ELF] },
        p2: { lp: 8000 - ELF_ATK },
        p3: { lp: 8000 - ELF_ATK, hand: [OGRE, ELF] },
      }),
    ],
  }),
  ...ownKeyScenarios(),
];
