// Regression for stock ChangeAttackTarget(nil) cards: keep the live defender.
import { activate, attack, defineScenario, expectBoard, yes, type Scenario } from "../../support/dsl.js";
import { domainVariant } from "./domain-variants.js";
const cases = [
  { card: "Astral Barrier", monster: "Mystical Elf", trap: false, recoil: 0 },
  { card: "Doble Passe", monster: "Mystical Elf", trap: true, recoil: 800 },
  { card: "Toon Defense", monster: "Toon Masked Sorcerer", trap: false, recoil: 0 },
];
const standard: Scenario[] = cases.map(({card, monster, trap, recoil}) => defineScenario({
  id: `swords-redirect-${card.toLowerCase().replaceAll(" ", "-")}-ffa3`,
  title: `${card}: a redirect to a direct attack keeps p1 although p1 controls a monster`,
  source: "Owner attack redirect rule, 2026-10-01; stock card script; HIGH-1 Swords review",
  rules: ["R-FFA-ATTACK"], tags: ["multiplayer", "ffa3", "redirect"],
  setup: { format: "ffa3", attackFirstTurn: true, skipOpeningDraw: true,
    p0: { monsters: ["Battle Ox"] },
    p1: { monsters: [monster], spells: [{card, pos: trap ? "set" : "up"}] }, p2: {} },
  steps: [attack("Battle Ox", {card: monster, owner: "p1"}, "p0"),
    ...(trap ? [activate(card, "p1")] : [yes("p1")]),
    expectBoard({
      p0: { lp: 8000-recoil, monsters: ["Battle Ox"], spells: [], hand: [], deckCount: 20, grave: [], banished: [] },
      p1: { lp: 6300, monsters: [monster], spells: trap ? [] : [card], hand: [], deckCount: 20, grave: trap ? [card] : [], banished: [] },
      p2: { lp: 8000, monsters: [], spells: [], hand: [], deckCount: 20, grave: [], banished: [] },
    })],
}));
export const SWORDS_REDIRECT_SCENARIOS = standard.flatMap(s => {
  const domain=structuredClone(domainVariant(s));
  for (const step of domain.steps) if (step.op==="expectBoard") for (const seat of ["p0","p1","p2"] as const)
    step.board[seat] = {...step.board[seat], deckMaster: {inZone: true, returns: 0, nextCost: 0}};
  return [s,domain];
});
