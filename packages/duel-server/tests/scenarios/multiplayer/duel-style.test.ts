import { describe, expect, it } from "vitest";
import { seatCountFor, teamOfSeat } from "@yugidraft/shared/duels";
import { outcomeAsserts } from "../../../scripts/rule-coverage.js";
import { describeWithCores } from "../../support/cores.js";
import {
  activate, attack, changePhase, choose, endTurn, expectBoard, expectLp, expectPickSeats, normalSummon,
  pickOpponent, select, yes, zone, type Scenario,
} from "../../support/dsl.js";
import { defineScenarioWithFfaFirstDraw as defineScenario } from "./ffa-first-draw.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import { ELF, SOURCE } from "./nseat-scenarios.js";

// Live-engine scenarios (real card scripts, real multi core) for the cards that act on you and ONE picked opponent: the duel-style
// cards (Q4), the swap of control (Q7), the Tribute of an opponent monster (Q8), the cards that need no script wrapper (the first
// unbound read of the opponent makes the core ask the activator for a pick), and three shapes of an effect that Special Summons to
// the field of an opponent (OQ2). Each scenario asserts the final state of every seat that the rule touches.
// Tag seats: p0 and p2 are team 0, p1 and p3 are team 1.

const Q4 = `${SOURCE} [R-COMMON-OPP-PICK], answers to the ten triage questions, 4 (duel-style cards)`;
const Q7 = `${SOURCE} [R-FFA-OPP-ONE] [R-TAG-SHARED-CARDS], answers to the ten triage questions, 7 (swap of control)`;
const Q8 = `${SOURCE} [R-FFA-OPP-ONE] [R-TAG-SHARED-CARDS], answers to the ten triage questions, 8 (Tribute of an opponent monster)`;
const SUMMON = `${SOURCE} [R-COMMON-OPP-PICK], a summon to the field of an opponent: the summoning player picks one opponent`;
const NO_WRAPPER = `${SOURCE} [R-COMMON-OPP-PICK], the other cards use the defaults`;
const OWNER_LP = `${SOURCE} [R-FFA-OPP-ONE/R-TAG-LP], finding s2-duelstyle-swap-1: Snatch Steal gives the LP to the owner of the stolen monster, in the Standby Phase of that owner`;

type Seat = "p0" | "p1" | "p2" | "p3";

