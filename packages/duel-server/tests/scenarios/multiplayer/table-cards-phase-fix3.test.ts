import { describeWithCores } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import { type Scenario } from "../../support/dsl.js";
import { TABLE_CARD_SCENARIOS } from "./table-cards.js";

const base = TABLE_CARD_SCENARIOS.filter(s => s.id.includes("eye-of-truth") || s.id.includes("gingerbread-house"));
const variants: Scenario[] = [];
for (const source of base) {
  for (const domain of [false, true]) {
    for (const format of source.setup.format === "ffa3" ? ["ffa3", "ffa4"] as const : ["tag"] as const) {
      const scenario = structuredClone(source);
      scenario.id = `${source.id}-phase-proof-${format}${domain ? "-domain" : ""}`;
      scenario.title = `${format}: the phase effect uses the turn player with no opponent prompt`;
      scenario.setup.format = format;
      if (format === "ffa4") scenario.setup.p3 = source.id.includes("eye-of-truth")
        ? { hand: ["Dark Hole"] } : { monsters: ["Battle Ox"] };
      if (domain) {
        scenario.setup.mode = "domain";
        for (const seat of format === "ffa3" ? ["p0", "p1", "p2"] as const : ["p0", "p1", "p2", "p3"] as const) {
          scenario.setup[seat] = { ...scenario.setup[seat], deckMaster: "Blue-Eyes White Dragon" };
        }
      }
      for (const step of scenario.steps) {
        if (step.op !== "expectBoard") continue;
        if (format === "ffa4") step.board.p3 = { lp: 8000, spells: [], grave: [], banished: [],
          monsters: source.id.includes("eye-of-truth") ? [] : ["Battle Ox"] };
        if (domain) for (const state of Object.values(step.board)) {
          state.deckMaster = { inZone: true, returns: 0, nextCost: 0 };
        }
      }
      variants.push(scenario);
    }
  }
}

describeWithCores("phase trigger binds its causal turn player", liveNseat, () => {
  runScenarios("multiplayer/table-cards-phase-fix3", variants);
});
