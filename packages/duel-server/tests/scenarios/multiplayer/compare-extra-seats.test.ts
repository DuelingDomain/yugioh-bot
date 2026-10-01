import { describe, expect, it } from "vitest";
import { seatCountFor } from "@yugidraft/shared/duels";
import { readManifest } from "../../../scripts/generate-multi-scripts.js";
import { outcomeAsserts } from "../../../scripts/rule-coverage.js";
import { describeWithCores } from "../../support/cores.js";
import { probeCoreSeats } from "../../support/core-seats.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import { COMPARE_EXTRA_SEAT_SCENARIOS } from "./compare-extra-seats.js";

// Scenarios of overlay cards that need the core seats of patch 0053. Same gate as compare-extra.test.ts (NSEAT_LIVE=1 and a multi
// core), and the core must have Duel.MPSeat, Duel.MPSeatOf and Duel.MPBindSeat. A core without them (P52) skips the live run, and
// the skip names the missing patch. Set MULTI_WASM (and DOMAIN_MULTI_WASM) to the P53 builds to run it.
const hasSeats = process.env.NSEAT_LIVE === "1" && (await probeCoreSeats());

describeWithCores("live scenarios that need the core seats of patch 0053", liveNseat, () => {
  if (hasSeats) runScenarios("multiplayer/compare-extra-seats", COMPARE_EXTRA_SEAT_SCENARIOS);
  else it.skip("needs a multi core with patch 0053 (MPSeat, MPSeatOf, MPBindSeat): set NSEAT_WASM to ocgcore.multi-P53.sync.wasm", () => {});
});

describe("seat scenario list", () => {
  it("has unique ids, a source, a multi-seat format, the rules it proves and an outcome after an action", () => {
    expect(new Set(COMPARE_EXTRA_SEAT_SCENARIOS.map((s) => s.id)).size).toBe(COMPARE_EXTRA_SEAT_SCENARIOS.length);
    for (const s of COMPARE_EXTRA_SEAT_SCENARIOS) {
      expect(s.source, s.id).toBeTruthy();
      expect(seatCountFor(s.setup.format ?? "1v1"), s.id).toBeGreaterThan(2);
      expect(s.rules?.length, s.id).toBeGreaterThan(0);
      expect(outcomeAsserts(s.steps), s.id).toBe(true);
    }
  });

  it("tags every scenario with at least one card that has an overlay file", () => {
    const codes = new Set(readManifest().cards.map((card) => card.code));
    for (const s of COMPARE_EXTRA_SEAT_SCENARIOS) {
      const tagged = (s.tags ?? []).filter((tag) => tag.startsWith("card:")).map((tag) => Number(tag.slice(5)));
      expect(tagged.some((code) => codes.has(code)), `${s.id}: card tags ${tagged.join(", ")}`).toBe(true);
    }
  });
});