export const DUEL_STYLE_SCENARIOS: Scenario[] = [
  defineScenario({
    id: "duel-style-trading-places-ffa3-swaps-with-the-picked-opponent",
    title: "FFA3: Trading Places asks for an opponent at activation and swaps LP with that opponent only",
    source: Q4,
    rules: ["R-COMMON-OPP-PICK"],
    tags: ["multiplayer", "duel-style", "lp", "ffa3", "card:63875853"],
    setup: { format: "ffa3", p0: { hand: ["Trading Places"] }, p1: { lp: 6000 }, p2: { lp: 2000 } },
    steps: [
      activate("Trading Places", "p0"),
      expectPickSeats(["p1", "p2"], "p0"),
      pickOpponent("p2", "p0"),
      expectLp({ seat: "p0" }, 2000),
      expectLp({ seat: "p1" }, 6000),
      expectLp({ seat: "p2" }, 8000),
    ],
  }),
  defineScenario({
    id: "duel-style-trading-places-tag-swaps-the-team-lp",
    title: "Tag: Trading Places asks for no pick (the opposing team has one LP total) and swaps the team LP of the two teams",
    source: Q4,
    rules: ["R-COMMON-OPP-PICK", "R-TAG-LP"],
    tags: ["multiplayer", "duel-style", "lp", "tag", "card:63875853"],
    setup: { format: "tag", p0: { hand: ["Trading Places"] }, p1: { lp: 4000 } },
    steps: [
      expectLp({ team: 0 }, 16000),
      expectLp({ team: 1 }, 4000),
      activate("Trading Places", "p0"),
      expectLp({ team: 0 }, 4000),
      expectLp({ team: 1 }, 16000),
    ],
  }),
  defineScenario({
    id: "duel-style-loss-time-ffa4-reads-only-the-picked-opponent",
    title: "FFA4: Loss Time sets your LP to 1000 less than the picked opponent, the other two opponents do nothing",
    source: Q4,
    rules: ["R-COMMON-OPP-PICK"],
    tags: ["multiplayer", "duel-style", "lp", "ffa4", "card:72453068"],
    setup: { format: "ffa4", p0: { spells: [{ card: "Loss Time", pos: "set" }] }, p1: { lp: 5000 }, p2: { lp: 6000 }, p3: { lp: 7000 } },
    steps: [
      activate("Loss Time", "p0"),
      expectPickSeats(["p1", "p2", "p3"], "p0"),
      pickOpponent("p3", "p0"),
      expectLp({ seat: "p0" }, 6000),
      expectLp({ seat: "p1" }, 5000),
      expectLp({ seat: "p2" }, 6000),
      expectLp({ seat: "p3" }, 7000),
    ],
  }),
  defineScenario({
    id: "duel-style-reversal-quiz-ffa3-swaps-with-the-picked-opponent",
    title: "FFA3: Reversal Quiz, after a right guess of the top card, swaps LP with the picked opponent only",
    source: Q4,
    rules: ["R-COMMON-OPP-PICK"],
    tags: ["multiplayer", "duel-style", "lp", "ffa3", "card:5990062"],
    setup: { format: "ffa3", p0: { hand: ["Reversal Quiz", ELF], deck: [ELF] }, p1: { lp: 1000 }, p2: { lp: 3000 } },
    steps: [
      activate("Reversal Quiz", "p0"),
      zone("p0", "s0", "p0"),
      // No target and no read of the opponent in the cost: the core asks at the first read, in the operation, after the guess.
      choose("Monster", "p0"),
      expectPickSeats(["p1", "p2"], "p0"),
      pickOpponent("p1", "p0"),
      expectLp({ seat: "p0" }, 1000),
      expectLp({ seat: "p1" }, 8000),
      expectLp({ seat: "p2" }, 3000),
    ],
  }),
  defineScenario({
    id: "duel-style-reversal-quiz-tag-swaps-team-lp",
    title: "Tag: Reversal Quiz, after a right guess, asks for no pick and swaps the team LP of the two teams",
    source: Q4,
    rules: ["R-COMMON-OPP-PICK", "R-TAG-LP"],
    tags: ["multiplayer", "duel-style", "lp", "tag", "card:5990062"],
    setup: { format: "tag", p0: { hand: ["Reversal Quiz", ELF], deck: [ELF] }, p1: { lp: 3000 } },
    steps: [
      activate("Reversal Quiz", "p0"),
      zone("p0", "s0", "p0"),
      choose("Monster", "p0"),
      expectLp({ team: 0 }, 3000),
      expectLp({ team: 1 }, 16000),
    ],
  }),
  defineScenario({
    id: "duel-style-dragged-down-ffa3-acts-on-the-picked-opponent-hand",
    title: "FFA3: Dragged Down into the Grave takes a card from your hand and from the hand of the picked opponent only",
    source: Q4,
    rules: ["R-COMMON-OPP-PICK"],
    tags: ["multiplayer", "duel-style", "hand", "ffa3", "card:16435215"],
    setup: {
      format: "ffa3",
      p0: { hand: ["Dragged Down into the Grave", "Raigeki"], deck: [ELF] },
      p1: { hand: ["Dark Hole"], deck: [ELF] },
      p2: { hand: ["Mind Crush"], deck: [ELF] },
    },
    steps: [
      activate("Dragged Down into the Grave", "p0"),
      expectPickSeats(["p1", "p2"], "p0"),
      pickOpponent("p2", "p0"),
      // Each affected hand has one card. The host selects both discards.
      expectBoard({
        p0: { grave: ["Dragged Down into the Grave", "Raigeki"], hand: [ELF] },
        p1: { hand: ["Dark Hole"], grave: { count: 0 } },
        p2: { grave: ["Mind Crush"], hand: [ELF] },
      }),
    ],
  }),
  // --- Q7: swap of control
  defineScenario({
    id: "swap-psychic-jumper-ffa3-swaps-with-a-monster-of-any-opponent",
    title: "FFA3: Psychic Jumper swaps one of your Psychic monsters with a monster of the opponent you choose, the other opponent keeps all",
    source: Q7,
    rules: ["R-FFA-OPP-ONE"],
    tags: ["multiplayer", "swap-control", "ffa3", "card:52430902"],
    setup: {
      format: "ffa3",
      p0: { monsters: ["Psychic Jumper", "Psychic Commander"] },
      p1: { monsters: [ELF] },
      p2: { monsters: ["Summoned Skull"] },
    },
    steps: [
      activate("Psychic Jumper", "p0"),
      // R-FFA-OPP-ONE: the declared opponent has one target, which the engine selects.
      pickOpponent("p2", "p0"),
      expectBoard({
        p0: { lp: 7000, monsters: ["Psychic Jumper", "Summoned Skull"] },
        p1: { lp: 8000, monsters: [ELF] },
        p2: { lp: 8000, monsters: ["Psychic Commander"] },
      }),
    ],
  }),
  defineScenario({
    id: "swap-psychic-jumper-tag-swaps-with-an-opposing-monster-never-the-partner",
    title: "Tag: Psychic Jumper offers the monsters of the two opposing duelists only and swaps with the one you choose, team LP pays the cost",
    source: Q7,
    rules: ["R-TAG-SHARED-CARDS", "R-TAG-PARTNER", "R-TAG-LP"],
    tags: ["multiplayer", "swap-control", "tag", "card:52430902"],
    setup: {
      format: "tag",
      p0: { monsters: ["Psychic Jumper", "Psychic Commander"] },
      p1: { monsters: [ELF] },
      p2: { monsters: ["Summoned Skull"] },
      p3: { monsters: ["Dark Magician"] },
    },
    steps: [
      activate("Psychic Jumper", "p0"),
      select({ card: "Dark Magician", owner: "p3" }),
      expectBoard({
        p0: { monsters: ["Psychic Jumper", "Dark Magician"] },
        p1: { monsters: [ELF] },
        p2: { monsters: ["Summoned Skull"] },
        p3: { monsters: ["Psychic Commander"] },
      }),
      expectLp({ team: 0 }, 15000),
      expectLp({ team: 1 }, 16000),
    ],
  }),
  // --- Q8: Tribute of an opponent monster
  defineScenario({
    id: "tribute-soul-exchange-ffa3-tributes-a-monster-of-any-opponent",
    title: "FFA3: Soul Exchange targets a monster of the second opponent and a Tribute Summon uses it, the first opponent keeps all",
    source: Q8,
    rules: ["R-FFA-OPP-ONE"],
    tags: ["multiplayer", "tribute", "ffa3", "card:68005187"],
    setup: {
      format: "ffa3",
      p0: { hand: ["Soul Exchange", "Summoned Skull"] },
      p1: { monsters: [ELF] },
      p2: { monsters: [ELF] },
    },
    steps: [
      activate("Soul Exchange", "p0"),
      // R-FFA-OPP-ONE: the declared opponent has one target, which the engine selects.
      pickOpponent("p2", "p0"),
      normalSummon("Summoned Skull", "p0"),
      select({ card: ELF, owner: "p2" }),
      expectBoard({
        p0: { monsters: ["Summoned Skull"] },
        p1: { monsters: [ELF] },
        p2: { monsters: { count: 0 }, grave: [ELF] },
      }),
    ],
  }),
  defineScenario({
    id: "tribute-soul-exchange-tag-tributes-an-opposing-monster",
    title: "Tag: Soul Exchange targets a monster of an opposing duelist and a Tribute Summon uses it",
    source: Q8,
    rules: ["R-TAG-SHARED-CARDS", "R-TAG-PARTNER"],
    tags: ["multiplayer", "tribute", "tag", "card:68005187"],
    setup: {
      format: "tag",
      p0: { hand: ["Soul Exchange", "Summoned Skull"] },
      p1: { monsters: [ELF] },
      p2: { monsters: ["Psychic Commander"] },
      p3: { monsters: [ELF] },
    },
    steps: [
      activate("Soul Exchange", "p0"),
      select({ card: ELF, owner: "p3" }),
      normalSummon("Summoned Skull", "p0"),
      select({ card: ELF, owner: "p3" }),
      expectBoard({
        p0: { monsters: ["Summoned Skull"] },
        p1: { monsters: [ELF] },
        p2: { monsters: ["Psychic Commander"] },
        p3: { monsters: { count: 0 }, grave: [ELF] },
      }),
    ],
  }),
  // --- no wrapper: the stock script on the bind of the core
  defineScenario({
    id: "no-wrapper-snatch-steal-ffa3-takes-a-monster-of-any-opponent",
    title: "FFA3: Snatch Steal equips a monster of the second opponent and takes control of it, the first opponent keeps all",
    source: NO_WRAPPER,
    rules: ["R-FFA-OPP-ONE"],
    tags: ["multiplayer", "no-wrapper", "equip", "steal", "ffa3", "card:45986603"],
    setup: {
      format: "ffa3",
      p0: { hand: ["Snatch Steal"] },
      p1: { monsters: [ELF] },
      p2: { monsters: ["Summoned Skull"] },
    },
    steps: [
      activate("Snatch Steal", "p0"),
      select({ card: "Summoned Skull", owner: "p2" }),
      expectBoard({
        p0: { monsters: ["Summoned Skull"], spells: ["Snatch Steal"] },
        p1: { monsters: [ELF], spells: { count: 0 } },
        p2: { monsters: { count: 0 } },
      }),
    ],
  }),
  defineScenario({
    id: "no-wrapper-hero-counterattack-ffa3-bound-opponent-picks-at-random-from-your-hand",
    title: "FFA3: Hero Counterattack, after a Hero is destroyed in battle, lets the opponent that attacked pick at random from your hand",
    source: `${SOURCE} [R-FFA-OPP-RESPONSE]: Hero Counterattack binds the attacker`,
    rules: ["R-FFA-OPP-RESPONSE"],
    tags: ["multiplayer", "no-wrapper", "trap", "ffa3", "card:19024706"],
    setup: {
      format: "ffa3",
      p0: {
        monsters: ["Elemental HERO Avian"],
        // All drawn cards are the same Hero, so every random pick finds a Hero.
        hand: ["Elemental HERO Sparkman"],
        deck: ["Elemental HERO Sparkman"],
        spells: [{ card: "Hero Counterattack", pos: "set" }],
      },
      p1: { monsters: ["Summoned Skull"] },
      p2: { monsters: [ELF] },
    },
    steps: [
      // R-FFA-NO-ATTACK: p1 has no Battle Phase on turn 2. It attacks on turn 5.
      ...["p0", "p1", "p2", "p0"].map((seat) => endTurn(seat as Seat)),
      changePhase("battle", "p1"),
      attack("Summoned Skull", "Elemental HERO Avian", "p1"),
      activate("Hero Counterattack", "p0"),
      // R-FFA-OPP-RESPONSE: the attacker is the bound opponent. No opponent pick is needed.
      // The host selects the attacker's only monster, then Special Summons the chosen HERO.
      expectBoard({
        p0: { monsters: ["Elemental HERO Sparkman"], hand: ["Elemental HERO Sparkman"], grave: ["Elemental HERO Avian", "Hero Counterattack"] },
        p1: { monsters: { count: 0 }, grave: ["Summoned Skull"] },
        p2: { monsters: [ELF] },
      }),
    ],
  }, { card: "Elemental HERO Sparkman" }),
  // --- OQ2: three shapes of an effect that Special Summons to the field of an opponent
  defineScenario({
    id: "opponent-field-summon-foolish-revival-ffa3-summons-a-card-to-the-picked-opponent",
    title: "FFA3: Foolish Revival (a card) asks for an opponent at activation and Special Summons the card to that opponent's field only",
    source: SUMMON,
    rules: ["R-COMMON-OPP-PICK"],
    tags: ["multiplayer", "opponent-field-summon", "card", "ffa3", "card:83778600"],
    setup: {
      format: "ffa3",
      p0: { spells: [{ card: "Foolish Revival", pos: "set" }] },
      p1: { grave: ["Summoned Skull"] },
      p2: { grave: ["Dark Magician"] },
    },
    steps: [
      activate("Foolish Revival", "p0"),
      expectPickSeats(["p1", "p2"], "p0"),
      pickOpponent("p2", "p0"),
      // R-FFA-OPP-ONE: the picked Graveyard has one monster, which the engine selects.
      expectBoard({
        p0: { monsters: { count: 0 }, grave: ["Foolish Revival"] },
        p1: { monsters: { count: 0 }, grave: ["Summoned Skull"] },
        p2: { monsters: ["Dark Magician"], grave: { count: 0 } },
      }),
    ],
  }),
  defineScenario({
    id: "opponent-field-summon-ojama-trio-ffa3-summons-the-tokens-to-the-picked-opponent",
    title: "FFA3: Ojama Trio (tokens) asks for an opponent at activation and Special Summons 3 tokens to that opponent's field only",
    source: SUMMON,
    rules: ["R-COMMON-OPP-PICK"],
    tags: ["multiplayer", "opponent-field-summon", "token", "ffa3", "card:29843091"],
    setup: { format: "ffa3", p0: { spells: [{ card: "Ojama Trio", pos: "set" }] } },
    steps: [
      activate("Ojama Trio", "p0"),
      expectPickSeats(["p1", "p2"], "p0"),
      pickOpponent("p1", "p0"),
      expectBoard({
        p0: { monsters: { count: 0 }, grave: ["Ojama Trio"] },
        p1: { monsters: { count: 3 } },
        p2: { monsters: { count: 0 } },
      }),
    ],
  }),
  defineScenario({
    id: "opponent-field-summon-fire-ejection-ffa3-yes-no-prompt-then-a-token-to-the-picked-opponent",
    title: "FFA3: Fire Ejection (a yes/no prompt) asks for an opponent, then the yes answer Special Summons the token to that opponent only",
    source: SUMMON,
    rules: ["R-COMMON-OPP-PICK"],
    tags: ["multiplayer", "opponent-field-summon", "yes-no", "token", "ffa3", "card:11654067"],
    setup: { format: "ffa3", p0: { hand: ["Fire Ejection"], deck: [ELF, "Volcanic Rat"] } },
    steps: [
      activate("Fire Ejection", "p0"),
      expectPickSeats(["p1", "p2"], "p0"),
      pickOpponent("p2", "p0"),
      yes("p0"),
      choose("token", "p0"),
      expectBoard({
        p0: { monsters: { count: 0 }, grave: ["Fire Ejection", "Volcanic Rat"] },
        p1: { monsters: { count: 0 } },
        p2: { monsters: { count: 1 } },
      }),
    ],
  }),
  defineScenario({
    id: "no-wrapper-snatch-steal-tag-takes-a-monster-of-an-opposing-duelist",
    title: "Tag: Snatch Steal offers the monsters of the two opposing duelists and takes the one you choose, the partner keeps its monster",
    source: NO_WRAPPER,
    rules: ["R-TAG-SHARED-CARDS", "R-TAG-PARTNER"],
    tags: ["multiplayer", "no-wrapper", "equip", "steal", "tag", "card:45986603"],
    setup: {
      format: "tag",
      p0: { hand: ["Snatch Steal"] },
      p1: { monsters: [ELF] },
      p2: { monsters: ["Dark Magician"] },
      p3: { monsters: ["Summoned Skull"] },
    },
    steps: [
      activate("Snatch Steal", "p0"),
      select({ card: "Summoned Skull", owner: "p3" }),
      expectBoard({
        p0: { monsters: ["Summoned Skull"], spells: ["Snatch Steal"] },
        p1: { monsters: [ELF] },
        p2: { monsters: ["Dark Magician"] },
        p3: { monsters: { count: 0 } },
      }),
    ],
  }),
  defineScenario({
    id: "opponent-field-summon-ojama-trio-tag-summons-the-tokens-to-an-opposing-duelist",
    title: "Tag: Ojama Trio asks for an opposing duelist (not the partner) and the 3 tokens go to that duelist only",
    source: SUMMON,
    rules: ["R-COMMON-OPP-PICK", "R-TAG-PARTNER"],
    tags: ["multiplayer", "opponent-field-summon", "token", "tag", "card:29843091"],
    setup: { format: "tag", p0: { spells: [{ card: "Ojama Trio", pos: "set" }] } },
    steps: [
      activate("Ojama Trio", "p0"),
      expectPickSeats(["p1", "p3"], "p0"),
      pickOpponent("p3", "p0"),
      expectBoard({
        p0: { monsters: { count: 0 } },
        p1: { monsters: { count: 0 } },
        p2: { monsters: { count: 0 } },
        p3: { monsters: { count: 3 } },
      }),
    ],
  }),
  defineScenario({
    id: "opponent-field-summon-foolish-revival-ffa4-summons-a-card-to-the-picked-opponent",
    title: "FFA4: Foolish Revival asks for one of three opponents and Special Summons the card to that opponent's field only",
    source: SUMMON,
    rules: ["R-COMMON-OPP-PICK"],
    tags: ["multiplayer", "opponent-field-summon", "card", "ffa4", "card:83778600"],
    setup: {
      format: "ffa4",
      p0: { spells: [{ card: "Foolish Revival", pos: "set" }] },
      p1: { grave: ["Summoned Skull"] },
      p2: { grave: ["Dark Magician"] },
      p3: { grave: ["Gaia The Fierce Knight"] },
    },
    steps: [
      activate("Foolish Revival", "p0"),
      expectPickSeats(["p1", "p2", "p3"], "p0"),
      pickOpponent("p3", "p0"),
      // R-FFA-OPP-ONE: the picked Graveyard has one monster, which the engine selects.
      expectBoard({
        p1: { monsters: { count: 0 }, grave: ["Summoned Skull"] },
        p2: { monsters: { count: 0 }, grave: ["Dark Magician"] },
        p3: { monsters: ["Gaia The Fierce Knight"], grave: { count: 0 } },
      }),
    ],
  }),
  // --- s2-duelstyle-swap-1: the 1000 LP of Snatch Steal go to the OWNER of the stolen monster, in its own Standby Phase, with no pick
  defineScenario({
    id: "owner-lp-snatch-steal-ffa3-only-the-owner-gains-the-lp-in-its-own-standby-phase",
    title: "FFA3: the 1000 LP of Snatch Steal go to the owner of the stolen monster (p2) in its own Standby Phase, with no pick, and to nobody else",
    source: OWNER_LP,
    rules: ["R-FFA-OPP-ONE", "R-FFA-ORDER"],
    tags: ["multiplayer", "equip", "steal", "lp", "ffa3", "card:45986603"],
    setup: {
      format: "ffa3",
      p0: { hand: ["Snatch Steal"] },
      p1: { monsters: [ELF] },
      p2: { monsters: ["Summoned Skull"] },
    },
    steps: [
      activate("Snatch Steal", "p0"),
      select({ card: "Summoned Skull", owner: "p2" }),
      endTurn("p0"),
      // The Standby Phase of p1 (not the owner): nobody is asked and nobody gains LP.
      expectLp({ seat: "p0" }, 8000),
      expectLp({ seat: "p1" }, 8000),
      expectLp({ seat: "p2" }, 8000),
      endTurn("p1"),
      // The Standby Phase of p2 (the owner): p2 gains 1000 LP, nobody is asked.
      expectLp({ seat: "p0" }, 8000),
      expectLp({ seat: "p1" }, 8000),
      expectLp({ seat: "p2" }, 9000),
      endTurn("p2"),
      endTurn("p0"),
      endTurn("p1"),
      // The next Standby Phase of p2: the effect gives the LP again, once more to p2 only.
      expectLp({ seat: "p0" }, 8000),
      expectLp({ seat: "p1" }, 8000),
      expectLp({ seat: "p2" }, 10000),
      expectBoard({
        p0: { monsters: ["Summoned Skull"], spells: ["Snatch Steal"] },
        p2: { monsters: { count: 0 } },
      }),
    ],
  }),
  defineScenario({
    id: "owner-lp-snatch-steal-tag-only-the-team-of-the-owner-gains-the-lp-in-the-turn-of-the-owner",
    title: "Tag: the 1000 LP of Snatch Steal go to the team of the owner (p3) in the turn of p3 only, not in the turn of its partner p1",
    source: OWNER_LP,
    rules: ["R-TAG-LP", "R-TAG-PARTNER", "R-TAG-ORDER"],
    tags: ["multiplayer", "equip", "steal", "lp", "tag", "card:45986603"],
    setup: {
      format: "tag",
      p0: { hand: ["Snatch Steal"] },
      p1: { monsters: [ELF] },
      p2: { monsters: ["Dark Magician"] },
      p3: { monsters: ["Summoned Skull"] },
    },
    steps: [
      activate("Snatch Steal", "p0"),
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
      // The Standby Phase of p3, the owner: the team of p3 gains 1000 LP.
      expectLp({ team: 0 }, 16000),
      expectLp({ team: 1 }, 17000),
      expectBoard({
        p0: { monsters: ["Summoned Skull"], spells: ["Snatch Steal"] },
        p3: { monsters: { count: 0 } },
      }),
    ],
  }),
];

