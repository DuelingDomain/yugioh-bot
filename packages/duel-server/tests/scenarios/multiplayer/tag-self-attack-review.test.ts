import { describe, expect, it } from "vitest";
import { describeWithCores, needs } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import { domainVariant } from "./domain-variants.js";
import { TAG_SELF_ATTACK_REVIEW_SCENARIOS } from "./tag-self-attack-review.js";

// Use the private card-data copy after self-scenario-support/setup.py has added the fixture.
// Point NSEAT_WASM and DOMAIN_MULTI_WASM at the core under test; the fixture changes no core or overlay.
describeWithCores("live Tag self attack review", liveNseat, () => {
  runScenarios("multiplayer/tag-self-attack-review", TAG_SELF_ATTACK_REVIEW_SCENARIOS);
});
describeWithCores("live Domain Tag self attack review", [liveNseat, ...needs.domainMulti()], () => {
  runScenarios("multiplayer/tag-self-attack-review-domain", TAG_SELF_ATTACK_REVIEW_SCENARIOS.map(domainVariant));
});
describe("self attack review proofs", () => {
  it("checks every seat after real battle and distinguishes effect and no-effect target lists", () => {
    expect(new Set(TAG_SELF_ATTACK_REVIEW_SCENARIOS.map((s) => s.id)).size).toBe(TAG_SELF_ATTACK_REVIEW_SCENARIOS.length);
    for (const scenario of TAG_SELF_ATTACK_REVIEW_SCENARIOS) {
      expect(scenario.steps.some((s) => s.op === "expectPickOptions"), scenario.id).toBe(true);
      expect(scenario.steps.some((s) => s.op === "select"), scenario.id).toBe(true);
      const last = scenario.steps.at(-1);
      expect(last?.op, scenario.id).toBe("expectBoard");
      if (last?.op === "expectBoard") expect(Object.keys(last.board), scenario.id).toHaveLength(scenario.setup.format === "ffa3" ? 3 : 4);
    }
  });
});
