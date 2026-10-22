import { activate, defineScenario, endTurn, expectBoard, expectEliminated, surrender, type DuelistId, type Scenario, type Step } from "../../support/dsl.js";
import { domainVariant } from "./domain-variants.js";

const SOURCE = "Owner ruling 2026-10-21, https://github.com/DuelingDomain/yugioh-bot/issues/435 [R-FFA-LP-COMPARE]";
const seat = (i: number) => `p${i}` as DuelistId;

function reproduction(actor: number, before: boolean): Scenario {
  const setup: Scenario["setup"] = { format: "ffa4", skipOpeningDraw: true };
  for (let i = 0; i < 4; i++) setup[seat(i)] = { lp: i === actor ? 5000 : i === (actor + 1) % 4 ? 3000 : 9000 };
  setup[seat(actor)]!.hand = ["Unstable Evolution"];
  setup[seat(actor)]!.monsters = ["Battle Ox"];
  const steps: Step[] = [];
  for (let i = 0; i < actor; i++) steps.push(endTurn(seat(i)));
  const losses = [surrender(seat((actor + 2) % 4)), surrender(seat((actor + 3) % 4)), expectEliminated(seat((actor + 2) % 4), seat((actor + 3) % 4))];
  if (before) steps.push(...losses);
  steps.push(activate("Unstable Evolution", seat(actor)));
  if (!before) steps.push(...losses);
  steps.push(expectBoard({ [seat(actor)]: { lp: 5000, zones: { m0: { card: "Battle Ox", attack: 1000 } } }, [seat((actor + 1) % 4)]: { lp: 3000 } }));
  return domainVariant(defineScenario({ id: `lp-comparison-435-p${actor}-${before ? "before" : "after"}-equip`, title: "Unstable Evolution: two survivors exclude richer surrendered seats", source: SOURCE, rules: ["R-FFA-LP-COMPARE"], tags: ["multiplayer", "ffa4", "card:62991886"], setup, steps }));
}

function equipComparison(card: "Unstable Evolution" | "Megamorph", opponents: number[], attack: number, label: string): Scenario {
  return domainVariant(defineScenario({
    id: `lp-comparison-${card.replaceAll(" ", "-")}-${label}`,
    title: `${card}: ${label}`, source: SOURCE, rules: ["R-FFA-LP-COMPARE"],
    tags: ["multiplayer", "ffa4", `card:${card === "Megamorph" ? 22046459 : 62991886}`],
    setup: { format: "ffa4", skipOpeningDraw: true, p0: { lp: 5000, hand: [card], monsters: ["Battle Ox"] },
      p1: { lp: opponents[0] }, p2: { lp: opponents[1] }, p3: { lp: opponents[2] } },
    steps: [activate(card), expectBoard({ p0: { zones: { m0: { card: "Battle Ox", attack } } } })],
  }));
}

export const LP_COMPARISON_SCENARIOS = [
  ...[0, 1, 2, 3].flatMap(actor => [reproduction(actor, true), reproduction(actor, false)]),
  ...(["Unstable Evolution", "Megamorph"] as const).flatMap(card => [
    equipComparison(card, [3000, 7000, 9000], card === "Megamorph" ? 850 : 1000, "mixed-owner-example"),
    equipComparison(card, [3000, 4000, 4500], card === "Megamorph" ? 850 : 1000, "all-opponents-lower"),
    equipComparison(card, [6000, 7000, 9000], card === "Megamorph" ? 3400 : 2400, "all-opponents-higher"),
    equipComparison(card, [5000, 7000, 9000], card === "Megamorph" ? 850 : 1000, "tied-with-one"),
    equipComparison(card, [5000, 5000, 5000], 1700, "all-equal"),
  ]),
];
