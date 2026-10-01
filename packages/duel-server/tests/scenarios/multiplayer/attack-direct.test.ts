import { describe, expect, it } from "vitest";
import { seatCountFor, teamOfSeat } from "@yugidraft/shared/duels";
import { readManifest } from "../../../scripts/generate-multi-scripts.js";
import { outcomeAsserts } from "../../../scripts/rule-coverage.js";
import { describeWithCores } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import { ATTACK_DIRECT_SCENARIOS } from "./attack-direct.js";

// Live scenarios of the cards that respond to a direct attack (manifest class ATTACK, domain-core/multi-scripts).
// Same gate as compare-extra.test.ts: NSEAT_LIVE=1 and a multi core.
describeWithCores("live direct attack scenarios", liveNseat, () => {
  runScenarios("multiplayer/attack-direct", ATTACK_DIRECT_SCENARIOS);
});

describe("direct attack scenario list", () => {
  it("has unique ids, a source, a multi-seat format, the rules it proves and an outcome after an action", () => {
    expect(new Set(ATTACK_DIRECT_SCENARIOS.map((s) => s.id)).size).toBe(ATTACK_DIRECT_SCENARIOS.length);
    for (const s of ATTACK_DIRECT_SCENARIOS) {
      expect(s.source, s.id).toBeTruthy();
      expect(seatCountFor(s.setup.format ?? "1v1"), s.id).toBeGreaterThan(2);
      expect(s.rules?.length, s.id).toBeGreaterThan(0);
      expect(outcomeAsserts(s.steps), s.id).toBe(true);
    }
  });

  it("tags every scenario with a card that has an ATTACK entry in the manifest", () => {
    const codes = new Set(readManifest().cards.filter((card) => card.classes.includes("ATTACK")).map((card) => card.code));
    for (const s of ATTACK_DIRECT_SCENARIOS) {
      const tagged = (s.tags ?? []).filter((tag) => tag.startsWith("card:")).map((tag) => Number(tag.slice(5)));
      expect(tagged.some((code) => codes.has(code)), `${s.id}: card tags ${tagged.join(", ")}`).toBe(true);
    }
  });

  it("asks for an opponent pick only while the duelist has two or more opponents alive", () => {
    const seatOf = (id: string) => Number(id.slice(1));
    for (const s of ATTACK_DIRECT_SCENARIOS) {
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
