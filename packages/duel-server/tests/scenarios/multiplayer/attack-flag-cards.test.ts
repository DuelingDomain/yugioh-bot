import { describe, expect, it } from "vitest";
import { seatCountFor } from "@yugidraft/shared/duels";
import { outcomeAsserts } from "../../../scripts/rule-coverage.js";
import { describeWithCores } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import { ATTACK_FLAG_SCENARIOS } from "./attack-flag-cards.js";

describeWithCores("live Sangen Kaiho scenarios", liveNseat, () => {
  runScenarios("multiplayer/attack-flag-cards", ATTACK_FLAG_SCENARIOS);
});

describe("Sangen Kaiho scenario list", () => {
  it("has unique ids, a source, a multi-seat format, the rules it proves, an outcome after an action and a card tag", () => {
    expect(new Set(ATTACK_FLAG_SCENARIOS.map((s) => s.id)).size).toBe(ATTACK_FLAG_SCENARIOS.length);
    for (const s of ATTACK_FLAG_SCENARIOS) {
      expect(s.source, s.id).toBeTruthy();
      expect(seatCountFor(s.setup.format ?? "1v1"), s.id).toBeGreaterThan(2);
      expect(s.rules?.length, s.id).toBeGreaterThan(0);
      expect(outcomeAsserts(s.steps), s.id).toBe(true);
      expect(s.tags.some((tag) => /^card:\d+$/.test(tag)), s.id).toBe(true);
    }
  });
});
