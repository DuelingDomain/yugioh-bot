import { describe, expect, it } from "vitest";
import { seatCountFor } from "@yugidraft/shared/duels";
import { outcomeAsserts } from "../../../scripts/rule-coverage.js";
import { describeWithCores } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import { DUEL_STYLE_FFA4_SCENARIOS } from "./duel-style-ffa4.js";

// FFA4 scenarios of Soul Exchange, Snatch Steal and Fire Ejection. Same gate as the other live N-seat files: NSEAT_LIVE=1 and a multi core.
describeWithCores("live duel-style scenarios at FFA4", liveNseat, () => {
  runScenarios("multiplayer/duel-style-ffa4", DUEL_STYLE_FFA4_SCENARIOS);
});

describe("duel-style FFA4 scenario list", () => {
  it("has unique ids, a source, a 4-seat format, the rules it proves, an outcome after an action and a card tag", () => {
    expect(new Set(DUEL_STYLE_FFA4_SCENARIOS.map((s) => s.id)).size).toBe(DUEL_STYLE_FFA4_SCENARIOS.length);
    for (const s of DUEL_STYLE_FFA4_SCENARIOS) {
      expect(s.source, s.id).toBeTruthy();
      expect(seatCountFor(s.setup.format ?? "1v1"), s.id).toBe(4);
      expect(s.rules?.length, s.id).toBeGreaterThan(0);
      expect(outcomeAsserts(s.steps), s.id).toBe(true);
      expect(s.tags.some((tag) => /^card:\d+$/.test(tag)), s.id).toBe(true);
    }
  });
});
