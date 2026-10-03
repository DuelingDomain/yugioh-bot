import {
  activate, defineScenario, expectBoard, expectOffered, expectPrompt, no, normalSummon, select, specialSummon, yes,
  type Scenario,
} from "../../support/dsl.js";

const source = "docs/adr/0002-multiplayer-duel-rules.md (Domain: Deck Master Zone) and tests/domain-leave-tax.test.ts";

export const scenarios: Scenario[] = [
  defineScenario({
    id: "domain-deck-master-summon-from-zone",
    title: "The Deck Master is Normal Summoned from its zone",
    source,
    tags: ["domain", "deck-master", "normal-summon"],
    setup: { mode: "domain", p0: { deckMaster: "Axe Raider" }, p1: { deckMaster: "Celtic Guardian" } },
    steps: [
      expectOffered("normalSummon", { card: "Axe Raider", from: "dmz" }),
      normalSummon({ card: "Axe Raider", from: "dmz" }),
      expectBoard({ p0: { monsters: ["Axe Raider"], deckMaster: { inZone: false, returns: 0 } } }),
    ],
  }),

  defineScenario({
    id: "domain-recall-offered-after-leaving",
    title: "After the Deck Master leaves the field, the owner is offered a recall and a refusal keeps it in the Graveyard",
    source,
    tags: ["domain", "deck-master", "recall"],
    setup: {
      mode: "domain",
      p0: { deckMaster: "Axe Raider", hand: ["Dark Hole"] },
      p1: { deckMaster: "Celtic Guardian" },
    },
    steps: [
      normalSummon({ card: "Axe Raider", from: "dmz" }),
      activate("Dark Hole"),
      expectPrompt({ by: "p0", context: "deck-master-recall" }),
      no(),
      expectBoard({ p0: { lp: 8000, monsters: [], grave: ["Axe Raider", "Dark Hole"], deckMaster: { inZone: false, returns: 0 } } }),
    ],
  }),

  defineScenario({
    id: "domain-recall-costs-500-and-rises",
    title: "A completed recall costs no LP the first time and raises the next cost by 500",
    source,
    tags: ["domain", "deck-master", "recall", "lp-cost"],
    setup: {
      mode: "domain",
      p0: { deckMaster: "Axe Raider", hand: ["Dark Hole"] },
      p1: { deckMaster: "Celtic Guardian" },
    },
    steps: [
      normalSummon({ card: "Axe Raider", from: "dmz" }),
      activate("Dark Hole"),
      expectPrompt({ by: "p0", context: "deck-master-recall" }),
      yes(),
      expectBoard({ p0: { deckMaster: { inZone: true, returns: 1, nextCost: 500 } } }),
    ],
  }),

  defineScenario({
    id: "domain-select-matching-card-with-cancel-flag",
    title: "Eater of Millions Special Summons in Domain (its cost selection passes the optional cancel flag)",
    source: "Card text of Eater of Millions: banish 5 other cards from your hand, field or Extra Deck face-down to Special Summon it from your hand",
    tags: ["domain", "special-summon", "select-matching-card"],
    setup: {
      mode: "domain",
      p0: { deckMaster: "Axe Raider", hand: ["Eater of Millions", "Mystical Elf", "Celtic Guardian", "Dark Hole", "Raigeki", "Pot of Greed"] },
      p1: { deckMaster: "Celtic Guardian" },
    },
    steps: [
      specialSummon("Eater of Millions"),
      // The Domain first-turn draw adds a filler. Select five cards for the cost.
      select("Mystical Elf", "Celtic Guardian", "Dark Hole", "Raigeki", "Pot of Greed"),
      expectBoard({
        p0: {
          hand: ["Mystical Elf"],
          monsters: ["Eater of Millions"],
          banished: ["Mystical Elf", "Celtic Guardian", "Dark Hole", "Raigeki", "Pot of Greed"],
          deckMaster: { inZone: true, returns: 0 },
        },
      }),
    ],
  }),

  defineScenario({
    id: "domain-deck-master-ritual-summoned-leaves-zone",
    title: "A Deck Master Ritual Summoned with Advanced Ritual Art is on the field and no longer in its zone",
    source: "Card text of Advanced Ritual Art (Ritual Summon using Normal Monsters from your Deck) and Domain rules: the Deck Master is in exactly one place",
    tags: ["domain", "deck-master", "ritual"],
    setup: {
      mode: "domain",
      masterRule: 4,
      // The Link Spider in an Extra Monster Zone makes the core test the Extra Monster Zone link state of the Deck Master.
      p0: {
        deckMaster: "Demise, King of Armageddon",
        hand: ["Advanced Ritual Art"],
        deck: ["Mystical Elf", "Blue-Eyes White Dragon"],
        monsters: [null, null, null, null, null, "Link Spider"],
      },
      p1: { deckMaster: "Celtic Guardian" },
    },
    steps: [
      activate("Advanced Ritual Art"),
      select("Blue-Eyes White Dragon"),
      expectBoard({
        p0: {
          monsters: { include: ["Demise, King of Armageddon", "Link Spider"], count: 2 },
          grave: ["Advanced Ritual Art", "Blue-Eyes White Dragon"],
          deckMaster: { inZone: false, returns: 0, nextCost: 0 },
        },
      }),
    ],
  }),
];
