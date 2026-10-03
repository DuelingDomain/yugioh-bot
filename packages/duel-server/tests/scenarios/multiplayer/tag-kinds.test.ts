import { describe, expect, it } from "vitest";
import { seatCountFor } from "@yugidraft/shared/duels";
import { outcomeAsserts } from "../../../scripts/rule-coverage.js";
import { describeWithCores } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import { TAG_KIND_SCENARIOS } from "./tag-kinds.js";

// Tag scenarios for the overlay kinds trig and chooser (review B). The Tag joined opposing field is native in the core, so these prove that the
// overlay card does not break the Tag flow; domain-variants.test.ts runs the same two scenarios in a real Domain duel.
// Same gate as the other live N-seat files: NSEAT_LIVE=1 and a multi core.
describeWithCores("live Tag scenarios of the trigger and chooser overlay cards", liveNseat, () => {
  runScenarios("multiplayer/tag-kinds", TAG_KIND_SCENARIOS);
});

describe("Tag kind scenario list", () => {
  it("has unique ids, a source, a Tag format, the rules it proves and an outcome after an action", () => {
    expect(new Set(TAG_KIND_SCENARIOS.map((s) => s.id)).size).toBe(TAG_KIND_SCENARIOS.length);
    for (const s of TAG_KIND_SCENARIOS) {
      expect(s.source, s.id).toBeTruthy();
      expect(s.setup.format, s.id).toBe("tag");
      expect(seatCountFor("tag"), s.id).toBe(4);
      expect(s.rules?.length, s.id).toBeGreaterThan(0);
      expect(outcomeAsserts(s.steps), s.id).toBe(true);
    }
  });
});
