import { describe, expect, it } from "vitest";
import { seatCountFor } from "@yugidraft/shared/duels";
import { readManifest } from "../../../scripts/generate-multi-scripts.js";
import { outcomeAsserts } from "../../../scripts/rule-coverage.js";
import type { Scenario } from "../../support/dsl.js";
import { describeWithCores, needs } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import { ATTACK_DIRECT_SCENARIOS } from "./attack-direct.js";
import { COMPARE_EXTRA_SCENARIOS } from "./compare-extra.js";
import { COMPARE_SCENARIOS } from "./compare.js";
import { domainVariant } from "./domain-variants.js";
import { EACH_OPPONENT_SCENARIOS } from "./each-opponent.js";
import { GAPS_R1_SCENARIOS } from "./gaps-r1.js";
import { LATE_CARD_SCENARIOS } from "./late-cards.js";
import { R2_CHECK_SCENARIOS } from "./r2-checks.js";
import { SEATS_R2_SCENARIOS } from "./seats-r2.js";
import { SEATS_SCENARIOS } from "./seats.js";
import { TAG_KIND_SCENARIOS } from "./tag-kinds.js";
import { VALUE_LIMIT_SCENARIOS } from "./value-limits.js";

// Review B (test proof quality): the overlay cards were proven only in Standard duels with 3 and 4 seats. These are the same scenarios in a real
// Domain duel (mode "domain", a Deck Master for each seat, the Domain multi core of apply-domain-multi), with the same steps and the same end
// state of every seat. At least one scenario of each overlay kind (whole, expr, trig, hand, chooser, seat) runs in FFA3 and in Tag, and the
// groups that the seat rules and the 4-seat tables need run in FFA4 too.
// Same gate as the other live N-seat scenario files (NSEAT_LIVE=1), plus the Domain multi core (DOMAIN_MULTI_WASM, else the current build).

const POOL: Scenario[] = [
  ...COMPARE_SCENARIOS, ...COMPARE_EXTRA_SCENARIOS, ...GAPS_R1_SCENARIOS, ...SEATS_SCENARIOS, ...SEATS_R2_SCENARIOS, ...VALUE_LIMIT_SCENARIOS,
  ...LATE_CARD_SCENARIOS, ...ATTACK_DIRECT_SCENARIOS, ...EACH_OPPONENT_SCENARIOS, ...R2_CHECK_SCENARIOS, ...TAG_KIND_SCENARIOS,
];

/** The scenarios that run again in a Domain duel, by overlay kind of the manifest. */
export const DOMAIN_VARIANT_IDS: Record<string, string[]> = {
  whole: ["compare-ffa3-mandragora-special-summon-procedure", "compare-tag-mandragora-joined-opposing-field-no-pick"],
  expr: ["compare-extra-ffa3-guan-yun-destroy-picked-opponent", "compare-extra-tag-kuribabylon-joined-graveyard-passes", "compare-ffa4-pineapple-blast-three-opponents"],
  trig: ["compare-ffa3-trigger-compare-pick-and-destroy", "tag-kinds-core-blast-trigger-joined-field-picked-duelist"],
  chooser: ["compare-ffa3-dark-coffin-pick-and-choice", "tag-kinds-dark-coffin-picked-duelist-chooses"],
  "hand R1": [
    "gaps-r1-ffa3-dark-scheme-the-picked-opponent-discards-1-and-negates", "gaps-r1-tag-dark-scheme-the-picked-opponent-discards-1-and-negates",
    "gaps-r1-ffa3-jormungandr-every-duelist-draws-and-attaches-one-card", "gaps-r1-tag-jormungandr-every-duelist-draws-and-attaches-one-card",
    "seats-r1-ffa4-rigorous-reaver-living-duelists-discard-1-defeated-seat-unchanged", "seats-r1-tag-rain-of-mercy-every-duelist-gains-lp",
  ],
  "hand R2": [
    "seats-r2-ffa3-droll-and-lock-bird-answers-a-search-of-seat-2", "seats-r2-tag-droll-and-lock-bird-of-team-1-answers-a-search-of-team-0",
    "seats-r2-ffa3-fatal-abacus-damages-each-real-controller-of-the-destroyed-monsters", "seats-r2-tag-fatal-abacus-damages-the-team-of-each-real-controller",
    "r2-checks-ffa3-tualatin-offered-only-to-the-seat-whose-monsters-were-all-destroyed", "r2-checks-tag-tualatin-offered-to-p3-of-team-1-whose-monsters-were-all-destroyed",
  ],
  "hand chooser": [
    "compare-ffa3-grave-of-enkindling-every-living-duelist-with-a-monster-revives-one", "compare-tag-grave-of-enkindling-each-opposing-duelist-revives-for-itself",
    "each-opponent-ffa3-shallow-grave-own-graveyards", "each-opponent-ffa4-shallow-grave-own-graveyards", "each-opponent-tag-shallow-grave-own-graveyards",
  ],
  "hand attack": [
    "attack-direct-ffa3-counter-gate-offered-when-the-attack-goes-to-p0", "attack-direct-ffa3-counter-gate-not-offered-when-the-attack-goes-to-p2",
    "attack-direct-tag-counter-gate-offered-to-the-partner",
  ],
  seat: [
    "seats-r2-ffa3-life-absorbing-machine-recovers-half-of-the-cost-of-its-own-seat", "seats-r2-tag-life-absorbing-machine-recovers-half-of-the-cost-of-the-team",
    "seats-r2-ffa3-final-geas-of-seat-2-after-a-level-7-monster-of-each-seat-was-destroyed", "seats-r2-tag-final-geas-of-team-1-after-a-level-7-monster-of-each-team-was-destroyed",
    "value-limits-ffa3-gozen-match-each-seat-is-limited-by-its-own-field", "value-limits-ffa4-gozen-match-each-seat-is-limited-by-its-own-field",
    "value-limits-tag-rivalry-of-warlords-each-seat-is-limited-by-its-own-field",
  ],
  fix: ["late-ffa3-dice-jar-owner-wins-picked-opponent-takes-the-damage", "late-tag-dice-jar-owner-wins-picked-opponent-takes-the-damage"],
};

