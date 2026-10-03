import { describe, expect, it } from "vitest";
import { describeWithCores, needs } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import { domainVariant } from "./domain-variants.js";
import { TAG_GRAVE_MATERIAL_REVIEW_SCENARIOS } from "./tag-grave-material-review.js";

describeWithCores("live Tag extra Graveyard material review", liveNseat, () => {
  runScenarios("multiplayer/tag-grave-material-review", TAG_GRAVE_MATERIAL_REVIEW_SCENARIOS);
});
describeWithCores("live Domain Tag extra Graveyard material review", [liveNseat, ...needs.domainMulti()], () => {
  runScenarios("multiplayer/tag-grave-material-review-domain", TAG_GRAVE_MATERIAL_REVIEW_SCENARIOS.map(domainVariant));
});
describe("extra Graveyard material review proofs", () => {
  it("checks the state of every seat after a real action or material refusal", () => {
    expect(new Set(TAG_GRAVE_MATERIAL_REVIEW_SCENARIOS.map((s) => s.id)).size).toBe(TAG_GRAVE_MATERIAL_REVIEW_SCENARIOS.length);
    for (const scenario of TAG_GRAVE_MATERIAL_REVIEW_SCENARIOS) {
      const last = scenario.steps.at(-1);
      expect(last?.op, scenario.id).toBe("expectBoard");
      if (last?.op === "expectBoard") expect(Object.keys(last.board), scenario.id).toHaveLength(scenario.setup.format === "ffa3" ? 3 : 4);
      expect(scenario.steps.some((s) => s.op === "activate" || s.op === "expectNotOffered"), scenario.id).toBe(true);
    }
  });
});
