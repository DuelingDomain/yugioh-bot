import { expect, it } from "vitest";
import { describeWithCores, needs } from "../../support/cores.js";
import type { KnownGap } from "../../support/expected-failure.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenario } from "../../support/session.js";
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
// These six Tag cases fail on the installed P68 cores. They need the "local zone viewer" core patch
// (01-local-zone-viewer.patch; docs/specs/2026-10-02-approved-core-integration.md lines 214 and 227-232).
// With that patch all 48 zone cases pass. Each case is green only for its known failure.
// When the patch lands the case fails with "known gap fixed": remove the entry then.
// emz-tag-arrow-viewer-p0 fails at step 1, so while it is marked the rest of its scenario body does not run.
const ZONE_VIEWER_PATCH = { patch: "01-local-zone-viewer.patch (local zone viewer)", spec: "docs/specs/2026-10-02-approved-core-integration.md:214,227" };
const EXPECTED_FAILURES: Record<string, KnownGap> = {};
for (const suffix of ["", "-domain"]) {
  EXPECTED_FAILURES[`emz-tag-columns-stay-on-each-seat${suffix}`] = { ...ZONE_VIEWER_PATCH,
    failsWith: [`step 15 expectNotOffered("specialSummon", "Mekk-Knight Purple Nightfall")`, "NOT to be offered, but it is"] };
  EXPECTED_FAILURES[`emz-tag-arrow-viewer-p0${suffix}`] = { ...ZONE_VIEWER_PATCH,
    failsWith: [`step 1 expectNotOffered("specialSummon", "Link Infra-Flier")`, "NOT to be offered, but it is"] };
  EXPECTED_FAILURES[`emz-tag-arrow-viewer-p3${suffix}`] = { ...ZONE_VIEWER_PATCH,
    failsWith: [`step 4 expectNotOffered("specialSummon", "Link Infra-Flier")`, "NOT to be offered, but it is"] };
}

describeWithCores("live multiplayer Extra Monster Zones", [liveNseat, ...needs.domainMulti()], () => {
  runScenarios("multiplayer/extra-monster-zones", EXTRA_MONSTER_ZONE_SCENARIOS, runScenario, EXPECTED_FAILURES);
});
