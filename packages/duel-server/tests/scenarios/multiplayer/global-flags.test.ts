import { describe, expect, it } from "vitest";
import { seatCountFor } from "@yugidraft/shared/duels";
import { outcomeAsserts } from "../../../scripts/rule-coverage.js";
import { describeWithCores } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import { GLOBAL_FLAG_SCENARIOS } from "./global-flags.js";

// Live scenarios of the per-player flags of a global check. Same gate as nseat-live.test.ts: NSEAT_LIVE=1 and a multi core.
describeWithCores("live global-flags scenarios", liveNseat, () => {
  runScenarios("multiplayer/global-flags", GLOBAL_FLAG_SCENARIOS);
});

describe("global-flags scenario list", () => {
  it("has unique ids, a source, a multi-seat format, the rules it proves and an outcome after an action", () => {
    expect(new Set(GLOBAL_FLAG_SCENARIOS.map((s) => s.id)).size).toBe(GLOBAL_FLAG_SCENARIOS.length);
    for (const s of GLOBAL_FLAG_SCENARIOS) {
      expect(s.source, s.id).toBeTruthy();
      expect(seatCountFor(s.setup.format ?? "1v1"), s.id).toBeGreaterThan(2);
      expect(s.rules?.length, s.id).toBeGreaterThan(0);
      expect(outcomeAsserts(s.steps), s.id).toBe(true);
      expect(s.tags.some((tag) => tag.startsWith("card:")), s.id).toBe(true);
    }
  });
});
