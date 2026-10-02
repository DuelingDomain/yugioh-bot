import { describe, expect, it } from "vitest";
import { seatCountFor } from "@yugidraft/shared/duels";
import { outcomeAsserts } from "../../../scripts/rule-coverage.js";
import { describeWithCores } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import { R2_NOCHANGE_SCENARIOS } from "./r2-nochange.js";

// Live proofs of the R2 "no change" cards that no other file plays (R2_NO_CHANGE in scripts/generate-multi-scripts.ts).
// Same gate as the other live N-seat files: NSEAT_LIVE=1 and a multi core. Run it on the Standard multi core and again on the Domain multi core
// (NSEAT_WASM=data/duel-engine-next/ocgcore.multi-domain.wasm).
describeWithCores("live R2 no-change scenarios", liveNseat, () => {
  runScenarios("multiplayer/r2-nochange", R2_NOCHANGE_SCENARIOS);
});

describe("R2 no-change scenario list", () => {
  it("has unique ids, a source, a multi-seat format, the rules it proves, an outcome after an action and a card tag", () => {
    expect(new Set(R2_NOCHANGE_SCENARIOS.map((s) => s.id)).size).toBe(R2_NOCHANGE_SCENARIOS.length);
    for (const s of R2_NOCHANGE_SCENARIOS) {
      expect(s.source, s.id).toBeTruthy();
      expect(seatCountFor(s.setup.format ?? "1v1"), s.id).toBeGreaterThan(2);
      expect(s.rules?.length, s.id).toBeGreaterThan(0);
      expect(outcomeAsserts(s.steps), s.id).toBe(true);
      expect(s.tags.some((tag) => /^card:\d+$/.test(tag)), s.id).toBe(true);
    }
  });
});
