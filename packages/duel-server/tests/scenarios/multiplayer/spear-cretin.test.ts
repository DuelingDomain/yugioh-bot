import { describe, expect, it } from "vitest";
import { seatCountFor } from "@yugidraft/shared/duels";
import { readManifest } from "../../../scripts/generate-multi-scripts.js";
import { outcomeAsserts } from "../../../scripts/rule-coverage.js";
import { describeWithCores } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import { SPEAR_CRETIN_SCENARIOS } from "./spear-cretin.js";

// Live scenarios of Spear Cretin (domain-core/multi-scripts). Same gate as the other live N-seat scenario files: NSEAT_LIVE=1 and a multi core.
describeWithCores("live Spear Cretin scenarios", liveNseat, () => {
  runScenarios("multiplayer/spear-cretin", SPEAR_CRETIN_SCENARIOS);
});

describe("Spear Cretin scenario list", () => {
  it("has unique ids, a source, a multi-seat format, the rules it proves and an outcome after an action", () => {
    expect(new Set(SPEAR_CRETIN_SCENARIOS.map((s) => s.id)).size).toBe(SPEAR_CRETIN_SCENARIOS.length);
    for (const s of SPEAR_CRETIN_SCENARIOS) {
      expect(s.source, s.id).toBeTruthy();
      expect(seatCountFor(s.setup.format ?? "1v1"), s.id).toBeGreaterThan(2);
      expect(s.rules?.length, s.id).toBeGreaterThan(0);
      expect(outcomeAsserts(s.steps), s.id).toBe(true);
    }
  });

  it("tags every scenario with a card that has an overlay file", () => {
    const codes = new Set(readManifest().cards.map((card) => card.code));
    for (const s of SPEAR_CRETIN_SCENARIOS) {
      const tagged = (s.tags ?? []).filter((tag) => tag.startsWith("card:")).map((tag) => Number(tag.slice(5)));
      expect(tagged.some((code) => codes.has(code)), `${s.id}: card tags ${tagged.join(", ")}`).toBe(true);
    }
  });
});
