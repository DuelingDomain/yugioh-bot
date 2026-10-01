// Live scenarios of the table cards that need a script fix or a proof of the multi-seat rules (F7 design, part P3b, row Table):
// Traptrix Pudica (the Standby Phase return goes to the controller of the banished monster), Summoning Curse (every controller of a
// summoned monster banishes), Brain Jacker, The Eye of Truth, Kiseitai, Gingerbread House and Snake-Eyes Diabellstar (a dead bound opponent).
// Plain data, also read by scripts/rule-coverage.ts; table-cards.test.ts runs them on a live core (NSEAT_LIVE=1).
// Every scenario ends with the state of every seat. Decisions: docs/adr/0002-multiplayer-duel-rules.md and DECISIONS-2026-10-01 (Q3, Q6, Q9, OQ3).

import {
  activate, defineScenario, endTurn, expectBoard, expectEliminated, expectLp, expectPrompt, expectTurn, surrender, expectPickSeats, pickOpponent, specialSummon, yes, changePosition, select, changePhase, attack,
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

/** A select step answered by the named seat. */
const selectBy = (seat: Seat, name: string): Step => ({ ...select(name), by: seat }) as Step;

const PUDICA = "Traptrix Pudica";
const CYBER = "Cyber Dragon";
const BRAIN_JACKER = "Brain Jacker";
const GINGERBREAD = "Gingerbread House";
const KISEITAI = "Kiseitai";

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
  defineScenario({
    id: "table-ffa3-eye-of-truth-the-turn-player-gains-the-lp-in-its-own-standby-phase",
    title: "FFA3: The Eye of Truth of p0: p1 has a Spell in its hand and gains 1000 LP in its own Standby Phase with no pick, p2 gains 1000 LP in its own Standby Phase, and nobody else gains LP",
    source: OPP_FIELD,
    rules: ["R-COMMON-OPP-FIELD", "R-FFA-ORDER"],
    tags: ["multiplayer", "lp", "ffa3", "card:34694160"],
    setup: {
      format: "ffa3",
      p0: { spells: [{ card: "The Eye of Truth", pos: "set" }] },
      p1: { hand: ["Dark Hole"] },
      p2: { hand: ["Raigeki"] },
    },
    steps: [
      activate("The Eye of Truth", "p0"),
      endTurn("p0"),
      // no opponent pick: the open prompt is the action prompt of p1 (its own main phase), with the 1000 LP already gained
      expectPrompt({ by: "p1", context: "action" }),
      expectLp({ seat: "p0" }, 8000),
      expectLp({ seat: "p1" }, 9000),
      expectLp({ seat: "p2" }, 8000),
      endTurn("p1"),
      expectLp({ seat: "p0" }, 8000),
      expectLp({ seat: "p1" }, 9000),
      expectLp({ seat: "p2" }, 9000),
      everySeat("ffa3", { p0: { lp: 8000, spells: ["The Eye of Truth"] }, p1: { lp: 9000 }, p2: { lp: 9000 } }),
    ],
  }),
  defineScenario({
    id: "table-tag-eye-of-truth-only-an-opposing-duelist-with-a-spell-in-its-hand-gains-the-lp-for-its-team",
    title: "Tag: The Eye of Truth of p0: in the Standby Phase of p1 (a Spell in its hand) the team of p1 gains 1000 LP with no pick, in the one of p2 (the partner of p0) nothing, in the one of p3 (no Spell in its hand) nothing",
    source: OPP_FIELD,
    rules: ["R-COMMON-OPP-FIELD", "R-TAG-PARTNER", "R-TAG-ORDER"],
    tags: ["multiplayer", "lp", "tag", "card:34694160"],
    setup: {
      format: "tag",
      p0: { spells: [{ card: "The Eye of Truth", pos: "set" }] },
      p1: { hand: ["Dark Hole"] },
      p2: { hand: ["Raigeki"] },
      p3: { hand: [ELF] },
    },
    steps: [
      activate("The Eye of Truth", "p0"),
      endTurn("p0"),
      expectPrompt({ by: "p1", context: "action" }),
      expectLp({ team: 0 }, 16000),
      expectLp({ team: 1 }, 17000),
      endTurn("p1"),
      // The Standby Phase of p2, the partner of the controller: nothing.
      expectPrompt({ by: "p2", context: "action" }),
      expectLp({ team: 0 }, 16000),
      expectLp({ team: 1 }, 17000),
      endTurn("p2"),
      // The Standby Phase of p3: no Spell in its hand, nothing.
      expectPrompt({ by: "p3", context: "action" }),
      everySeat("tag", {
        p0: { lp: 16000, spells: ["The Eye of Truth"] },
        p1: { lp: 17000 },
        p2: { lp: 16000 },
        p3: { lp: 17000 },
      }),
    ],
  }),
  defineScenario({
    id: "table-ffa3-brain-jacker-only-the-owner-of-the-stolen-monster-gains-the-lp-in-its-own-standby-phase",
    title: "FFA3: the 500 LP of Brain Jacker go to the owner of the stolen monster (p2) in its own Standby Phase, with no pick, and to nobody else",
    source: OPP_FIELD,
    rules: ["R-COMMON-OPP-FIELD", "R-FFA-ORDER"],
    tags: ["multiplayer", "equip", "steal", "lp", "ffa3", "card:40267580"],
    setup: {
      format: "ffa3",
      p0: { monsters: [{ card: BRAIN_JACKER, pos: "set" }] },
      p1: { monsters: [ELF] },
      p2: { monsters: ["Summoned Skull"] },
    },
    steps: [
      changePosition({ card: BRAIN_JACKER }, "p0"),
      select({ card: "Summoned Skull", owner: "p2" }),
      endTurn("p0"),
      // The Standby Phase of p1 (not the owner): nobody is asked and nobody gains LP.
      expectLp({ seat: "p0" }, 8000),
      expectLp({ seat: "p1" }, 8000),
      expectLp({ seat: "p2" }, 8000),
      endTurn("p1"),
      // The Standby Phase of p2 (the owner): p2 gains 500 LP, nobody is asked.
      expectPrompt({ by: "p2", context: "action" }),
      expectLp({ seat: "p0" }, 8000),
      expectLp({ seat: "p1" }, 8000),
      expectLp({ seat: "p2" }, 8500),
      endTurn("p2"),
      endTurn("p0"),
      endTurn("p1"),
      // The next Standby Phase of p2: once more 500 LP to p2 only.
      everySeat("ffa3", { p0: { monsters: ["Summoned Skull"], spells: [BRAIN_JACKER] }, p1: { monsters: [ELF] }, p2: { lp: 9000 } }),
    ],
  }),
  defineScenario({
    id: "table-tag-brain-jacker-only-the-team-of-the-owner-gains-the-lp-in-the-turn-of-the-owner",
    title: "Tag: the 500 LP of Brain Jacker go to the team of the owner (p3) in the turn of p3 only, not in the turn of its partner p1",
    source: OPP_FIELD,
    rules: ["R-COMMON-OPP-FIELD", "R-TAG-PARTNER", "R-TAG-ORDER"],
    tags: ["multiplayer", "equip", "steal", "lp", "tag", "card:40267580"],
    setup: {
      format: "tag",
      p0: { monsters: [{ card: BRAIN_JACKER, pos: "set" }] },
      p1: { monsters: [ELF] },
      p2: { monsters: ["Dark Magician"] },
      p3: { monsters: ["Summoned Skull"] },
    },
    steps: [
      changePosition({ card: BRAIN_JACKER }, "p0"),
      select({ card: "Summoned Skull", owner: "p3" }),
      endTurn("p0"),
      // The Standby Phase of p1, the partner of the owner: no LP for the team of the owner.
      expectLp({ team: 0 }, 16000),
      expectLp({ team: 1 }, 16000),
      endTurn("p1"),
      // The Standby Phase of p2, the partner of the controller: nothing.
      expectLp({ team: 0 }, 16000),
      expectLp({ team: 1 }, 16000),
      endTurn("p2"),
      // The Standby Phase of p3, the owner: the team of p3 gains 500 LP.
      expectPrompt({ by: "p3", context: "action" }),
      everySeat("tag", {
        p0: { lp: 16000, monsters: ["Summoned Skull"], spells: [BRAIN_JACKER] },
        p1: { lp: 16500, monsters: [ELF] },
        p2: { lp: 16000, monsters: ["Dark Magician"] },
        p3: { lp: 16500 },
      }),
    ],
  }),
  defineScenario({
    id: "table-ffa3-gingerbread-house-in-the-standby-phase-of-an-opponent-no-pick-all-opponent-monsters",
    title: "FFA3: Gingerbread House in the Standby Phase of p1 asks for no opponent pick (only the trigger yes/no for p0): the monsters of both opponents gain 600 ATK, the one of p2 reaches 2500 and is destroyed, p0 gains 500 LP",
    source: OPP_FIELD,
    rules: ["R-COMMON-OPP-FIELD", "R-FFA-ORDER"],
    tags: ["multiplayer", "lp", "destroy", "ffa3", "card:79922118"],
    setup: {
      format: "ffa3",
      p0: { spells: [{ card: GINGERBREAD, pos: "set" }] },
      p1: { monsters: ["Battle Ox"] },
      p2: { monsters: ["Gemini Elf"] },
    },
    steps: [
      activate(GINGERBREAD, "p0"),
      endTurn("p0"),
      // The stock effect reads "0, MZONE" as the monsters of all opponents (R-COMMON-OPP-FIELD): no pick, only the yes/no of the optional trigger.
      yes("p0"),
      expectPrompt({ by: "p1", context: "action" }),
      everySeat("ffa3", { p0: { lp: 8500, spells: [GINGERBREAD] }, p1: { monsters: ["Battle Ox"] }, p2: { grave: ["Gemini Elf"] } }),
    ],
  }),
  defineScenario({
    id: "table-tag-gingerbread-house-in-the-standby-phase-of-an-opposing-duelist-no-pick",
    title: "Tag: Gingerbread House in the Standby Phase of p1 asks for no pick: the monsters of both opposing duelists gain 600 ATK, the Gemini Elf of p3 is destroyed, the team of p0 gains 500 LP",
    source: OPP_FIELD,
    rules: ["R-COMMON-OPP-FIELD", "R-TAG-ORDER"],
    tags: ["multiplayer", "lp", "destroy", "tag", "card:79922118"],
    setup: {
      format: "tag",
      p0: { spells: [{ card: GINGERBREAD, pos: "set" }] },
      p1: { monsters: ["Battle Ox"] },
      p2: { monsters: [ELF] },
      p3: { monsters: ["Gemini Elf"] },
    },
    steps: [
      activate(GINGERBREAD, "p0"),
      endTurn("p0"),
      yes("p0"),
      expectPrompt({ by: "p1", context: "action" }),
      everySeat("tag", {
        p0: { lp: 16500, spells: [GINGERBREAD] },
        p1: { lp: 16000, monsters: ["Battle Ox"] },
        p2: { lp: 16500, monsters: [ELF] },
        p3: { lp: 16000, grave: ["Gemini Elf"] },
      }),
    ],
  }),
  defineScenario({
    id: "table-ffa3-kiseitai-the-controller-gains-the-lp-in-the-standby-phase-of-each-opponent-no-pick",
    title: "FFA3: Kiseitai equipped to the Summoned Skull of p1 gives p0 half the ATK as LP in the Standby Phase of p2 and again in the one of p1, with no pick",
    source: OPP_FIELD,
    rules: ["R-COMMON-OPP-FIELD", "R-FFA-ORDER"],
    tags: ["multiplayer", "equip", "lp", "ffa3", "card:4266839"],
    setup: {
      format: "ffa3",
      p0: { monsters: [{ card: KISEITAI, pos: "set" }] },
      p1: { monsters: ["Summoned Skull"] },
    },
    steps: [
      // No attack is allowed in the first turn of each seat: p1 attacks on its second turn (turn 5).
      ...["p0", "p1", "p2", "p0"].map((seat) => endTurn(seat as Seat)),
      changePhase("battle", "p1"),
      attack("Summoned Skull", KISEITAI, "p1"),
      expectPrompt({ by: "p1", context: "action" }),
      endTurn("p1"),
      // The Standby Phase of p2 (an opponent of p0): p0 gains half the ATK of the Summoned Skull, nobody is asked.
      expectPrompt({ by: "p2", context: "action" }),
      expectLp({ seat: "p0" }, 9250),
      endTurn("p2"),
      endTurn("p0"),
      // The Standby Phase of p1: p0 gains it again.
      expectPrompt({ by: "p1", context: "action" }),
      everySeat("ffa3", { p0: { lp: 10500, spells: [KISEITAI] }, p1: { monsters: ["Summoned Skull"] } }),
    ],
  }),
  defineScenario({
    id: "table-ffa3-summoning-curse-two-opponents-summon-at-once-both-banish",
    title: "FFA3: Summoning Curse of p0, then The Grave of Enkindling Special Summons a monster for p0, p1 and p2 at once: each of the three controllers banishes 1 card from its own hand",
    source: OPP_FIELD,
    rules: ["R-COMMON-OPP-FIELD", "R-FFA-ORDER"],
    tags: ["multiplayer", "trigger", "banish", "ffa3", "card:61650133"],
    setup: {
      format: "ffa3",
      p0: { monsters: ["Giant Rat"], spells: [{ card: "The Grave of Enkindling", pos: "set" }, { card: "Summoning Curse", pos: "set" }] },
      p1: { monsters: ["Battle Ox"], grave: ["Celtic Guardian"] },
      p2: { grave: ["Axe Raider"] },
    },
    steps: [
      ...["p0", "p1", "p2"].map((seat) => endTurn(seat as Seat)),
      activate("Summoning Curse", "p0"),
      endTurn("p0"),
      yes("p0"),
      changePhase("battle", "p1"),
      attack("Battle Ox", { card: "Giant Rat", owner: "p0" }, "p1"),
      activate("The Grave of Enkindling", "p0"),
      selectBy("p1", "Mystical Elf"),
      // 8000 - 300 (battle) - 500 (maintenance of the Curse). p1 chose its card; p0 and p2 had no choice. Each of the three banished exactly one.
      everySeat("ffa3", {
        p0: { lp: 7200, monsters: ["Giant Rat"], spells: ["Summoning Curse"], grave: ["The Grave of Enkindling"], banished: ["Mystical Elf"] },
        p1: { monsters: ["Battle Ox", "Celtic Guardian"], banished: ["Mystical Elf"] },
        p2: { monsters: ["Axe Raider"], banished: ["Mystical Elf"] },
      }),
    ],
  }),
  defineScenario({
    id: "table-tag-summoning-curse-two-opposing-duelists-summon-at-once-both-banish",
    title: "Tag: Summoning Curse of p0, then The Grave of Enkindling Special Summons a monster for p0, p1 and p3 at once: p0, p1 and p3 each banish 1 card from their own hand (p2 summoned nothing)",
    source: OPP_FIELD,
    rules: ["R-COMMON-OPP-FIELD", "R-TAG-PARTNER"],
    tags: ["multiplayer", "trigger", "banish", "tag", "card:61650133"],
    setup: {
      format: "tag",
      p0: { hand: [ELF], monsters: ["Giant Rat"], spells: [{ card: "The Grave of Enkindling", pos: "set" }, { card: "Summoning Curse", pos: "set" }] },
      p1: { hand: [ELF], monsters: ["Battle Ox"], grave: ["Celtic Guardian"] },
      p3: { hand: [ELF], grave: ["Axe Raider"] },
    },
    steps: [
      ...["p0", "p1", "p2", "p3"].map((seat) => endTurn(seat as Seat)),
      activate("Summoning Curse", "p0"),
      endTurn("p0"),
      yes("p0"),
      changePhase("battle", "p1"),
      attack("Battle Ox", { card: "Giant Rat", owner: "p0" }, "p1"),
      activate("The Grave of Enkindling", "p0"),
      selectBy("p0", "Mystical Elf"),
      selectBy("p1", "Mystical Elf"),
      selectBy("p3", "Mystical Elf"),
      // The team life points: 16000 - 300 (battle) - 500 (maintenance of the Curse). p0, p1 and p3 each banished exactly one card of their own hand; p2 summoned nothing and banished nothing.
      everySeat("tag", {
        p0: { lp: 15200, hand: [ELF], monsters: ["Giant Rat"], spells: ["Summoning Curse"], grave: ["The Grave of Enkindling"], banished: [ELF] },
        p1: { hand: [ELF, ELF], monsters: ["Battle Ox", "Celtic Guardian"], banished: [ELF] },
        p2: { lp: 15200, hand: [ELF] },
        p3: { hand: [ELF], monsters: ["Axe Raider"], banished: [ELF] },
      }),
    ],
  }),
  defineScenario({
    id: "table-ffa3-diabellstar-opponent-eliminated-before-the-trigger-no-effect-no-lua-error",
    title: "FFA3: p0 attacks the monster of p1 with Snake-Eyes Diabellstar and p1 is eliminated before the trigger is answered: the effect does not apply (OQ3), no script fails, and p0 and p2 keep their monsters",
    source: OPP_PICK,
    rules: ["R-COMMON-OPP-PICK"],
    tags: ["multiplayer", "trigger", "elimination", "ffa3", "card:27260347"],
    setup: {
      format: "ffa3",
      p0: { monsters: ["Snake-Eyes Diabellstar"] },
      p1: { monsters: ["Battle Ox"] },
      p2: { monsters: ["Giant Rat"] },
    },
    steps: [
      ...["p0", "p1", "p2"].map((seat) => endTurn(seat as Seat)),
      changePhase("battle", "p0"),
      attack("Snake-Eyes Diabellstar", { card: "Battle Ox", owner: "p1" }, "p0"),
      // The loss lands at the next Adjust. The bound opponent of the trigger is p1, which is dead when the trigger is checked.
      // Stock: Duel.GetLocationCount of that seat gives no value and "nothing > 0" is a Lua error that stops the duel.
      surrender("p1"),
      yes("p0"),
      expectEliminated("p1"),
      expectPrompt({ by: "p0", title: "replay occurred" }),
      everySeat("ffa3", { p0: { monsters: ["Snake-Eyes Diabellstar"] }, p2: { monsters: ["Giant Rat"] } }),
    ],
  }),
  defineScenario({
    id: "table-ffa4-diabellstar-opponent-eliminated-before-the-trigger-no-effect-no-lua-error",
    title: "FFA4: p0 attacks the monster of p1 with Snake-Eyes Diabellstar and p1 is eliminated before the trigger is answered: the effect does not apply (OQ3), no script fails, and p0, p2 and p3 keep their monsters",
    source: OPP_PICK,
    rules: ["R-COMMON-OPP-PICK"],
    tags: ["multiplayer", "trigger", "elimination", "ffa4", "card:27260347"],
    setup: {
      format: "ffa4",
      p0: { monsters: ["Snake-Eyes Diabellstar"] },
      p1: { monsters: ["Battle Ox"] },
      p2: { monsters: ["Giant Rat"] },
      p3: { monsters: ["Axe Raider"] },
    },
    steps: [
      ...["p0", "p1", "p2", "p3"].map((seat) => endTurn(seat as Seat)),
      changePhase("battle", "p0"),
      attack("Snake-Eyes Diabellstar", { card: "Battle Ox", owner: "p1" }, "p0"),
      surrender("p1"),
      yes("p0"),
      expectEliminated("p1"),
      expectPrompt({ by: "p0", title: "replay occurred" }),
      everySeat("ffa4", { p0: { monsters: ["Snake-Eyes Diabellstar"] }, p2: { monsters: ["Giant Rat"] }, p3: { monsters: ["Axe Raider"] } }),
    ],
  }),
];
