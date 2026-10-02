import { describe, expect, it } from "vitest";
import { seatCountFor } from "@yugidraft/shared/duels";
import { outcomeAsserts } from "../../../scripts/rule-coverage.js";
import { describeWithCores } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import { TAG_PARTNER_COST_SCENARIOS } from "./tag-partner-cost.js";

describeWithCores("live Tag partner cost scenarios", liveNseat, () => {
  runScenarios("multiplayer/tag-partner-cost", TAG_PARTNER_COST_SCENARIOS);
});

describe("Tag partner cost scenario list", () => {
  it("has unique ids, a source, a multi-seat format, the rules it proves, an outcome after an action and a card tag", () => {
    expect(new Set(TAG_PARTNER_COST_SCENARIOS.map((s) => s.id)).size).toBe(TAG_PARTNER_COST_SCENARIOS.length);
    for (const s of TAG_PARTNER_COST_SCENARIOS) {
      expect(s.source, s.id).toBeTruthy();
      expect(seatCountFor(s.setup.format ?? "1v1"), s.id).toBeGreaterThan(2);
      expect(s.rules?.length, s.id).toBeGreaterThan(0);
      expect(outcomeAsserts(s.steps), s.id).toBe(true);
      expect(s.tags.some((tag) => /^card:\d+$/.test(tag)), s.id).toBe(true);
    }
  });
});
