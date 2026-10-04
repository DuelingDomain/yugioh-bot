import { describe, expect, it } from "vitest";
import { outcomeAsserts } from "../../../scripts/rule-coverage.js";
import type { Scenario } from "../../support/dsl.js";
import { expectPrompt, expectTurn, pass } from "../../support/dsl.js";
import { describeWithCores } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import * as globalFlags from "./global-flags.js";
import * as laplacian from "./laplacian.js";
import * as lpPairCards from "./lp-pair-cards.js";
import * as nseatTag from "./nseat-tag.js";
import * as opponentFieldEffectsMonsters from "./opponent-field-effects-monsters.js";
import * as opponentFieldEffectsSpells from "./opponent-field-effects-spells.js";
import * as opponentTurns from "./opponent-turns.js";
import * as procedures from "./procedures.js";
import * as r2Nochange from "./r2-nochange.js";
import * as ruleGaps from "./rule-gaps.js";
import * as summonProcedures from "./summon-procedures.js";
import * as tagCopies from "./tag-copies.js";
import * as tagPartnerCost from "./tag-partner-cost.js";
import { teamOneVariant } from "./team-variants.js";

// Team 1 as the acting team, part 2 (gap list: team 1 was unproven as the acting team in most Tag scenarios). team-variants.test.ts lists 15 scenarios; these
// are 103 more plus the Ojama Trio case below. Each one is a Tag scenario that team 0 plays alone (every step is of p0 or p2, one turn) and teamOneVariant swaps the teams, so
// p1 of team 1 acts in turn 2 and the picked or affected duelists are seats of team 0. Every variant keeps the assert of EVERY seat of its source. A Tag
// scenario that needs a hand of exact cards, a turn of another seat or the draw of the first turn is not listed: it needs a hand-made team 1 scenario.
// Same gate as the other live N-seat files: NSEAT_LIVE=1 and a multi core.

const MODULES: Record<string, unknown>[] = [globalFlags, laplacian, lpPairCards, nseatTag, opponentFieldEffectsMonsters, opponentFieldEffectsSpells, opponentTurns, procedures, r2Nochange, ruleGaps, summonProcedures, tagCopies, tagPartnerCost];
const POOL: Scenario[] = MODULES.flatMap((mod) => Object.values(mod).filter(Array.isArray).flat() as Scenario[]).filter((s) => typeof s?.id === "string" && Array.isArray(s.steps));