const byId = new Map(POOL.map((s) => [s.id, s]));
const variants: Scenario[] = Object.values(DOMAIN_VARIANT_IDS).flat().map((id) => {
  const base = byId.get(id);
  if (!base) throw new Error(`Domain variant source scenario "${id}" does not exist`);
  return domainVariant(base);
});

describeWithCores("live Domain duel scenarios (overlay cards with 3 and 4 duelists, a Deck Master for each seat)", [liveNseat, ...needs.domainMulti()], () => {
  runScenarios("multiplayer/domain-variants", variants);
});

describe("domain variant list", () => {
  it("has unique ids and every variant is a Domain scenario with a Deck Master for each seat, a source, rules and an outcome after an action", () => {
    expect(new Set(variants.map((s) => s.id)).size).toBe(variants.length);
    for (const s of variants) {
      const format = s.setup.format ?? "1v1";
      expect(s.setup.mode, s.id).toBe("domain");
      expect(seatCountFor(format), s.id).toBeGreaterThan(2);
      for (const seat of (["p0", "p1", "p2", "p3"] as const).slice(0, seatCountFor(format))) expect(s.setup[seat]?.deckMaster, `${s.id} ${seat}`).toBeTruthy();
      expect(s.source, s.id).toBeTruthy();
      expect(s.rules?.length, s.id).toBeGreaterThan(0);
      expect(outcomeAsserts(s.steps), s.id).toBe(true);
    }
  });

  it("gives every Deck Master of one scenario a different card that the scenario does not name", () => {
    for (const s of variants) {
      const base = byId.get(s.id.replace(/-domain$/, ""))!;
      const text = JSON.stringify([base.setup, base.steps]);
      const masters = (["p0", "p1", "p2", "p3"] as const).map((seat) => s.setup[seat]?.deckMaster).filter((card): card is string => typeof card === "string");
      expect(new Set(masters).size, s.id).toBe(masters.length);
      for (const master of masters) expect(text.includes(master), `${s.id}: ${master}`).toBe(false);
    }
  });

  it("runs at least one scenario of each overlay kind in FFA3 and in Tag", () => {
    const kinds = new Map(readManifest().cards.map((card) => [card.code, card.kind]));
    const seen = new Set<string>();
    for (const s of variants) {
      for (const tag of s.tags) {
        const kind = tag.startsWith("card:") ? kinds.get(Number(tag.slice(5))) : undefined;
        if (kind) seen.add(`${kind} ${s.setup.format}`);
      }
    }
    for (const kind of ["whole", "expr", "trig", "hand", "chooser", "seat"]) {
      for (const format of ["ffa3", "tag"]) expect(seen.has(`${kind} ${format}`), `${kind} in ${format}`).toBe(true);
    }
  });
});
