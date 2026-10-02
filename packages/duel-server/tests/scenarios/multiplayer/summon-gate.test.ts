import { describe, expect, it } from "vitest";
import { seatCountFor } from "@yugidraft/shared/duels";
import { outcomeAsserts } from "../../../scripts/rule-coverage.js";
import { describeWithCores } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import { SUMMON_GATE_SCENARIOS } from "./summon-gate.js";

// Live scenarios of Summon Gate: the limit of 3 Extra Deck summons is counted per summoning seat (FFA) or team (Tag).
// Same gate as the other live N-seat files: NSEAT_LIVE=1 and a multi core. Run it on the Standard multi core and again on the Domain multi core
// (NSEAT_WASM=domain-core/dist/ocgcore.multi-domain-P59.sync.wasm).
describeWithCores("live Summon Gate scenarios", liveNseat, () => {
  runScenarios("multiplayer/summon-gate", SUMMON_GATE_SCENARIOS);
});

describe("Summon Gate scenario list", () => {
  it("has unique ids, a source, a multi-seat format, the rules it proves, an outcome after an action and a card tag", () => {
    expect(new Set(SUMMON_GATE_SCENARIOS.map((s) => s.id)).size).toBe(SUMMON_GATE_SCENARIOS.length);
    for (const s of SUMMON_GATE_SCENARIOS) {
      expect(s.source, s.id).toBeTruthy();
      expect(seatCountFor(s.setup.format ?? "1v1"), s.id).toBeGreaterThan(2);
      expect(s.rules?.length, s.id).toBeGreaterThan(0);
      expect(outcomeAsserts(s.steps), s.id).toBe(true);
      expect(s.tags.some((tag) => /^card:\d+$/.test(tag)), s.id).toBe(true);
    }
  });
});