/** Tag scenarios of team 0 that also run with team 1 as the actor (not the 15 of team-variants.test.ts). */
export const TEAM_ONE_MORE_IDS: string[] = [
  "global-flags-tag-thunder-ball-of-p2-sees-a-battle-between-other-seats",
  "laplacian-tag-picked-opponent-with-a-hand-detach-3-all-3-effects",
  "laplacian-tag-picked-opponent-with-no-hand-detach-is-capped-at-2",
  "lp-pair-tag-button-p0-both-teams-reach-zero-draw",
  "lp-pair-tag-tri-and-guess-pick-from-opposing-team-team-recovers",
  "nseat-tag-partner-trap-does-not-answer",
  "opponent-field-effects-tag-alpha-summon-goes-to-an-opposing-member",
  "opponent-field-effects-tag-bamboo-scrap-goes-to-an-opposing-member",
  "opponent-field-effects-tag-branded-expulsion-goes-to-an-opposing-member",
  "opponent-field-effects-tag-cactus-fighter-goes-to-an-opposing-member",
  "opponent-field-effects-tag-chewbone-goes-to-an-opposing-member",
  "opponent-field-effects-tag-concours-de-cuisine-goes-to-an-opposing-member",
  "opponent-field-effects-tag-cubic-mandala-goes-to-an-opposing-member",
  "opponent-field-effects-tag-destiny-hero-dark-angel-goes-to-an-opposing-member",
  "opponent-field-effects-tag-destiny-hero-departed-goes-to-an-opposing-member",
  "opponent-field-effects-tag-diamond-duston-goes-to-an-opposing-member",
  "opponent-field-effects-tag-elemental-hero-necroid-shaman-goes-to-an-opposing-member",
  "opponent-field-effects-tag-flogos-goes-to-an-opposing-member",
  "opponent-field-effects-tag-foolish-revival-goes-to-an-opposing-member",
  "opponent-field-effects-tag-geistgrinder-golem-goes-to-an-opposing-member",
  "opponent-field-effects-tag-gimmick-puppet-fanatix-machinix-goes-to-an-opposing-member",
  "opponent-field-effects-tag-girsu-goes-to-an-opposing-member",
  "opponent-field-effects-tag-give-and-take-goes-to-an-opposing-member",
  "opponent-field-effects-tag-graydle-parasite-goes-to-an-opposing-member",
  "opponent-field-effects-tag-guts-of-steel-goes-to-an-opposing-member",
  "opponent-field-effects-tag-inferno-of-the-ashened-goes-to-an-opposing-member",
  "opponent-field-effects-tag-jurrac-spinos-goes-to-an-opposing-member",
  "opponent-field-effects-tag-ken-the-warrior-dragon-goes-to-an-opposing-member",
  "opponent-field-effects-tag-light-of-the-branded-goes-to-an-opposing-member",
  "opponent-field-effects-tag-lost-world-goes-to-an-opposing-member",
  "opponent-field-effects-tag-lunalight-serenade-dance-goes-to-an-opposing-member",
  "opponent-field-effects-tag-mansion-of-the-dreadful-dolls-goes-to-an-opposing-member",
  "opponent-field-effects-tag-mikanko-fire-dance-goes-to-an-opposing-member",
  "opponent-field-effects-tag-mimighoul-archfiend-goes-to-an-opposing-member",
  "opponent-field-effects-tag-mimighoul-armor-goes-to-an-opposing-member",
  "opponent-field-effects-tag-mimighoul-cerberus-goes-to-an-opposing-member",
  "opponent-field-effects-tag-mimighoul-dragon-goes-to-an-opposing-member",
  "opponent-field-effects-tag-mimighoul-fairy-goes-to-an-opposing-member",
  "opponent-field-effects-tag-mimighoul-flower-goes-to-an-opposing-member",
  "opponent-field-effects-tag-mithra-the-thunder-vassal-goes-to-an-opposing-member",
  "opponent-field-effects-tag-nightmare-archfiends-goes-to-an-opposing-member",
  "opponent-field-effects-tag-number-29-mannequin-cat-goes-to-an-opposing-member",
  "opponent-field-effects-tag-number-32-shark-drake-goes-to-an-opposing-member",
  "opponent-field-effects-tag-ojama-duo-goes-to-an-opposing-member",
  "opponent-field-effects-tag-ojama-trio-goes-to-an-opposing-member",
  "opponent-field-effects-tag-poisonous-viper-goes-to-an-opposing-member",
  "opponent-field-effects-tag-pyrite-knight-goes-to-an-opposing-member",
  "opponent-field-effects-tag-reverse-reuse-goes-to-an-opposing-member",
  "opponent-field-effects-tag-revival-gift-goes-to-an-opposing-member",
  "opponent-field-effects-tag-royal-knight-of-the-ice-barrier-goes-to-an-opposing-member",
  "opponent-field-effects-tag-scrap-golem-goes-to-an-opposing-member",
  "opponent-field-effects-tag-seed-of-flame-goes-to-an-opposing-member",
  "opponent-field-effects-tag-silent-wobby-goes-to-an-opposing-member",
  "opponent-field-effects-tag-spyral-double-agent-goes-to-an-opposing-member",
  "opponent-field-effects-tag-terrors-of-the-afterroot-goes-to-an-opposing-member",
  "opponent-field-effects-tag-terrors-of-the-overroot-goes-to-an-opposing-member",
  "opponent-field-effects-tag-trick-box-goes-to-an-opposing-member",
  "opponent-field-effects-tag-two-toads-with-one-sting-goes-to-an-opposing-member",
  "opponent-field-effects-tag-vampire-sucker-goes-to-an-opposing-member",
  "opponent-field-effects-tag-vodnika-goes-to-an-opposing-member",
  "opponent-field-effects-tag-wall-of-ivy-goes-to-an-opposing-member",
  "opponent-field-effects-tag-xyz-encore-goes-to-an-opposing-member",
  "procedures-tag-kaiju-no-tribute-kaiju-on-opposing-member",
  "procedures-tag-kaiju-partner-kaiju-gives-no-free-summon",
  "procedures-tag-kaiju-tribute-goes-to-opposing-member",
  "procedures-tag-lava-golem-one-opposing-member-accepted",
  "procedures-tag-ra-sphere-mode-one-opposing-member-accepted",
  "procedures-tag-ra-sphere-mode-picked-opposing-member",
  "procedures-tag-volcanic-queen-goes-to-tributed-field",
  "r2-nochange-tag-legacy-of-the-duelist-second-set-of-the-controller-p0-is-locked",
  "rule-gaps-dark-hole-all-tag",
  "rule-gaps-jinzo-of-partner-stops-trap-tag",
  "rule-gaps-jinzo-stops-every-opponent-tag",
  "summon-procedures-tag-alien-skull-tribute-goes-to-opposing-member",
  "summon-procedures-tag-dogoran-no-tribute-with-kaiju-on-opposing-member",
  "summon-procedures-tag-dogoran-tribute-goes-to-opposing-member",
  "summon-procedures-tag-fallen-of-argyros-opponent-field-goes-to-opposing-member",
  "summon-procedures-tag-fallen-of-argyros-own-field-asks-no-opponent",
  "summon-procedures-tag-fenrir-goes-to-opposing-member-not-partner",
  "summon-procedures-tag-gadarla-no-tribute-with-kaiju-on-opposing-member",
  "summon-procedures-tag-gadarla-tribute-goes-to-opposing-member",
  "summon-procedures-tag-grinder-golem-goes-to-opposing-member-not-partner",
  "summon-procedures-tag-hamp-own-field-tributes-own-monster",
  "summon-procedures-tag-hamp-tribute-goes-to-opposing-member",
  "summon-procedures-tag-jizukiru-no-tribute-with-kaiju-on-opposing-member",
  "summon-procedures-tag-jizukiru-tribute-goes-to-opposing-member",
  "summon-procedures-tag-jormungardr-goes-to-opposing-member-not-partner",
  "summon-procedures-tag-kumongous-no-tribute-with-kaiju-on-opposing-member",
  "summon-procedures-tag-kumongous-tribute-goes-to-opposing-member",
  "summon-procedures-tag-radian-no-tribute-with-kaiju-on-opposing-member",
  "summon-procedures-tag-radian-tribute-goes-to-opposing-member",
  "summon-procedures-tag-thunder-king-no-tribute-with-kaiju-on-opposing-member",
  "summon-procedures-tag-thunder-king-tribute-goes-to-opposing-member",
  "tag-copies-ultimate-sky-joined-count-passes-no-single-member-does",
  "tag-partner-cost-fusion-material-with-a-monster-of-the-partner",
  "tag-partner-cost-release-cost-never-offers-an-opponent-monster",
  "tag-partner-cost-release-cost-with-a-monster-of-the-partner",
  "tag-partner-cost-ritual-material-with-a-monster-of-the-partner",
  "tag-partner-cost-tribute-set-with-only-a-monster-of-the-partner",
  "tag-partner-cost-tribute-summon-with-a-full-own-zone-lists-the-own-monsters-only",
  "tag-partner-cost-tribute-summon-with-an-own-monster-and-a-monster-of-the-partner",
  "tag-partner-cost-tribute-summon-with-only-a-monster-of-the-partner",
  "tag-partner-cost-xyz-material-with-a-monster-of-the-partner",
];

