import {
  activate, defineScenario, endTurn, expectBoard, expectEvents, expectResolved, faceDown, select, type Scenario,
} from "../../support/dsl.js";

export const scenarios: Scenario[] = [
  defineScenario({
    id: "royal-magical-library-counts-spell-counters",
    title: "Royal Magical Library gets 1 Spell Counter for each Spell that resolves, and the view shows type and count",
    source: "https://yugioh.fandom.com/wiki/Royal_Magical_Library",
    tags: ["spell", "counters"],
    setup: {
      p0: { hand: ["Dian Keto the Cure Master", "Dian Keto the Cure Master"], monsters: ["Royal Magical Library"] },
    },
    steps: [
      activate("Dian Keto the Cure Master"),
      expectBoard({ p0: { lp: 9000, zones: { m0: { card: "Royal Magical Library", counters: { 1: 1 } } } } }),
      activate("Dian Keto the Cure Master"),
      // COUNTER_SPELL is 0x1. A swapped parse shows { 2: 1 } here.
      expectBoard({ p0: { lp: 10000, zones: { m0: { card: "Royal Magical Library", counters: { 1: 2 } } } } }),
    ],
  }),

  defineScenario({
    id: "raigeki-destroys-all-opponent-monsters",
    title: "Raigeki destroys every monster the opponent controls, face-up or face-down",
    source: "https://yugioh.fandom.com/wiki/Raigeki",
    tags: ["spell", "destroy", "normal-spell"],
    setup: {
      p0: { hand: ["Raigeki"], monsters: ["Blue-Eyes White Dragon"] },
      p1: { monsters: ["Summoned Skull", { card: "Giant Rat", pos: "set" }] },
    },
    steps: [
      activate("Raigeki"),
      expectResolved("Raigeki"),
      expectEvents({ kind: "destroy", card: "Summoned Skull", cause: "effect" }),
      expectBoard({
        p0: { monsters: ["Blue-Eyes White Dragon"], grave: ["Raigeki"], hand: [] },
        p1: { monsters: [], grave: ["Summoned Skull", "Giant Rat"] },
      }),
    ],
  }),

  defineScenario({
    id: "dark-hole-destroys-all-monsters",
    title: "Dark Hole destroys monsters on both sides of the field",
    source: "https://yugioh.fandom.com/wiki/Dark_Hole",
    tags: ["spell", "destroy", "normal-spell"],
    setup: {
      p0: { hand: ["Dark Hole"], monsters: ["Blue-Eyes White Dragon", "Celtic Guardian"] },
      p1: { monsters: ["Summoned Skull"] },
    },
    steps: [
      activate("Dark Hole"),
      expectBoard({
        p0: { monsters: [], grave: { include: ["Dark Hole", "Blue-Eyes White Dragon", "Celtic Guardian"], count: 3 } },
        p1: { monsters: [], grave: ["Summoned Skull"] },
      }),
    ],
  }),

  defineScenario({
    id: "harpies-feather-duster-destroys-opponent-spell-trap",
    title: "Harpie's Feather Duster destroys all opponent Spells and Traps, and none of its own",
    source: "https://yugioh.fandom.com/wiki/Harpie%27s_Feather_Duster",
    tags: ["spell", "destroy", "normal-spell", "spell-trap-removal"],
    setup: {
      p0: { hand: ["Harpie's Feather Duster"], spells: [faceDown("Mirror Force")] },
      p1: { spells: [faceDown("Mirror Force"), "Swords of Revealing Light"], monsters: ["Summoned Skull"] },
    },
    steps: [
      activate("Harpie's Feather Duster"),
      expectBoard({
        p0: { spells: ["Mirror Force"], grave: ["Harpie's Feather Duster"] },
        p1: { spells: [], monsters: ["Summoned Skull"], grave: ["Mirror Force", "Swords of Revealing Light"] },
      }),
    ],
  }),

  defineScenario({
    id: "pot-of-greed-draws-two",
    title: "Pot of Greed draws 2 cards from the top of the Deck",
    source: "https://yugioh.fandom.com/wiki/Pot_of_Greed",
    tags: ["spell", "draw", "normal-spell"],
    setup: { p0: { hand: ["Pot of Greed"], deck: ["Dark Magician", "Celtic Guardian", "Sangan"] } },
    steps: [
      activate("Pot of Greed"),
      expectBoard({ p0: { hand: ["Dark Magician", "Celtic Guardian"], grave: ["Pot of Greed"], deckCount: 18 } }),
    ],
  }),

  defineScenario({
    id: "monster-reborn-own-graveyard",
    title: "Monster Reborn Special Summons a monster from its controller's Graveyard",
    source: "https://yugioh.fandom.com/wiki/Monster_Reborn",
    tags: ["spell", "special-summon", "graveyard", "normal-spell"],
    setup: { p0: { hand: ["Monster Reborn"], grave: ["Blue-Eyes White Dragon", "Sangan"] } },
    steps: [
      activate("Monster Reborn"),
      select("Blue-Eyes White Dragon"),
      expectEvents({ kind: "summon", card: "Blue-Eyes White Dragon", summonKind: "special" }),
      expectBoard({ p0: { monsters: ["Blue-Eyes White Dragon"], grave: ["Monster Reborn", "Sangan"] } }),
    ],
  }),

  defineScenario({
    id: "monster-reborn-opponent-graveyard",
    title: "Monster Reborn can take a monster from the opponent's Graveyard to the controller's field",
    source: "https://yugioh.fandom.com/wiki/Monster_Reborn",
    tags: ["spell", "special-summon", "graveyard", "normal-spell"],
    setup: { p0: { hand: ["Monster Reborn"] }, p1: { grave: ["Summoned Skull"] } },
    steps: [
      activate("Monster Reborn"),
      expectBoard({ p0: { monsters: ["Summoned Skull"] }, p1: { grave: [], monsters: [] } }),
    ],
  }),

  defineScenario({
    id: "change-of-heart-takes-control-until-end-phase",
    title: "Change of Heart takes control of a monster until the End Phase",
    source: "https://yugioh.fandom.com/wiki/Change_of_Heart",
    tags: ["spell", "control", "normal-spell"],
    setup: { p0: { hand: ["Change of Heart"] }, p1: { monsters: ["Summoned Skull"] } },
    steps: [
      activate("Change of Heart"),
      expectBoard({ p0: { monsters: ["Summoned Skull"] }, p1: { monsters: [] } }),
      endTurn(),
      expectBoard({ p0: { monsters: [] }, p1: { monsters: ["Summoned Skull"] } }),
    ],
  }),

  defineScenario({
    id: "card-destruction-both-discard-and-draw",
    title: "Card Destruction makes both players discard their hand and draw the same number",
    source: "https://yugioh.fandom.com/wiki/Card_Destruction",
    tags: ["spell", "discard", "draw", "normal-spell"],
    setup: {
      p0: { hand: ["Card Destruction", "Sangan", "Kuriboh"], deck: ["Dark Magician", "Celtic Guardian"] },
      p1: { hand: ["Summoned Skull", "Giant Rat", "Mystical Elf"], deck: ["Gemini Elf", "Axe Raider", "Thunder Dragon"] },
    },
    steps: [
      activate("Card Destruction"),
      expectBoard({
        p0: { hand: ["Dark Magician", "Celtic Guardian"], grave: { include: ["Card Destruction", "Sangan", "Kuriboh"] } },
        p1: { hand: ["Gemini Elf", "Axe Raider", "Thunder Dragon"], grave: { include: ["Summoned Skull", "Giant Rat", "Mystical Elf"] } },
      }),
    ],
  }),

  defineScenario({
    id: "book-of-moon-flips-face-down-defense",
    title: "Book of Moon turns a face-up monster to face-down Defense Position",
    source: "https://yugioh.fandom.com/wiki/Book_of_Moon",
    tags: ["spell", "position", "quick-play"],
    setup: { p0: { hand: ["Book of Moon"] }, p1: { monsters: ["Summoned Skull"] } },
    steps: [
      activate("Book of Moon"),
      expectBoard({ p1: { zones: { m0: { card: "Summoned Skull", pos: "set" } } }, p0: { grave: ["Book of Moon"] } }),
    ],
  }),
];
