import { describe, expect, it } from "vitest";
import { seatCountFor } from "@yugidraft/shared/duels";
import { outcomeAsserts } from "../../../scripts/rule-coverage.js";
import { describeWithCores, needs } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import { domainVariant } from "./domain-variants.js";
import { TAG_TEAM_RULES_SCENARIOS } from "./tag-team-rules.js";

const DOMAIN_VARIANTS = TAG_TEAM_RULES_SCENARIOS.map(domainVariant);

describeWithCores("live Tag team rule scenarios (Synchro with a partner monster)", liveNseat, () => {
  runScenarios("multiplayer/tag-team-rules", TAG_TEAM_RULES_SCENARIOS);
});

describeWithCores("live Tag team rule scenarios in a Domain duel (a Deck Master for each seat)", [liveNseat, ...needs.domainMulti()], () => {
  runScenarios("multiplayer/tag-team-rules-domain", DOMAIN_VARIANTS);
});

describe("Tag team rule scenario list", () => {
  it("has unique ids, a source, a multi-seat format, the rules it proves and an outcome after an action", () => {
    expect(new Set(TAG_TEAM_RULES_SCENARIOS.map((s) => s.id)).size).toBe(TAG_TEAM_RULES_SCENARIOS.length);
    for (const s of TAG_TEAM_RULES_SCENARIOS) {
      expect(s.source, s.id).toBeTruthy();
      expect(seatCountFor(s.setup.format ?? "1v1"), s.id).toBeGreaterThan(2);
      expect(s.rules?.length, s.id).toBeGreaterThan(0);
      expect(outcomeAsserts(s.steps), s.id).toBe(true);
    }
  });

  it("covers both teams, a free for all control and every Domain variant", () => {
    const ids = TAG_TEAM_RULES_SCENARIOS.map((s) => s.id);
    expect(ids.filter((id) => id.includes("team-1")).length).toBeGreaterThanOrEqual(2);
    expect(ids.filter((id) => id.includes("ffa")).length).toBeGreaterThanOrEqual(2);
    expect(DOMAIN_VARIANTS).toHaveLength(TAG_TEAM_RULES_SCENARIOS.length);
  });
});
