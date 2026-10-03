import { describe, expect, it } from "vitest";
import { seatCountFor } from "@yugidraft/shared/duels";
import { outcomeAsserts } from "../../../scripts/rule-coverage.js";
import { describeWithCores, needs } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import { LATE_CARD_SCENARIOS } from "./late-cards.js";
import { domainVariant } from "./domain-variants.js";

// Live scenarios of the late cards (Royal Tribute, Messenger of Peace, dice, coin, Ante, Tag Hero Counterattack and Foolish Revival, R3 cards).
// Same gate as the other live N-seat files: NSEAT_LIVE=1 and a multi core. Run it on the Standard multi core and again on the Domain multi core
// (NSEAT_WASM=domain-core/dist/ocgcore.multi-domain-P56.sync.wasm).
describeWithCores("live late-card scenarios", liveNseat, () => {
  runScenarios("multiplayer/late-cards", LATE_CARD_SCENARIOS);
});

// Check the FFA target limit and the Tag Graveyard rule in real Domain duels.
describeWithCores("Domain Foolish Revival", [liveNseat, ...needs.domainMulti()], () => {
  runScenarios("multiplayer/late-cards-domain", LATE_CARD_SCENARIOS
    .filter((scenario) => scenario.tags.includes("card:83778600"))
    .map(domainVariant));
});

describe("late-card scenario list", () => {
  it("has unique ids, a source, a multi-seat format, the rules it proves and an outcome after an action", () => {
    expect(new Set(LATE_CARD_SCENARIOS.map((s) => s.id)).size).toBe(LATE_CARD_SCENARIOS.length);
    for (const s of LATE_CARD_SCENARIOS) {
      expect(s.source, s.id).toBeTruthy();
      expect(seatCountFor(s.setup.format ?? "1v1"), s.id).toBeGreaterThan(2);
      if (!s.knownBug) {
        expect(s.rules?.length, s.id).toBeGreaterThan(0);
        expect(outcomeAsserts(s.steps), s.id).toBe(true);
      }
      expect(s.tags.some((tag) => /^card:\d+$/.test(tag)), s.id).toBe(true);
    }
  });
});
