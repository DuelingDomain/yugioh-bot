import {
  activate, defineScenario, expectBoard, expectChain, expectEvents, expectPrompt, expectResolved, faceDown, pass, select,
  type Scenario,
} from "../../support/dsl.js";

export const scenarios: Scenario[] = [
  defineScenario({
    id: "ash-blossom-negates-deck-search",
    title: "Ash Blossom & Joyous Spring from the hand negates Reinforcement of the Army's search",
    source: "https://yugioh.fandom.com/wiki/Ash_Blossom_%26_Joyous_Spring",
    tags: ["hand-trap", "negate-effect", "search", "chain"],
    setup: {
      p0: { hand: ["Reinforcement of the Army"], deck: ["Celtic Guardian"] },
      p1: { hand: ["Ash Blossom & Joyous Spring"] },
    },
    steps: [
      activate("Reinforcement of the Army"),
      expectPrompt({ by: "p1", context: "chain" }),
      activate("Ash Blossom & Joyous Spring", "p1"),
      expectEvents({ kind: "chain-negated", card: "Reinforcement of the Army" }),
      expectBoard({
        p0: { hand: [], grave: ["Reinforcement of the Army"], deckCount: 20 },
        p1: { grave: ["Ash Blossom & Joyous Spring"], hand: [] },
      }),
    ],
  }),

  defineScenario({
    id: "ash-blossom-declined-search-resolves",
    title: "Control for Ash Blossom: when the opponent passes, the search resolves",
    source: "https://yugioh.fandom.com/wiki/Reinforcement_of_the_Army",
    tags: ["search", "chain", "control-case"],
    setup: {
      p0: { hand: ["Reinforcement of the Army"], deck: ["Celtic Guardian", "Axe Raider"] },
      p1: { hand: ["Ash Blossom & Joyous Spring"] },
    },
    steps: [
      activate("Reinforcement of the Army"),
      pass("p1"),
      select("Axe Raider"),
      expectBoard({
        p0: { hand: ["Axe Raider"], grave: ["Reinforcement of the Army"] },
        p1: { hand: ["Ash Blossom & Joyous Spring"] },
      }),
    ],
  }),

  defineScenario({
    id: "three-link-chain-resolves-in-reverse",
    title: "A 3-link chain resolves last link first",
    source: "https://www.yugioh-card.com/en/gameplay/rulebook/ (Chains: Chain Link resolution, last in first out)",
    tags: ["chain", "spell-speed", "quick-play"],
    setup: {
      p0: { hand: ["Raigeki", "Book of Moon"], monsters: ["Blue-Eyes White Dragon"] },
      p1: { monsters: ["Summoned Skull"], spells: [faceDown("Mystical Space Typhoon")] },
    },
    steps: [
      activate("Raigeki"),
      activate("Mystical Space Typhoon", "p1"),
      expectChain("Raigeki", "Mystical Space Typhoon"),
      activate("Book of Moon"),
      select("Summoned Skull"),
      expectResolved("Book of Moon", "Mystical Space Typhoon", "Raigeki"),
    ],
  }),

  defineScenario({
    id: "segoc-turn-player-trigger-goes-first",
    title: "Simultaneous mandatory triggers: the turn player's link is lower, so the opponent's resolves first",
    source: "https://www.yugioh-card.com/en/gameplay/rulebook/ (SEGOC: turn player's effects chain first)",
    tags: ["chain", "segoc", "trigger", "mandatory"],
    setup: {
      deckSize: 2,
      p0: { hand: ["Dark Hole"], monsters: ["Sangan"], deck: ["Kuriboh", "Giant Rat"] },
      p1: { monsters: ["Sangan"], deck: ["Giant Rat", "Thunder Dragon"] },
    },
    steps: [
      activate("Dark Hole"),
      expectPrompt({ by: "p0" }),
      select("Kuriboh"),
      expectResolved("Dark Hole", "Sangan", "Sangan"),
      expectEvents(
        { kind: "chain-resolving", card: "Sangan", by: "p1" },
        { kind: "chain-resolving", card: "Sangan", by: "p0" },
      ),
      expectBoard({ p0: { hand: ["Kuriboh"] }, p1: { hand: ["Giant Rat"] } }),
    ],
  }),
];
