import { activate, defineScenario, expectBoard, expectPrompt, pickOpponent, surrender, yes, type Scenario } from "../../support/dsl.js";
import { domainVariant } from "./domain-variants.js";

const HELPOEMER = "The Sun God's Poet - Helpoemer";
const SEARCH = "The Immortal Sun God";
const scenarios: Scenario[] = [];

for (const format of ["ffa3", "ffa4", "tag"] as const) {
  for (const [label, opponentLP, discard] of [
    ["mixed", [4000, 8000, 9000], false],
    ["insufficient-gap", [6000, 8000, 9000], false],
    ["exact-gap", [7000, 7000, 7000], true],
    ["eliminated-lowest", [8000, 4000, 9000], true],
  ] as const) {
    if (format === "tag" && label === "eliminated-lowest") continue;
    const target = format === "tag" || label === "eliminated-lowest" ? "p1" : "p2";
    const scenario = defineScenario({
      id: `lp-comparison-helpoemer-${format}-${label}`,
      title: `Helpoemer: ${format} ${label} requires a 2000-LP lead from every living opponent`,
      source: "https://github.com/DuelingDomain/yugioh-bot/issues/449 [R-FFA-LP-COMPARE]",
      rules: ["R-FFA-LP-COMPARE"], tags: ["multiplayer", format, "card:101403001"],
      setup: { format, skipOpeningDraw: true,
        p0: { lp: 5000, hand: ["Monster Reborn"], grave: [HELPOEMER], deck: [SEARCH] },
        p1: { lp: opponentLP[0], hand: target === "p1" ? ["Beaver Warrior"] : [] },
        p2: { lp: format === "tag" ? 5000 : opponentLP[1], hand: target === "p2" ? ["Beaver Warrior"] : [] },
        ...(format !== "ffa3" ? { p3: { lp: format === "tag" ? opponentLP[0] : opponentLP[2] } } : {}) },
      steps: [...(label === "eliminated-lowest" ? [surrender("p2")] : []),
        activate("Monster Reborn"), yes(),
        ...(format === "tag" || label === "eliminated-lowest" && format === "ffa3" ? [] : [pickOpponent(target)]),
        ...(discard ? [yes()] : []),
        ...(format === "tag" && discard ? [pickOpponent(target)] : []),
        expectPrompt({ by: "p0", offers: ["to_ep"] }),
        expectBoard({ p0: { hand: [SEARCH], monsters: [HELPOEMER], grave: ["Monster Reborn"] },
          [target]: { hand: discard ? [] : ["Beaver Warrior"], grave: discard ? ["Beaver Warrior"] : [] } })],
    });
    scenarios.push(scenario, domainVariant(scenario));
  }
}

export const HELPOEMER_LP_SCENARIOS = scenarios;
