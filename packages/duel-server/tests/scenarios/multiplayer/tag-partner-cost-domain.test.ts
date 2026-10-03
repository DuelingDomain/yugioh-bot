import { describe, expect, it } from "vitest";
import { seatCountFor } from "@yugidraft/shared/duels";
import { outcomeAsserts } from "../../../scripts/rule-coverage.js";
import { describeWithCores, needs } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import { domainVariant } from "./domain-variants.js";
import { TAG_PARTNER_COST_SCENARIOS } from "./tag-partner-cost.js";

// R-TAG-PARTNER-COST (patch 0061) in a real Domain duel: every scenario of tag-partner-cost.ts runs again with mode "domain" and a Deck Master for
// each seat, on the Domain multi core, with the same steps and the same end state of every seat. This checks that the Domain layer and patch
// 0061 work together for Tribute Summon, Tribute Set, the release cost, and Fusion, Ritual, Xyz and Link material, in Tag, FFA3 and FFA4.
const variants = TAG_PARTNER_COST_SCENARIOS.map(domainVariant);

describeWithCores("live Domain duel Tag partner cost scenarios (a Deck Master for each seat)", [liveNseat, ...needs.domainMulti()], () => {
  runScenarios("multiplayer/tag-partner-cost-domain", variants);
});

describe("Domain Tag partner cost scenario list", () => {
  it("has one Domain variant for each scenario, with unique ids, a Deck Master for each seat, the rule, an outcome after an action and a card tag", () => {
    expect(variants.length).toBe(TAG_PARTNER_COST_SCENARIOS.length);
    expect(new Set(variants.map((s) => s.id)).size).toBe(variants.length);
    for (const s of variants) {
      const format = s.setup.format ?? "1v1";
      expect(s.setup.mode, s.id).toBe("domain");
      expect(seatCountFor(format), s.id).toBeGreaterThan(2);
      for (const seat of (["p0", "p1", "p2", "p3"] as const).slice(0, seatCountFor(format))) expect(s.setup[seat]?.deckMaster, `${s.id} ${seat}`).toBeTruthy();
      expect(s.rules, s.id).toContain("R-TAG-PARTNER-COST");
      expect(outcomeAsserts(s.steps), s.id).toBe(true);
      expect(s.tags.some((tag) => /^card:\d+$/.test(tag)), s.id).toBe(true);
    }
  });
});