describeWithCores("live N-seat scenarios: duel-style, swap of control, Tribute, no wrapper, opponent-field summon", liveNseat, () => {
  runScenarios("multiplayer/duel-style", DUEL_STYLE_SCENARIOS);
});

describe("duel-style scenario list", () => {
  it("has unique ids, a source, a multi-seat format, the rules it proves and an outcome after an action", () => {
    expect(new Set(DUEL_STYLE_SCENARIOS.map((s) => s.id)).size).toBe(DUEL_STYLE_SCENARIOS.length);
    for (const s of DUEL_STYLE_SCENARIOS) {
      expect(s.source, s.id).toBeTruthy();
      expect(seatCountFor(s.setup.format ?? "1v1"), s.id).toBeGreaterThan(2);
      if (!s.knownBug) {
        expect(s.rules?.length, s.id).toBeGreaterThan(0);
        expect(outcomeAsserts(s.steps), s.id).toBe(true);
      }
    }
  });

  it("asks for an opponent pick only while the picker has two or more opponents", () => {
    const seatOf = (id: string) => Number(id.slice(1));
    for (const s of DUEL_STYLE_SCENARIOS) {
      const format = s.setup.format ?? "1v1";
      for (const step of s.steps) {
        if (step.op !== "pickOpponent") continue;
        expect(step.by, `${s.id}: pickOpponent names the picker`).toBeDefined();
        const picker = seatOf(step.by!);
        const opponents = Array.from({ length: seatCountFor(format) }, (_, seat) => seat).filter(
          (seat) => teamOfSeat(format, seat) !== teamOfSeat(format, picker),
        );
        expect(opponents.length, `${s.id}: opponents of ${step.by}`).toBeGreaterThanOrEqual(2);
        expect(opponents, s.id).toContain(seatOf(step.seat));
      }
    }
  });

  it("names the card passcode of each scenario in a card: tag", () => {
    for (const s of DUEL_STYLE_SCENARIOS) {
      expect(s.tags.some((tag) => /^card:\d+$/.test(tag)), s.id).toBe(true);
    }
  });
});
