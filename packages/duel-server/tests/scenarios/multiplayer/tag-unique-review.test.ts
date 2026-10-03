import { describe, expect, it } from "vitest";
import { outcomeAsserts } from "../../../scripts/rule-coverage.js";
import { describeWithCores, needs } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import { domainVariant } from "./domain-variants.js";
import { TAG_UNIQUE_REVIEW_SCENARIOS } from "./tag-unique-review.js";

const DOMAIN_VARIANTS = TAG_UNIQUE_REVIEW_SCENARIOS.map(domainVariant).map((scenario) => ({
  ...scenario,
  steps: scenario.steps.map((step) => step.op === "expectBoard" ? {
    ...step, board: Object.fromEntries(Object.entries(step.board).map(([seat, state]) => [seat, { ...state, deckMaster: { inZone: true } }])),
  } : step),
}));
describeWithCores("live unique cards per Tag team", liveNseat, () => {
  runScenarios("multiplayer/tag-unique-review", TAG_UNIQUE_REVIEW_SCENARIOS);
});
describeWithCores("live unique cards per Tag team in Domain", [liveNseat, ...needs.domainMulti()], () => {
  runScenarios("multiplayer/tag-unique-review-domain", DOMAIN_VARIANTS);
});
describe("unique review scenario list", () => {
  it("covers both teams, FFA3, FFA4, and each Domain variant with an outcome after an action", () => {
    expect(new Set(TAG_UNIQUE_REVIEW_SCENARIOS.map((s) => s.id)).size).toBe(TAG_UNIQUE_REVIEW_SCENARIOS.length);
    for (const s of TAG_UNIQUE_REVIEW_SCENARIOS) {
      expect(outcomeAsserts(s.steps), s.id).toBe(true);
      expect(s.rules, s.id).toContain("R-TAG-UNIQUE");
    }
    for (const suffix of ["team-0", "team-1", "ffa3", "ffa4"]) expect(TAG_UNIQUE_REVIEW_SCENARIOS.some((s) => s.id.includes(suffix)), suffix).toBe(true);
    expect(DOMAIN_VARIANTS).toHaveLength(TAG_UNIQUE_REVIEW_SCENARIOS.length);
  });
});
