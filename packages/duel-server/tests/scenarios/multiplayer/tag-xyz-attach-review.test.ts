import { describe, expect, it } from "vitest";
import { outcomeAsserts } from "../../../scripts/rule-coverage.js";
import { describeWithCores, needs } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import { domainVariant } from "./domain-variants.js";
import { TAG_XYZ_ATTACH_REVIEW_SCENARIOS } from "./tag-xyz-attach-review.js";

const DOMAIN_VARIANTS = TAG_XYZ_ATTACH_REVIEW_SCENARIOS.map(domainVariant).map((scenario) => ({
  ...scenario,
  steps: scenario.steps.map((step) => step.op === "expectBoard" ? {
    ...step, board: Object.fromEntries(Object.entries(step.board).map(([seat, state]) => [seat, { ...state, deckMaster: { inZone: true } }])),
  } : step),
}));
describeWithCores("live Tag partner Xyz attach by effect", liveNseat, () => {
  runScenarios("multiplayer/tag-xyz-attach-review", TAG_XYZ_ATTACH_REVIEW_SCENARIOS);
});
describeWithCores("live Tag partner Xyz attach by effect in Domain", [liveNseat, ...needs.domainMulti()], () => {
  runScenarios("multiplayer/tag-xyz-attach-review-domain", DOMAIN_VARIANTS);
});
describe("Xyz attach review scenario list", () => {
  it("covers both teams, own and opposing immutable cards, FFA3, FFA4, and every Domain variant", () => {
    expect(new Set(TAG_XYZ_ATTACH_REVIEW_SCENARIOS.map((s) => s.id)).size).toBe(TAG_XYZ_ATTACH_REVIEW_SCENARIOS.length);
    for (const s of TAG_XYZ_ATTACH_REVIEW_SCENARIOS) expect(outcomeAsserts(s.steps), s.id).toBe(true);
    for (const suffix of ["team-0", "team-1", "ffa3", "ffa4"]) expect(TAG_XYZ_ATTACH_REVIEW_SCENARIOS.some((s) => s.id.includes(suffix)), suffix).toBe(true);
    expect(DOMAIN_VARIANTS).toHaveLength(TAG_XYZ_ATTACH_REVIEW_SCENARIOS.length);
  });
});
