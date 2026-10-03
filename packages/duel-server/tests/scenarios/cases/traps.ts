import {
  activate, attack, changePhase, defineScenario, endTurn, expectBoard, expectNoEvent, expectNotOffered, expectOffered, expectPrompt,
  faceDown, normalSummon, type Scenario,
} from "../../support/dsl.js";

export const scenarios: Scenario[] = [
  defineScenario({
    id: "mirror-force-destroys-attackers",
    title: "Mirror Force destroys every Attack Position monster the opponent controls and ends the attack",
    source: "https://yugioh.fandom.com/wiki/Mirror_Force",
    tags: ["trap", "battle", "destroy", "negate-attack"],
    setup: {
      attackFirstTurn: true,
      p0: { monsters: ["Blue-Eyes White Dragon", "Celtic Guardian"] },
      p1: { monsters: ["Giant Rat"], spells: [faceDown("Mirror Force")] },
    },
    steps: [
      attack("Blue-Eyes White Dragon", "Giant Rat"),
      activate("Mirror Force", "p1"),
      expectBoard({
        p0: { monsters: [], grave: ["Blue-Eyes White Dragon", "Celtic Guardian"], lp: 8000 },
        p1: { monsters: ["Giant Rat"], grave: ["Mirror Force"], lp: 8000 },
      }),
      expectNoEvent({ kind: "damage" }),
    ],
  }),

  defineScenario({
    id: "torrential-tribute-destroys-all-on-summon",
    title: "Torrential Tribute destroys all monsters on the field when a monster is Summoned",
    source: "https://yugioh.fandom.com/wiki/Torrential_Tribute",
    tags: ["trap", "destroy", "summon-response"],
    setup: {
      p0: { hand: ["Celtic Guardian"], monsters: ["Gemini Elf"] },
      p1: { monsters: ["Summoned Skull"], spells: [faceDown("Torrential Tribute")] },
    },
    steps: [
      normalSummon("Celtic Guardian"),
      activate("Torrential Tribute", "p1"),
      expectBoard({
        p0: { monsters: [], grave: ["Celtic Guardian", "Gemini Elf"] },
        p1: { monsters: [], grave: ["Summoned Skull", "Torrential Tribute"] },
      }),
    ],
  }),

  defineScenario({
    id: "bottomless-trap-hole-banishes-strong-summon",
    title: "Bottomless Trap Hole destroys and banishes a Summoned monster with 1500 or more ATK",
    source: "https://yugioh.fandom.com/wiki/Bottomless_Trap_Hole",
    tags: ["trap", "banish", "summon-response"],
    setup: {
      p0: { hand: ["Gemini Elf"] },
      p1: { spells: [faceDown("Bottomless Trap Hole")] },
    },
    steps: [
      normalSummon("Gemini Elf"),
      activate("Bottomless Trap Hole", "p1"),
      expectBoard({
        p0: { monsters: [], banished: ["Gemini Elf"], grave: [] },
        p1: { grave: ["Bottomless Trap Hole"] },
      }),
    ],
  }),

  defineScenario({
    id: "solemn-judgment-negates-normal-summon",
    title: "Solemn Judgment pays half LP to negate and destroy a Normal Summon",
    source: "https://yugioh.fandom.com/wiki/Solemn_Judgment",
    tags: ["trap", "counter-trap", "negate-summon", "lp-cost"],
    setup: {
      p0: { hand: ["Celtic Guardian"] },
      p1: { spells: [faceDown("Solemn Judgment")] },
    },
    steps: [
      normalSummon("Celtic Guardian"),
      activate("Solemn Judgment", "p1"),
      expectBoard({
        p0: { monsters: [], grave: ["Celtic Guardian"], hand: [] },
        p1: { lp: 4000, grave: ["Solemn Judgment"] },
      }),
    ],
  }),

  defineScenario({
    id: "swords-of-revealing-light-stops-attacks",
    title: "Swords of Revealing Light stops the opponent's monsters from attacking on their next turn",
    source: "https://yugioh.fandom.com/wiki/Swords_of_Revealing_Light",
    tags: ["spell", "battle", "attack-prevented", "flip"],
    setup: {
      p0: { hand: ["Swords of Revealing Light"], monsters: ["Gemini Elf"] },
      p1: { monsters: [{ card: "Summoned Skull", pos: "atk" }] },
    },
    steps: [
      activate("Swords of Revealing Light"),
      endTurn(),
      changePhase("battle", "p1"),
      expectPrompt({ by: "p1", title: "battle action" }),
      expectNotOffered("attack", "Summoned Skull"),
    ],
  }),

  defineScenario({
    id: "swords-of-revealing-light-control-attack-offered",
    title: "Control for the Swords case: without Swords the same monster may attack",
    source: "https://yugioh.fandom.com/wiki/Swords_of_Revealing_Light",
    tags: ["battle", "control-case"],
    setup: {
      p0: { monsters: ["Gemini Elf"] },
      p1: { monsters: ["Summoned Skull"] },
    },
    steps: [
      endTurn(),
      changePhase("battle", "p1"),
      expectPrompt({ by: "p1", title: "battle action" }),
      expectOffered("attack", "Summoned Skull"),
    ],
  }),
];
