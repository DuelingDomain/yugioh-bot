import { describe, expect, it } from "vitest";
import { seatCountFor } from "@yugidraft/shared/duels";
import { outcomeAsserts } from "../../../scripts/rule-coverage.js";
import { describeWithCores } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import { TAG_TEAM_LOSS_SCENARIOS } from "./tag-team-loss.js";

// Tag team loss by an empty Deck, one member alone. Same gate as the other live N-seat files: NSEAT_LIVE=1 and a multi core.
// Run it on the Standard multi core and again on the Domain multi core (NSEAT_WASM=domain-core/dist/ocgcore.multi-domain-P61.sync.wasm).
describeWithCores("live Tag team loss scenarios", liveNseat, () => {
  runScenarios("multiplayer/tag-team-loss", TAG_TEAM_LOSS_SCENARIOS);
});

describe("Tag team loss scenario list", () => {
  it("has unique ids, a source, the Tag format, the rules it proves, an outcome after an action and a card tag", () => {
    expect(new Set(TAG_TEAM_LOSS_SCENARIOS.map((s) => s.id)).size).toBe(TAG_TEAM_LOSS_SCENARIOS.length);
    for (const s of TAG_TEAM_LOSS_SCENARIOS) {
      expect(s.source, s.id).toBeTruthy();
      expect(s.setup.format, s.id).toBe("tag");
      expect(seatCountFor(s.setup.format ?? "1v1"), s.id).toBeGreaterThan(2);
      expect(s.rules, s.id).toContain("R-TAG-LOSS");
      expect(outcomeAsserts(s.steps), s.id).toBe(true);
      expect(s.tags.some((tag) => /^card:\d+$/.test(tag)), s.id).toBe(true);
    }
  });
});
