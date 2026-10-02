import { describe, expect, it } from "vitest";
import { seatCountFor } from "@yugidraft/shared/duels";
import { outcomeAsserts } from "../../../scripts/rule-coverage.js";
import { describeWithCores, needs } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import { DOMAIN_NSEAT_GAP_SCENARIOS } from "./domain-nseat-gaps.js";

describeWithCores("live Domain n-seat Deck Master scenarios", [liveNseat, ...needs.domainMulti()], () => {
  runScenarios("multiplayer/domain-nseat-gaps", DOMAIN_NSEAT_GAP_SCENARIOS);
});

describe("Domain n-seat Deck Master scenario list", () => {
  it("has unique ids, a source, a multi-seat format, the rules it proves, an outcome after an action and a card tag", () => {
    expect(new Set(DOMAIN_NSEAT_GAP_SCENARIOS.map((s) => s.id)).size).toBe(DOMAIN_NSEAT_GAP_SCENARIOS.length);
    for (const s of DOMAIN_NSEAT_GAP_SCENARIOS) {
      expect(s.source, s.id).toBeTruthy();
      expect(seatCountFor(s.setup.format ?? "1v1"), s.id).toBeGreaterThan(2);
      expect(s.rules?.length, s.id).toBeGreaterThan(0);
      expect(outcomeAsserts(s.steps), s.id).toBe(true);
      expect(s.tags.some((tag) => /^card:\d+$/.test(tag)), s.id).toBe(true);
    }
  });
});
