import { describe, expect, it } from "vitest";
import { seatCountFor } from "@yugidraft/shared/duels";
import { outcomeAsserts } from "../../../scripts/rule-coverage.js";
import { describeWithCores } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import { TRUE_DRACO_SCENARIOS } from "./true-draco-heritage.js";

describeWithCores("live True Draco Heritage scenarios", liveNseat, () => {
  runScenarios("multiplayer/true-draco-heritage", TRUE_DRACO_SCENARIOS);
});

describe("True Draco Heritage scenario list", () => {
  it("has unique ids, a source, a multi-seat format, the rules it proves, an outcome after an action and a card tag", () => {
    expect(new Set(TRUE_DRACO_SCENARIOS.map((s) => s.id)).size).toBe(TRUE_DRACO_SCENARIOS.length);
    for (const s of TRUE_DRACO_SCENARIOS) {
      expect(s.source, s.id).toBeTruthy();
      expect(seatCountFor(s.setup.format ?? "1v1"), s.id).toBeGreaterThan(2);
      expect(s.rules?.length, s.id).toBeGreaterThan(0);
      expect(outcomeAsserts(s.steps), s.id).toBe(true);
      expect(s.tags.some((tag) => /^card:\d+$/.test(tag)), s.id).toBe(true);
    }
  });
});
