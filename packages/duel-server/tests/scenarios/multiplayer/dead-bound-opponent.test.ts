import { describe, expect, it } from "vitest";
import { seatCountFor } from "@yugidraft/shared/duels";
import { outcomeAsserts } from "../../../scripts/rule-coverage.js";
import { describeWithCores } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import { DEAD_BOUND_OPPONENT_SCENARIOS } from "./dead-bound-opponent.js";

// Live scenarios of core fix OQ3 (a dead bound opponent is "no effect", never a Lua error). They run the STOCK script of Snake-Eyes Diabellstar:
// the overlay has no file for it (the old c27260347.lua "or 0" workaround is gone), so the core alone must keep the duel running.
// Same gate as the other live N-seat files: NSEAT_LIVE=1 and a multi core. These scenarios need a core with patch 0059 (the P59 build or later,
// installed in data/duel-engine-next). On an older core the duel stops with "attempt to compare nil with number".

describeWithCores("live dead-bound-opponent scenarios (stock script)", liveNseat, () => {
  runScenarios("multiplayer/dead-bound-opponent", DEAD_BOUND_OPPONENT_SCENARIOS);
});

describe("dead-bound-opponent scenario list", () => {
  it("has unique ids, a source, a multi-seat format, the rules it proves and an outcome after an action", () => {
    expect(new Set(DEAD_BOUND_OPPONENT_SCENARIOS.map((s) => s.id)).size).toBe(DEAD_BOUND_OPPONENT_SCENARIOS.length);
    for (const s of DEAD_BOUND_OPPONENT_SCENARIOS) {
      expect(s.source, s.id).toBeTruthy();
      expect(seatCountFor(s.setup.format ?? "1v1"), s.id).toBeGreaterThan(2);
      expect(s.rules?.length, s.id).toBeGreaterThan(0);
      expect(s.tags.some((tag) => /^card:\d+$/.test(tag)), s.id).toBe(true);
      expect(outcomeAsserts(s.steps), s.id).toBe(true);
    }
  });
});
