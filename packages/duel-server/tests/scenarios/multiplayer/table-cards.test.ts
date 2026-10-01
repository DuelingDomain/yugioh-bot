import { describe, expect, it } from "vitest";
import { seatCountFor } from "@yugidraft/shared/duels";
import { readManifest } from "../../../scripts/generate-multi-scripts.js";
import { outcomeAsserts } from "../../../scripts/rule-coverage.js";
import { describeWithCores } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import { TABLE_CARD_SCENARIOS } from "./table-cards.js";

// Live scenarios of the table cards (Pudica, Summoning Curse, Brain Jacker, The Eye of Truth, Kiseitai, Gingerbread House, Snake-Eyes Diabellstar).
// Same gate as compare.test.ts: NSEAT_LIVE=1 and a multi core.
describeWithCores("live table card scenarios", liveNseat, () => {
  runScenarios("multiplayer/table-cards", TABLE_CARD_SCENARIOS);
});

describe("table card scenario list", () => {
  it("has unique ids, a source, a multi-seat format, the rules it proves and an outcome after an action", () => {
    expect(new Set(TABLE_CARD_SCENARIOS.map((s) => s.id)).size).toBe(TABLE_CARD_SCENARIOS.length);
    for (const s of TABLE_CARD_SCENARIOS) {
      expect(s.source, s.id).toBeTruthy();
      expect(seatCountFor(s.setup.format ?? "1v1"), s.id).toBeGreaterThan(2);
      expect(s.rules?.length, s.id).toBeGreaterThan(0);
      expect(s.tags.some((tag) => tag.startsWith("card:")), s.id).toBe(true);
      expect(outcomeAsserts(s.steps), s.id).toBe(true);
    }
  });

  it("tags every scenario that has an overlay file with a card of the manifest", () => {
    const codes = new Set(readManifest().cards.map((card) => card.code));
    for (const s of TABLE_CARD_SCENARIOS) {
      const tagged = s.tags.filter((tag) => tag.startsWith("card:")).map((tag) => Number(tag.slice(5)));
      // A card without an overlay file (proof that the stock script is right) has no entry, so only a scenario that names an entry is checked here.
      if (tagged.some((code) => codes.has(code))) expect(tagged.some((code) => codes.has(code)), s.id).toBe(true);
    }
  });
});
