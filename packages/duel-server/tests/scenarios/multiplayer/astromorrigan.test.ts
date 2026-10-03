import { describe, expect, it } from "vitest";
import { seatCountFor } from "@yugidraft/shared/duels";
import { readManifest } from "../../../scripts/generate-multi-scripts.js";
import { outcomeAsserts } from "../../../scripts/rule-coverage.js";
import { describeWithCores } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import { ASTROMORRIGAN_SCENARIOS } from "./astromorrigan.js";

// Live scenarios of Prediction Princess Astromorrigan: each opponent takes the damage for its own destroyed monsters. Same gate as the other live N-seat
// files: NSEAT_LIVE=1 and a multi core. Run it on the Standard multi core and again on the Domain multi core (NSEAT_WASM=ocgcore.multi-domain.wasm).
describeWithCores("live scenarios of Prediction Princess Astromorrigan", liveNseat, () => {
  runScenarios("multiplayer/astromorrigan", ASTROMORRIGAN_SCENARIOS);
});

describe("Prediction Princess Astromorrigan scenario list", () => {
  it("names the declared opponent result in every FFA proof ID", () => {
    for (const scenario of ASTROMORRIGAN_SCENARIOS) {
      if (scenario.setup.format === "tag") continue;
      expect(scenario.id).not.toContain("each-opponent");
      expect(scenario.id).toContain("declared-");
    }
  });

  it("has unique ids, a source, a multi-seat format, the rules it proves and an outcome after an action", () => {
    expect(new Set(ASTROMORRIGAN_SCENARIOS.map((s) => s.id)).size).toBe(ASTROMORRIGAN_SCENARIOS.length);
    for (const s of ASTROMORRIGAN_SCENARIOS) {
      expect(s.source, s.id).toBeTruthy();
      expect(seatCountFor(s.setup.format ?? "1v1"), s.id).toBeGreaterThan(2);
      expect(s.rules?.length, s.id).toBeGreaterThan(0);
      expect(outcomeAsserts(s.steps), s.id).toBe(true);
    }
  });

  it("tags every scenario with the card that has an overlay file", () => {
    const codes = new Set(readManifest().cards.map((card) => card.code));
    for (const s of ASTROMORRIGAN_SCENARIOS) {
      const tagged = s.tags.filter((tag) => tag.startsWith("card:")).map((tag) => Number(tag.slice(5)));
      expect(tagged.some((code) => codes.has(code)), `${s.id}: card tags ${tagged.join(", ")}`).toBe(true);
    }
  });
});
