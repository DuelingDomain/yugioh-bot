import { activate, choose, defineScenario, expectBoard, select, zone, type Scenario } from "../../support/dsl.js";

export const scenarios: Scenario[] = [
  defineScenario({
    id: "legacy-toy-box-sets-two-toys-in-chosen-zones",
    title: "Toy Box Sets two Toy monsters as Spells on the legacy engine: each Set asks for a zone and the duel continues (issue 467)",
    source: "Card text of Toy Box: choose up to 2 Toy monsters that can Set themselves from the hand as a Spell, and Set them in your Spell & Trap Zone",
    tags: ["domain", "set", "select-place", "legacy-engine"],
    setup: {
      mode: "domain",
      p0: { deckMaster: "Axe Raider", spells: ["Toy Box"], hand: ["Toy Soldier", "Toy Tank"] },
      p1: { deckMaster: "Celtic Guardian" },
    },
    steps: [
      activate("Toy Box"),
      choose("Set"),
      select("Toy Soldier", "Toy Tank"),
      zone("p0", "s2"),
      zone("p0", "s3"),
      expectBoard({ p0: { hand: [], spells: { count: 3 } } }),
    ],
  }),
];