const byId = new Map(POOL.map((s) => [s.id, s]));
const variants: Scenario[] = TEAM_ONE_MORE_IDS.map((id) => {
  const base = byId.get(id);
  if (!base) throw new Error(`Team 1 variant source scenario "${id}" does not exist`);
  return teamOneVariant(base);
});
// The Set Trap can answer before turn 2. Pass p1's windows in p0's Main and End Phases, then p1's Draw, Standby and Main Phases.
const ojamaSwap = teamOneVariant(byId.get("w9-tag-opponent-pick-and-place-refuse-wrong-answers")!);
const ojamaVariant: Scenario = { ...ojamaSwap, steps: [ojamaSwap.steps[0], ...Array.from({ length: 5 }, () => pass("p1")),
  expectTurn("p1", 2), expectPrompt({ by: "p1", context: "action" }), ...ojamaSwap.steps.slice(1)] };
variants.push(ojamaVariant);

describeWithCores("live Tag scenarios played by team 1 (part 2)", liveNseat, () => {
  runScenarios("multiplayer/team-variants-more", variants);
});

describe("team 1 variant list (part 2)", () => {
  it("has unique ids and every variant is a Tag scenario with rules, a source and an outcome after an action", () => {
    expect(new Set(variants.map((s) => s.id)).size).toBe(variants.length);
    expect(new Set(TEAM_ONE_MORE_IDS).size).toBe(TEAM_ONE_MORE_IDS.length);
    for (const s of variants) {
      expect(s.setup.format, s.id).toBe("tag");
      expect(s.source, s.id).toBeTruthy();
      expect(s.rules?.length, s.id).toBeGreaterThan(0);
      expect(outcomeAsserts(s.steps), s.id).toBe(true);
    }
  });

  it("swaps the teams: the cards of p0 and p1 trade places, as do the cards of p2 and p3", () => {
    for (const id of TEAM_ONE_MORE_IDS) {
      const base = byId.get(id)!;
      const variant = teamOneVariant(base);
      expect(variant.setup.p1, id).toEqual(base.setup.p0);
      expect(variant.setup.p0, id).toEqual(base.setup.p1);
      expect(variant.setup.p3, id).toEqual(base.setup.p2);
      expect(variant.setup.p2, id).toEqual(base.setup.p3);
      expect(variant.steps[0], id).toMatchObject({ op: "phase", to: "end", by: "p0" });
    }
  });

  it("only lists scenarios that team 0 plays alone (no step of p1 or p3) and that are in the first turn", () => {
    for (const id of TEAM_ONE_MORE_IDS) {
      const base = byId.get(id)!;
      for (const step of base.steps) {
        expect(["p0", "p2", undefined], `${id} ${step.op}`).toContain((step as { by?: string }).by);
        expect(step.op === "expectTurn" || (step.op === "phase" && (step as { to?: string }).to === "end"), `${id} ${step.op}`).toBe(false);
      }
    }
  });


});
