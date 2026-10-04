import { describe, expect, it } from "vitest";
import { describeWithCores } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import { P3_CATALOG_SCENARIOS } from "./p3-catalog.js";

describeWithCores("declared-opponent catalog outcomes", liveNseat, () => {
  runScenarios("multiplayer/p3-catalog", P3_CATALOG_SCENARIOS);
});


describe("catalog proof modes", () => {
  it("proves Kycoo and Gameciel in Standard and Domain duels for all three formats", () => {
    for (const code of [88240808, 55063751]) {
      for (const mode of ["standard", "domain"]) {
        const cases = P3_CATALOG_SCENARIOS.filter(scenario => scenario.tags.includes(`card:${code}`)
          && (scenario.setup.mode ?? "standard") === mode);
        expect(cases.map(scenario => scenario.setup.format).sort()).toEqual(["ffa3", "ffa4", "tag"]);
        if (mode === "domain") for (const scenario of cases) {
          for (const seat of scenario.setup.format === "ffa3" ? ["p0", "p1", "p2"] as const : ["p0", "p1", "p2", "p3"] as const) {
            expect(scenario.setup[seat]?.deckMaster).toBeDefined();
          }
        }
      }
    }
  });
});
