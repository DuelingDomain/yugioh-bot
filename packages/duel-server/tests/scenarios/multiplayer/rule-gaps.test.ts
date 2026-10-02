import { describe, expect, it } from "vitest";
import { seatCountFor } from "@yugidraft/shared/duels";
import { readManifest } from "../../../scripts/generate-multi-scripts.js";
import { outcomeAsserts } from "../../../scripts/rule-coverage.js";
import { describeWithCores, needs } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import { domainVariant } from "./domain-variants.js";
import { RULE_GAP_SCENARIOS } from "./rule-gaps.js";

// Live scenarios for the rules that had no scenario in the rule table (Dark Hole, Solemn Judgment, Jinzo, Swords of
// Revealing Light). Same gate as the other live N-seat files: NSEAT_LIVE=1 and a multi core. They run again in a Domain duel (a Deck Master for
// each seat) on the Domain multi core.
describeWithCores("live scenarios of the rules that had no scenario", liveNseat, () => {
  runScenarios("multiplayer/rule-gaps", RULE_GAP_SCENARIOS);
});

describeWithCores("live Domain duel scenarios of the rules that had no scenario", [liveNseat, ...needs.domainMulti()], () => {
  runScenarios("multiplayer/rule-gaps-domain", RULE_GAP_SCENARIOS.map(domainVariant));
});

describe("rule gap scenario list", () => {
  it("has unique ids, a source, a multi-seat format, the rules it proves and an outcome after an action", () => {
    expect(new Set(RULE_GAP_SCENARIOS.map((s) => s.id)).size).toBe(RULE_GAP_SCENARIOS.length);
    for (const s of RULE_GAP_SCENARIOS) {
      expect(s.source, s.id).toBeTruthy();
      expect(seatCountFor(s.setup.format ?? "1v1"), s.id).toBeGreaterThan(2);
      expect(s.rules?.length, s.id).toBeGreaterThan(0);
      expect(outcomeAsserts(s.steps), s.id).toBe(true);
    }
  });

  it("proves each of the 4 rules in Free-for-all and, where the rule is about the partner, in Tag", () => {
    const rules = new Set(RULE_GAP_SCENARIOS.flatMap((s) => s.rules ?? []));
    expect([...rules].sort()).toEqual(["R-COMMON-ALL-BOTH", "R-COMMON-CONT-NEG", "R-COMMON-ONGOING", "R-FFA-NEGATE"]);
    const tagRules = new Set(RULE_GAP_SCENARIOS.filter((s) => s.setup.format === "tag").flatMap((s) => s.rules ?? []));
    for (const rule of ["R-COMMON-ALL-BOTH", "R-COMMON-CONT-NEG", "R-COMMON-ONGOING"]) expect(tagRules.has(rule), rule).toBe(true);
  });

  it("tags the cards that have a script of the overlay where it matters", () => {
    const codes = new Set(readManifest().cards.map((card) => card.code));
    expect(codes.size).toBeGreaterThan(0);
    for (const s of RULE_GAP_SCENARIOS) expect(s.tags.some((tag) => tag.startsWith("card:")), s.id).toBe(true);
  });
});
