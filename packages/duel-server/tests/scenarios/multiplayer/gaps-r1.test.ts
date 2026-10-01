import { describe, expect, it } from "vitest";
import { seatCountFor } from "@yugidraft/shared/duels";
import { readManifest } from "../../../scripts/generate-multi-scripts.js";
import { outcomeAsserts } from "../../../scripts/rule-coverage.js";
import { describeWithCores } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import { GAPS_R1_SCENARIOS } from "./gaps-r1.js";

// Live scenarios of the R1 table gaps and the R1 stock parts (Grapha, Dangerous Machine Type-6 and the cards checked against the owner rules).
// Same gate as the other live N-seat files: NSEAT_LIVE=1 and a multi core. Run it on the Standard multi core and again on the Domain multi core
// (NSEAT_WASM=domain-core/dist/ocgcore.multi-domain-P56.sync.wasm).
describeWithCores("live scenarios of the R1 table gaps", liveNseat, () => {
  runScenarios("multiplayer/gaps-r1", GAPS_R1_SCENARIOS);
});

describe("R1 gap scenario list", () => {
  it("has unique ids, a source, a multi-seat format, the rules it proves and an outcome after an action", () => {
    expect(new Set(GAPS_R1_SCENARIOS.map((s) => s.id)).size).toBe(GAPS_R1_SCENARIOS.length);
    for (const s of GAPS_R1_SCENARIOS) {
      expect(s.source, s.id).toBeTruthy();
      expect(seatCountFor(s.setup.format ?? "1v1"), s.id).toBeGreaterThan(2);
      expect(s.rules?.length, s.id).toBeGreaterThan(0);
      expect(outcomeAsserts(s.steps), s.id).toBe(true);
    }
  });

  it("tags every scenario with at least one card that has an overlay file", () => {
    const codes = new Set(readManifest().cards.map((card) => card.code));
    for (const s of GAPS_R1_SCENARIOS) {
      const tagged = s.tags.filter((tag) => tag.startsWith("card:")).map((tag) => Number(tag.slice(5)));
      expect(tagged.some((code) => codes.has(code)), `${s.id}: card tags ${tagged.join(", ")}`).toBe(true);
    }
  });
});
