// Review 5d. The private Review Self Attack Spell registers EFFECT_SELF_ATTACK for its own side.
// No official card in the installed database supplies that effect. All attacks and target prompts are real.
// tag-self-attack-review.test.ts adds card 95200104 to a private copy of the engine data.
import { activate, changePhase, choose, expectPickOptions, select, type DuelistExpect, type OptionRef, type Scenario } from "../../support/dsl.js";
import { defineScenarioWithFfaFirstDraw as defineScenario } from "./ffa-first-draw.js";
import { SOURCE } from "./nseat-scenarios.js";
import { baseSetup, everySeat, PARTNER, SEATS, type Format, type Seat } from "./seat-kit.js";
import { teamOneVariant } from "./team-variants.js";

export const SELF_ATTACK_REVIEW_CARD = 95200104;
const SPELL = SELF_ATTACK_REVIEW_CARD;
const DRAGON = "Blue-Eyes White Dragon";
const OX = "Battle Ox";
const FANG = "Silver Fang";
const AXE = "Axe Raider";
const GUARDIAN = "Celtic Guardian";

function targetAttack(format: Format, target: Seat, enabled: boolean): Scenario {
  const setup = baseSetup(format, {
    p0: { deck: ["Ookazi"], hand: enabled ? [SPELL] : [], monsters: [DRAGON, OX] },
    p1: { monsters: [AXE] }, p2: { monsters: [FANG] },
    ...(format === "ffa3" ? {} : { p3: { monsters: [GUARDIAN] } }),
  });
  const targetCard = target === "p0" ? OX : target === "p1" ? AXE : FANG;
  const state: Partial<Record<Seat, DuelistExpect>> = Object.fromEntries(SEATS[format].map((seat) => [seat, { hand: [], monsters: setup[seat]?.monsters ?? [] }]));
  state.p0 = { ...state.p0, spells: enabled ? [SPELL] : [] };
  state[target] = { ...state[target], monsters: target === "p0" ? [DRAGON] : [], grave: [targetCard], lp: (format === "tag" ? 16000 : 8000) - (target === "p0" ? 1300 : target === "p1" ? 1300 : 1800) };
  const ownTargets: OptionRef[] = enabled ? [{ card: OX, seat: "p0" }, ...(format === "tag" ? [{ card: FANG, seat: PARTNER.p0 }] : [])] : [];
  const otherTargets = SEATS[format].filter((seat) => seat !== "p0" && !(format === "tag" && seat === PARTNER.p0)).map((seat) => ({ card: seat === "p1" ? AXE : seat === "p2" ? FANG : GUARDIAN, seat }));
  return defineScenario({
    id: `tag-self-attack-review-${format}-${enabled ? "effect" : "no-effect"}-${target === "p0" ? "own" : format === "tag" && target === "p2" ? "partner" : "opponent"}-target`,
    title: `${format}: ${enabled ? "Review Self Attack permits" : "an ordinary attack permits"} Blue-Eyes to destroy the monster of ${target}`,
    source: `${SOURCE} [R-TAG-SHARED-CARDS]`,
    rules: ["R-TAG-SHARED-CARDS"],
    tags: ["multiplayer", format, "battle", "self-attack", `card:${SPELL}`],
    setup,
    steps: [
      ...(enabled ? [activate(SPELL, "p0")] : []),
      changePhase("battle", "p0"), choose("attack:0", "p0"),
      expectPickOptions([...ownTargets, ...otherTargets], "p0"),
      select({ card: targetCard, owner: target, from: "mzone" }),
      everySeat(format, state),
    ],
  });
}

const partner = targetAttack("tag", "p2", true);
export const TAG_SELF_ATTACK_REVIEW_SCENARIOS: Scenario[] = [
  partner, teamOneVariant(partner),
  ...(["tag", "ffa3", "ffa4"] as Format[]).flatMap((format) => [
    targetAttack(format, "p0", true), targetAttack(format, "p1", true), targetAttack(format, "p1", false),
  ]),
];
