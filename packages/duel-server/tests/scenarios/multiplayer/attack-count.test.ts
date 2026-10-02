import { describe, expect, it } from "vitest";
import { seatCountFor } from "@yugidraft/shared/duels";
import { outcomeAsserts } from "../../../scripts/rule-coverage.js";
import { describeWithCores } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import { ATTACK_COUNT_SCENARIOS } from "./attack-count.js";

// Live scenarios of the cards that count the direct attacks per attacked duelist (Confusion Chaff, Ogre of the Scarlet Sorrow).
// Same gate as the other live N-seat files: NSEAT_LIVE=1 and a multi core. Run it on the Standard multi core and again on the Domain multi core
// (NSEAT_WASM=domain-core/dist/ocgcore.multi-domain-P61.sync.wasm).
describeWithCores("live attack count scenarios", liveNseat, () => {
  runScenarios("multiplayer/attack-count", ATTACK_COUNT_SCENARIOS);
});

describe("attack count scenario list", () => {
  it("has unique ids, a source, a multi-seat format, the rules it proves, an outcome after an action and a card tag", () => {
    expect(new Set(ATTACK_COUNT_SCENARIOS.map((s) => s.id)).size).toBe(ATTACK_COUNT_SCENARIOS.length);
    for (const s of ATTACK_COUNT_SCENARIOS) {
      expect(s.source, s.id).toBeTruthy();
      expect(seatCountFor(s.setup.format ?? "1v1"), s.id).toBeGreaterThan(2);
      expect(s.rules?.length, s.id).toBeGreaterThan(0);
      expect(outcomeAsserts(s.steps), s.id).toBe(true);
      expect(s.tags.some((tag) => /^card:\d+$/.test(tag)), s.id).toBe(true);
    }
  });
});
