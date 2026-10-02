import { describe, expect, it } from "vitest";
import { seatCountFor } from "@yugidraft/shared/duels";
import { outcomeAsserts } from "../../../scripts/rule-coverage.js";
import { describeWithCores } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import { UTOPIA_SCENARIOS } from "./utopia-envoy.js";

describeWithCores("live Number 39 Utopia the Envoy of Light scenarios", liveNseat, () => {
  runScenarios("multiplayer/utopia-envoy", UTOPIA_SCENARIOS);
});

describe("Number 39 Utopia the Envoy of Light scenario list", () => {
  it("has unique ids, a source, a multi-seat format, the rules it proves, an outcome after an action and a card tag", () => {
    expect(new Set(UTOPIA_SCENARIOS.map((s) => s.id)).size).toBe(UTOPIA_SCENARIOS.length);
    for (const s of UTOPIA_SCENARIOS) {
      expect(s.source, s.id).toBeTruthy();
      expect(seatCountFor(s.setup.format ?? "1v1"), s.id).toBeGreaterThan(2);
      expect(s.rules?.length, s.id).toBeGreaterThan(0);
      expect(outcomeAsserts(s.steps), s.id).toBe(true);
      expect(s.tags.some((tag) => /^card:\d+$/.test(tag)), s.id).toBe(true);
    }
  });
});
