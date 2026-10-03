import { describe, expect, it } from "vitest";
import { seatCountFor } from "@yugidraft/shared/duels";
import { outcomeAsserts } from "../../../scripts/rule-coverage.js";
import { describeWithCores } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import { FLAG_ATK_SCENARIOS } from "./flag-atk-cards.js";

describeWithCores("live Chaos Archfiend and Chaos Beast scenarios", liveNseat, () => {
  runScenarios("multiplayer/flag-atk-cards", FLAG_ATK_SCENARIOS);
});

describe("Chaos Archfiend and Chaos Beast scenario list", () => {
  it("has unique ids, a source, a multi-seat format, the rules it proves, an outcome after an action and a card tag", () => {
    expect(new Set(FLAG_ATK_SCENARIOS.map((s) => s.id)).size).toBe(FLAG_ATK_SCENARIOS.length);
    for (const s of FLAG_ATK_SCENARIOS) {
      expect(s.source, s.id).toBeTruthy();
      expect(seatCountFor(s.setup.format ?? "1v1"), s.id).toBeGreaterThan(2);
      expect(s.rules?.length, s.id).toBeGreaterThan(0);
      expect(outcomeAsserts(s.steps), s.id).toBe(true);
      expect(s.tags.some((tag) => /^card:\d+$/.test(tag)), s.id).toBe(true);
    }
  });
});
