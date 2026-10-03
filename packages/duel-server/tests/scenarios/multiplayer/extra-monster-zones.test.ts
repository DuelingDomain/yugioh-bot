import { expect, it } from "vitest";
import { describeWithCores, needs } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import { EXTRA_MONSTER_ZONE_SCENARIOS } from "./extra-monster-zones.js";

it.each([
  { format: "ffa4", rule: "R-FFA-ACROSS-EMZ", otherRule: "R-COMMON-EMZ" },
  { format: "ffa3", rule: "R-COMMON-EMZ", otherRule: "R-FFA-ACROSS-EMZ" },
  { format: "tag", rule: "R-COMMON-EMZ", otherRule: "R-FFA-ACROSS-EMZ" },
])("$format Extra Monster Zone rows use $rule", ({ format, rule, otherRule }) => {
  const scenarios = EXTRA_MONSTER_ZONE_SCENARIOS.filter((scenario) => scenario.setup.format === format);
  expect(scenarios.length).toBeGreaterThan(0);
  for (const scenario of scenarios) {
    expect(scenario.rules, scenario.id).toContain(rule);
    expect(scenario.rules, scenario.id).not.toContain(otherRule);
    expect(scenario.source, scenario.id).toContain(`[${rule}]`);
    expect(scenario.source, scenario.id).not.toContain(`[${otherRule}]`);
  }
});

describeWithCores("live multiplayer Extra Monster Zones", [liveNseat, ...needs.domainMulti()], () => {
  runScenarios("multiplayer/extra-monster-zones", EXTRA_MONSTER_ZONE_SCENARIOS);
});
