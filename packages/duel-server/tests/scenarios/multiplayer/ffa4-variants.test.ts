import { describe, expect, it } from "vitest";
import { outcomeAsserts } from "../../../scripts/rule-coverage.js";
import type { Scenario } from "../../support/dsl.js";
import { describeWithCores } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import { COMPARE_EXTRA_SEAT_SCENARIOS } from "./compare-extra-seats.js";
import { COMPARE_EXTRA_SCENARIOS } from "./compare-extra.js";
import { COMPARE_GAP_SCENARIOS } from "./compare-gaps.js";
import { COMPARE_SCENARIOS } from "./compare.js";
import { ffa4Variant, type FfaFourOptions } from "./ffa4-variants.js";
import { LATE_CARD_SCENARIOS } from "./late-cards.js";
import { PROCEDURE_SCENARIOS } from "./procedures.js";
import { TABLE_CARD_SCENARIOS } from "./table-cards.js";

// Review B (cards area): the FFA3 scenarios of these cards, run again with a 4th duelist (p3) that must stay untouched. The cards
// were proven at FFA3 only. Only the scenarios that p3 does not change are listed (p3 is not asked, does not draw and is not the picked seat);
// see ffa4-variants.ts. Same gate as the other live N-seat files: NSEAT_LIVE=1 and a multi core.

const POOL: Scenario[] = [
  ...COMPARE_SCENARIOS, ...COMPARE_EXTRA_SCENARIOS, ...COMPARE_EXTRA_SEAT_SCENARIOS, ...COMPARE_GAP_SCENARIOS,
  ...LATE_CARD_SCENARIOS, ...PROCEDURE_SCENARIOS, ...TABLE_CARD_SCENARIOS,
];

/** FFA3 scenarios that also run at FFA4. */
export const FFA4_IDS: string[] = [
  // Mystic Mine
  "compare-ffa3-mystic-mine-destroys-itself-on-any-equal-opponent",
  "compare-gaps-ffa3-mystic-mine-no-opponent-has-more-nobody-is-locked",
  "compare-gaps-ffa3-mystic-mine-only-the-opponent-with-more-monsters-is-locked",
  // Ultimate Sky
  "compare-ffa3-activation-condition-one-opponent",
  "compare-ffa3-chain-of-three-each-link-its-own-opponent",
  // Three in One, Kaiser Colosseum
  "compare-gaps-ffa3-three-in-one-one-opponent-has-more",
  "compare-gaps-ffa3-three-in-one-only-the-turn-player-counts",
  "compare-gaps-ffa3-three-in-one-sum-passes-no-single-opponent",
  "compare-gaps-ffa3-kaiser-colosseum-limit-counts-the-summoner-only",
  // Volcanic Queen, Ra
  "procedures-ffa3-volcanic-queen-goes-to-tributed-field",
  "procedures-ffa3-ra-sphere-mode-one-opponent-accepted",
  "procedures-ffa3-ra-sphere-mode-picked-opponent",
  "procedures-ffa3-ra-sphere-mode-split-rejected",
  // Dark Coffin, Thundercross, Grave of Enkindling, Phantom of Yubel
  "compare-ffa3-dark-coffin-pick-and-choice",
  "compare-ffa3-thundercross-banished-one-opponent",
  "compare-ffa3-thundercross-picked-opponent-special-summons-from-the-deck",
  "compare-ffa3-grave-of-enkindling-every-living-duelist-with-a-monster-revives-one",
  "compare-extra-ffa3-phantom-of-yubel-offered-for-each-opponent-effect",
  "compare-extra-seats-ffa3-phantom-of-yubel-controller-destroys-its-own-yubel-p1-activates",
  "compare-extra-seats-ffa3-phantom-of-yubel-controller-destroys-its-own-yubel-p2-activates",
  // Pudica, Brain Jacker, Summoning Curse, Appointer of the Red Lotus
  "compare-extra-ffa3-pudica-banish-picked-opponent",
  "table-ffa3-pudica-standby-return-goes-to-the-controller-of-the-banished-monster",
  "table-ffa3-brain-jacker-only-the-owner-of-the-stolen-monster-gains-the-lp-in-its-own-standby-phase",
  "table-ffa3-summoning-curse-two-opponents-summon-at-once-both-banish",
  "r3-ffa3-appointer-of-the-red-lotus-card-returns-during-the-declared-opponents-next-end-phase",
];

/**
 * p3 holds a card where that makes the scenario stronger: the Appointer banishes a card from the hand of ONE picked opponent, so p3 (with a hand card)
 * is a legal pick that p0 does not choose. Pudica needs a Special Summoned monster, so p3 (with none) is NOT offered in the pick: the exact seat list proves it.
 */
const OPTIONS: Record<string, FfaFourOptions> = {
  "r3-ffa3-appointer-of-the-red-lotus-card-returns-during-the-declared-opponents-next-end-phase": { p3: { hand: ["Giant Rat"] }, keep: { hand: ["Giant Rat"] } },
  "compare-extra-ffa3-pudica-banish-picked-opponent": { pickP3: false },
  "table-ffa3-pudica-standby-return-goes-to-the-controller-of-the-banished-monster": { pickP3: false },
};

const byId = new Map(POOL.map((s) => [s.id, s]));
const variants: Scenario[] = FFA4_IDS.map((id) => {
  const base = byId.get(id);
  if (!base) throw new Error(`FFA4 variant source scenario "${id}" does not exist`);
  return ffa4Variant(base, OPTIONS[id]);
});

describeWithCores("live FFA3 scenarios run again at FFA4", liveNseat, () => {
  runScenarios("multiplayer/ffa4-variants", variants);
});

describe("FFA4 variant list", () => {
  it("has unique ids and every variant is an FFA4 scenario with rules, a source and an outcome after an action", () => {
    expect(new Set(variants.map((s) => s.id)).size).toBe(variants.length);
    expect(new Set(FFA4_IDS).size).toBe(FFA4_IDS.length);
    for (const s of variants) {
      expect(s.setup.format, s.id).toBe("ffa4");
      expect(s.source, s.id).toBeTruthy();
      expect(s.rules?.length, s.id).toBeGreaterThan(0);
      expect(outcomeAsserts(s.steps), s.id).toBe(true);
    }
  });

  it("adds p3 with no cards and asserts p3 in every expected board", () => {
    for (const id of FFA4_IDS) {
      const base = byId.get(id)!;
      const variant = ffa4Variant(base, OPTIONS[id]);
      expect(variant.setup.p3, id).toEqual(OPTIONS[id]?.p3 ?? {});
      for (const step of variant.steps) if (step.op === "expectBoard") expect(step.board.p3, id).toBeTruthy();
    }
  });
});
