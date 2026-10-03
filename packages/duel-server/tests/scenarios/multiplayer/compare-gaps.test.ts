import { describe, expect, it } from "vitest";
import { seatCountFor, teamOfSeat } from "@yugidraft/shared/duels";
import { readManifest } from "../../../scripts/generate-multi-scripts.js";
import { outcomeAsserts } from "../../../scripts/rule-coverage.js";
import { describeWithCores } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import { COMPARE_GAP_SCENARIOS } from "./compare-gaps.js";

// Live scenarios of the scan-gap compare cards (Three in One, Sangen Kaiho, Exciton Knight, Ghost Reaper, Mimighoul Slime), Kaiser Colosseum and the per-opponent Mystic Mine (domain-core/multi-scripts). Same gate as compare.test.ts:
// NSEAT_LIVE=1 and a multi core.
describeWithCores("live compare scenarios of the scan-gap cards, Kaiser Colosseum, Ultimate Sky and Mystic Mine", liveNseat, () => {
  runScenarios("multiplayer/compare-gaps", COMPARE_GAP_SCENARIOS);
});

describe("compare gap scenario list", () => {
  it("has unique ids, a source, a multi-seat format, the rules it proves and an outcome after an action", () => {
    expect(new Set(COMPARE_GAP_SCENARIOS.map((s) => s.id)).size).toBe(COMPARE_GAP_SCENARIOS.length);
    for (const s of COMPARE_GAP_SCENARIOS) {
      expect(s.source, s.id).toBeTruthy();
      expect(seatCountFor(s.setup.format ?? "1v1"), s.id).toBeGreaterThan(2);
      expect(s.rules?.length, s.id).toBeGreaterThan(0);
      expect(outcomeAsserts(s.steps), s.id).toBe(true);
    }
  });

  it("tags every scenario with at least one card that has an overlay file", () => {
    const codes = new Set(readManifest().cards.map((card) => card.code));
    for (const s of COMPARE_GAP_SCENARIOS) {
      const tagged = (s.tags ?? []).filter((tag) => tag.startsWith("card:")).map((tag) => Number(tag.slice(5)));
      expect(tagged.some((code) => codes.has(code)), `${s.id}: card tags ${tagged.join(", ")}`).toBe(true);
    }
  });

  it("asks for an opponent pick only while the duelist has two or more opponents alive", () => {
    const seatOf = (id: string) => Number(id.slice(1));
    for (const s of COMPARE_GAP_SCENARIOS) {
      const format = s.setup.format ?? "1v1";
      for (const step of s.steps) {
        if (step.op !== "pickOpponent") continue;
        expect(step.by, `${s.id}: pickOpponent names the duelist`).toBeDefined();
        const duelist = seatOf(step.by!);
        const opponents = Array.from({ length: seatCountFor(format) }, (_, seat) => seat).filter(
          (seat) => teamOfSeat(format, seat) !== teamOfSeat(format, duelist),
        );
        expect(opponents.length, s.id).toBeGreaterThanOrEqual(2);
        expect(opponents, s.id).toContain(seatOf(step.seat));
      }
    }
  });
});
