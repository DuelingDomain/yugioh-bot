import { describe, expect, it } from "vitest";
import { seatCountFor } from "@yugidraft/shared/duels";
import { describeWithCores } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import { ALT_WIN_SCENARIOS } from "./alt-win.js";

// Live scenarios of the owner decision 2026-11-22: a 'you win' card ends the duel for its owner or team.
describeWithCores("live alt-win scenarios", liveNseat, () => {
  runScenarios("multiplayer/alt-win", ALT_WIN_SCENARIOS);
});

describe("alt-win scenario list", () => {
  it("has unique ids, a source, a multi-seat format and the rules it proves", () => {
    expect(new Set(ALT_WIN_SCENARIOS.map((s) => s.id)).size).toBe(ALT_WIN_SCENARIOS.length);
    for (const s of ALT_WIN_SCENARIOS) {
      expect(s.source, s.id).toBeTruthy();
      expect(seatCountFor(s.setup.format ?? "1v1"), s.id).toBeGreaterThan(2);
      expect(s.rules?.length, s.id).toBeGreaterThan(0);
    }
  });
});
