import { describe, expect, it } from "vitest";
import { outcomeAsserts } from "../../../scripts/rule-coverage.js";
import type { Scenario } from "../../support/dsl.js";
import { expectTurn, pass } from "../../support/dsl.js";
import { describeWithCores } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import { COMPARE_EXTRA_SCENARIOS } from "./compare-extra.js";
import { COMPARE_SCENARIOS } from "./compare.js";
import { GAPS_R1_SCENARIOS } from "./gaps-r1.js";
import { LATE_CARD_SCENARIOS } from "./late-cards.js";
import { SEATS_SCENARIOS } from "./seats.js";
import { TAG_KIND_SCENARIOS } from "./tag-kinds.js";
import { teamOneVariant } from "./team-variants.js";

// Review B (test proof quality): the Tag scenarios were played by team 0 only (p0 acts, p1 and p3 are the picked duelists). These are the same
// scenarios with the two teams swapped, so the activator is p1 of team 1 and the picked duelist is a seat of team 0. 5dba811 fixed a bug that only
// a team 1 seat showed. Only the scenarios that are symmetric under the swap are listed (one turn of the actor); see team-variants.ts.
// Same gate as the other live N-seat files: NSEAT_LIVE=1 and a multi core.

const POOL: Scenario[] = [
  ...COMPARE_SCENARIOS, ...COMPARE_EXTRA_SCENARIOS, ...GAPS_R1_SCENARIOS, ...SEATS_SCENARIOS, ...LATE_CARD_SCENARIOS, ...TAG_KIND_SCENARIOS,
];

/** Tag scenarios of team 0 that also run with team 1 as the actor. */
export const TEAM_ONE_IDS: string[] = [
  "compare-extra-tag-kuribabylon-joined-graveyard-fails",
  "compare-extra-tag-kuribabylon-joined-graveyard-passes",
  "compare-tag-mandragora-joined-opposing-field-equal-not-offered",
  "compare-tag-mandragora-joined-opposing-field-no-pick",
  "compare-tag-pineapple-blast-joined-field-picked-duelist-chooses",
  "gaps-r1-tag-dangerous-machine-die-2-discard-of-the-picked-opponent",
  "gaps-r1-tag-dangerous-machine-die-4-draw-of-the-picked-opponent",
  "gaps-r1-tag-dangerous-machine-die-5-destroy-of-an-opponent-monster",
  "gaps-r1-tag-gagigobyte-random-discard-of-the-picked-opponent-then-everyone-draws",
  "gaps-r1-tag-shamoji-soldier-every-duelist-gains-1000-lp",
  "late-tag-cup-of-ace-tails-the-picked-opponent-draws-2",
  "late-tag-foolish-revival-target-in-the-grave-of-the-opponent-that-is-not-picked",
  "seats-r1-tag-rain-of-mercy-every-duelist-gains-lp",
  "tag-kinds-core-blast-trigger-joined-field-picked-duelist",
  "tag-kinds-dark-coffin-picked-duelist-chooses",
];

const byId = new Map(POOL.map((s) => [s.id, s]));
const variants: Scenario[] = TEAM_ONE_IDS.map((id) => {
  const base = byId.get(id);
  if (!base) throw new Error(`Team 1 variant source scenario "${id}" does not exist`);
  const variant = teamOneVariant(base);
  if (id === "late-tag-foolish-revival-target-in-the-grave-of-the-opponent-that-is-not-picked") {
    // R-TAG-ORDER / R-FFA-FIRST-DRAW: the expected p1 draw needs the start of turn 2.
    // Foolish Revival is offered as p0 exits Main Phase 1 and in p0's End Phase.
    // Pass both response windows before p1 acts.
    variant.steps.splice(1, 0, pass("p1"), pass("p1"), expectTurn("p1", 2));
  }
  return variant;
});

describeWithCores("live Tag scenarios played by team 1", liveNseat, () => {
  runScenarios("multiplayer/team-variants", variants);
});

describe("team 1 variant list", () => {
  it("has unique ids and every variant is a Tag scenario with rules, a source and an outcome after an action", () => {
    expect(new Set(variants.map((s) => s.id)).size).toBe(variants.length);
    expect(new Set(TEAM_ONE_IDS).size).toBe(TEAM_ONE_IDS.length);
    for (const s of variants) {
      expect(s.setup.format, s.id).toBe("tag");
      expect(s.source, s.id).toBeTruthy();
      expect(s.rules?.length, s.id).toBeGreaterThan(0);
      expect(outcomeAsserts(s.steps), s.id).toBe(true);
    }
  });

  it("swaps the teams: the cards of p0 and p1 trade places, as do the cards of p2 and p3, and the steps of p0 are now steps of p1", () => {
    for (const id of TEAM_ONE_IDS) {
      const base = byId.get(id)!;
      const variant = teamOneVariant(base);
      expect(variant.setup.p1, id).toEqual(base.setup.p0);
      expect(variant.setup.p0, id).toEqual(base.setup.p1);
      expect(variant.setup.p3, id).toEqual(base.setup.p2);
      expect(variant.setup.p2, id).toEqual(base.setup.p3);
      const actors = (s: Scenario) => s.steps.map((step) => ("by" in step ? step.by : undefined)).filter(Boolean);
      expect(actors(variant).filter((seat) => seat === "p1").length, id).toBeGreaterThanOrEqual(actors(base).filter((seat) => seat === "p0").length);
      expect(variant.steps[0], id).toMatchObject({ op: "phase", to: "end", by: "p0" });
    }
  });

  it("only lists scenarios that team 0 plays alone (no step of p1 or p3)", () => {
    for (const id of TEAM_ONE_IDS) {
      const base = byId.get(id)!;
      const acting = base.steps.filter((step) => ["activate", "normalSummon", "set", "specialSummon", "attack", "choose", "yes", "no", "select"].includes(step.op));
      for (const step of acting) expect(["p0", "p2", undefined], `${id} ${step.op}`).toContain((step as { by?: string }).by);
    }
  });
});
