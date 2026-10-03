import {
  defineScenario, expectBoard, expectEvents, expectNotOffered, expectOffered, expectPrompt, normalSummon, select, specialSummon,
  zone, type Scenario,
} from "../../support/dsl.js";

export const scenarios: Scenario[] = [
  defineScenario({
    id: "tribute-summon-level-6",
    title: "A Level 6 monster is Tribute Summoned by tributing 1 monster",
    source: "https://www.yugioh-card.com/en/gameplay/rulebook/ (Tribute Summon: Level 5-6 needs 1 Tribute)",
    tags: ["summon", "tribute-summon"],
    setup: { p0: { hand: ["Summoned Skull"], monsters: ["Celtic Guardian", "Axe Raider"] } },
    steps: [
      normalSummon("Summoned Skull"),
      select("Celtic Guardian"),
      expectEvents({ kind: "summon", card: "Summoned Skull", summonKind: "tribute" }),
      expectBoard({ p0: { monsters: ["Summoned Skull", "Axe Raider"], grave: ["Celtic Guardian"] } }),
    ],
  }),

  defineScenario({
    id: "synchro-summon-from-extra-deck",
    title: "Synchro Summon: a Level 4 Tuner and a Level 4 non-Tuner make Stardust Dragon",
    source: "https://www.yugioh-card.com/en/gameplay/rulebook/ (Synchro Summon)",
    tags: ["summon", "synchro-summon", "extra-deck"],
    setup: {
      p0: { monsters: ["The Magical King of Dimension Zeta", "Axe Raider"], extra: ["Stardust Dragon"] },
    },
    steps: [
      specialSummon("Stardust Dragon"),
      select("The Magical King of Dimension Zeta", "Axe Raider"),
      expectEvents({ kind: "summon", card: "Stardust Dragon", summonKind: "synchro" }),
      expectBoard({
        p0: {
          monsters: ["Stardust Dragon"],
          grave: ["The Magical King of Dimension Zeta", "Axe Raider"],
          extra: [],
        },
      }),
    ],
  }),

  defineScenario({
    id: "xyz-summon-overlay-units",
    title: "Xyz Summon: two Level 4 monsters become overlay units under Number 39: Utopia",
    source: "https://www.yugioh-card.com/en/gameplay/rulebook/ (Xyz Summon)",
    tags: ["summon", "xyz-summon", "extra-deck"],
    setup: { p0: { monsters: ["Celtic Guardian", "Axe Raider"], extra: ["Number 39: Utopia"] } },
    steps: [
      specialSummon("Number 39: Utopia"),
      select("Celtic Guardian", "Axe Raider"),
      expectEvents({ kind: "summon", card: "Number 39: Utopia", summonKind: "xyz" }),
      expectBoard({ p0: { monsters: ["Number 39: Utopia"], grave: [] } }),
    ],
  }),

  defineScenario({
    id: "link-summon-lands-in-extra-monster-zone",
    title: "Link Summon: Link Spider can only be placed in an Extra Monster Zone",
    source: "https://www.yugioh-card.com/en/gameplay/rulebook/ (Link Summon, Extra Monster Zone, Master Rule 5)",
    tags: ["summon", "link-summon", "extra-deck", "extra-monster-zone", "master-rule-5"],
    setup: { p0: { monsters: ["Mystical Elf"], extra: ["Link Spider"] } },
    steps: [
      specialSummon("Link Spider"),
      select("Mystical Elf"),
      expectPrompt({ kind: "places" }),
      zone("p0", "emz0"),
      expectEvents({ kind: "summon", card: "Link Spider", summonKind: "link" }),
      expectBoard({ p0: { zones: { emz0: "Link Spider", m0: null }, grave: ["Mystical Elf"] } }),
    ],
  }),

  defineScenario({
    id: "pendulum-summon-master-rule-5",
    title: "Pendulum Summon from hand with Scales 1 and 8 summons Levels 2 to 7",
    source: "https://www.yugioh-card.com/en/gameplay/rulebook/ (Pendulum Summon, Master Rule 5)",
    tags: ["summon", "pendulum-summon", "pendulum-zone", "master-rule-5"],
    setup: {
      p0: {
        hand: ["Celtic Guardian", "Summoned Skull", "Blue-Eyes White Dragon"],
        pendulum: ["Stargazer Magician", "Timegazer Magician"],
      },
    },
    steps: [
      expectNotOffered("specialSummon", "Celtic Guardian"),
      specialSummon({ card: "Stargazer Magician", from: "szone" }),
      expectOffered("choice", "Summoned Skull"),
      expectNotOffered("choice", "Blue-Eyes White Dragon"),
      select("Celtic Guardian", "Summoned Skull"),
      expectEvents({ kind: "summon", card: "Celtic Guardian" }, { kind: "summon", card: "Summoned Skull" }),
      expectBoard({
        p0: {
          monsters: ["Celtic Guardian", "Summoned Skull"],
          hand: ["Blue-Eyes White Dragon"],
          spells: ["Stargazer Magician", "Timegazer Magician"],
        },
      }),
    ],
  }),

  defineScenario({
    id: "pendulum-summon-is-tagged-pendulum",
    title: "A Pendulum Summon is reported with summonKind \"pendulum\" under Master Rule 5",
    source: "docs/adr/0002-multiplayer-duel-rules.md and the DuelSummonKind contract in packages/shared/src/duels/index.ts",
    tags: ["summon", "pendulum-summon", "pendulum-zone", "master-rule-5", "event-kind"],
    setup: {
      p0: { hand: ["Celtic Guardian"], pendulum: ["Stargazer Magician", "Timegazer Magician"] },
    },
    steps: [
      specialSummon({ card: "Stargazer Magician", from: "szone" }),
      select("Celtic Guardian"),
      expectEvents({ kind: "summon", card: "Celtic Guardian", summonKind: "pendulum" }),
    ],
  }),

  ...([3, 4] as const).map((masterRule) =>
    defineScenario({
      id: `pendulum-summon-is-tagged-pendulum-mr${masterRule}`,
      title: `A Pendulum Summon is reported with summonKind "pendulum" under Master Rule ${masterRule}`,
      source: "docs/adr/0002-multiplayer-duel-rules.md and the DuelSummonKind contract in packages/shared/src/duels/index.ts",
      tags: ["summon", "pendulum-summon", "pendulum-zone", `master-rule-${masterRule}`, "event-kind"],
      setup: {
        masterRule,
        p0: { hand: ["Celtic Guardian"], pendulum: ["Stargazer Magician", "Timegazer Magician"] },
      },
      steps: [
        specialSummon({ card: "Stargazer Magician", from: "szone" }),
        select("Celtic Guardian"),
        expectEvents({ kind: "summon", card: "Celtic Guardian", summonKind: "pendulum" }),
      ],
    }),
  ),
];
