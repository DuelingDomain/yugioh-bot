// Mist Valley Apex Avian (29587993): its quick effect returns a "Mist Valley" card you control to the hand and negates + destroys an activation.
// The stock condition reads the global `ev` (not a parameter), so the effect was never offered.
import { activate, expectBoard, expectOffered, type Scenario } from "../../support/dsl.js";
import { defineScenarioWithFfaFirstDraw as defineScenario } from "./ffa-first-draw.js";
import { SOURCE } from "./nseat-scenarios.js";
import { baseSetup } from "./seat-kit.js";

const AVIAN = "Mist Valley Apex Avian";
const POT = "Pot of Greed";

export const APEX_AVIAN_SCENARIOS: Scenario[] = [
  defineScenario({
    id: "apex-avian-ffa3-negates-activation-from-another-seat",
    title: "FFA3: Mist Valley Apex Avian of p1 returns itself and negates + destroys the Pot of Greed that p0 activates",
    source: `${SOURCE} Card text of Mist Valley Apex Avian (quick effect, Chain Link negation, return a Mist Valley card you control to the hand)`,
    tags: ["multiplayer", "negate", "ffa3", "card:29587993"],
    setup: baseSetup("ffa3", { p0: { hand: [POT] }, p1: { monsters: [AVIAN] } }),
    steps: [
      activate(POT, "p0"),
      expectOffered("activate", AVIAN, "p1"),
      activate(AVIAN, "p1"),
      expectBoard({
        p0: { hand: [], grave: [POT], deckCount: 20 },
        p1: { hand: [AVIAN], monsters: [] },
      }),
    ],
  }),
];
