import {
  attack, defineScenario, expectBoard, expectEvents, expectNotOffered, expectOffered, expectPrompt, normalSummon,
  type Scenario,
} from "../../support/dsl.js";

export const scenarios: Scenario[] = [
  defineScenario({
    id: "direct-attack-deals-damage",
    title: "A direct attack on an empty field deals the ATK of the attacker as damage",
    source: "https://www.yugioh-card.com/en/gameplay/rulebook/ (Battle Phase: direct attack)",
    tags: ["battle", "direct-attack", "damage"],
    setup: { p0: { monsters: ["Summoned Skull"] }, attackFirstTurn: true },
    steps: [
      attack("Summoned Skull", "direct"),
      expectEvents({ kind: "damage", amount: 2500 }),
      expectBoard({ p0: { lp: 8000 }, p1: { lp: 5500 } }),
    ],
  }),

  defineScenario({
    id: "destroy-monster-by-battle",
    title: "A stronger attacker destroys a weaker Attack Position monster and the difference is damage (2500 - 1400)",
    source: "https://www.yugioh-card.com/en/gameplay/rulebook/ (Damage calculation)",
    tags: ["battle", "destroy-by-battle", "damage"],
    setup: { p0: { monsters: ["Summoned Skull"] }, p1: { monsters: ["Giant Rat"] }, attackFirstTurn: true },
    steps: [
      attack("Summoned Skull", "Giant Rat"),
      expectEvents({ kind: "damage", amount: 1100 }, { kind: "destroy", card: "Giant Rat", cause: "battle" }),
      expectBoard({ p1: { lp: 6900, grave: ["Giant Rat"], monsters: [] } }),
    ],
  }),

  defineScenario({
    id: "second-normal-summon-not-offered",
    title: "After one Normal Summon, no second Normal Summon or Set is offered in the same turn",
    source: "https://www.yugioh-card.com/en/gameplay/rulebook/ (Normal Summon: once per turn)",
    tags: ["legality", "normal-summon"],
    setup: { p0: { hand: ["Celtic Guardian", "Axe Raider"] } },
    steps: [
      expectOffered("normalSummon", "Axe Raider"),
      normalSummon("Celtic Guardian"),
      expectNotOffered("normalSummon", "Axe Raider"),
      expectNotOffered("set", "Axe Raider"),
    ],
  }),

  defineScenario({
    id: "no-attack-on-first-turn",
    title: "Without the first-turn-attack flag, attack is not offered on the first turn",
    source: "https://www.yugioh-card.com/en/gameplay/rulebook/ (the first player cannot attack on turn 1)",
    tags: ["legality", "battle", "first-turn"],
    setup: { p0: { monsters: ["Summoned Skull"] } },
    steps: [
      expectPrompt({ by: "p0", context: "action", offers: ["to_ep"], notOffers: ["to_bp"] }),
    ],
  }),
];
