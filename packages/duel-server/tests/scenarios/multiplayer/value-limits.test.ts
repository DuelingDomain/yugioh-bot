import { describe, expect, it } from "vitest";
import { seatCountFor } from "@yugidraft/shared/duels";
import { outcomeAsserts } from "../../../scripts/rule-coverage.js";
import { describeWithCores } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import { VALUE_LIMIT_SCENARIOS } from "./value-limits.js";

// Live scenarios of the summon limits with a folded player in the value function (Gozen Match, Rivalry of Warlords).
// Same gate as the other live N-seat files: NSEAT_LIVE=1 and a multi core. Run it on the Standard multi core and again on the Domain multi core
// (NSEAT_WASM=domain-core/dist/ocgcore.multi-domain-P56.sync.wasm).
describeWithCores("live value-limit scenarios", liveNseat, () => {
  runScenarios("multiplayer/value-limits", VALUE_LIMIT_SCENARIOS);
});

describe("value-limit scenario list", () => {
  it("has unique ids, a source, a multi-seat format, the rules it proves, an outcome after an action and a card tag", () => {
    expect(new Set(VALUE_LIMIT_SCENARIOS.map((s) => s.id)).size).toBe(VALUE_LIMIT_SCENARIOS.length);
    for (const s of VALUE_LIMIT_SCENARIOS) {
      expect(s.source, s.id).toBeTruthy();
      expect(seatCountFor(s.setup.format ?? "1v1"), s.id).toBeGreaterThan(2);
      expect(s.rules?.length, s.id).toBeGreaterThan(0);
      expect(outcomeAsserts(s.steps), s.id).toBe(true);
      expect(s.tags.some((tag) => /^card:\d+$/.test(tag)), s.id).toBe(true);
    }
  });
});
