// A battle kill enables Penetration Fusion at a later seat. The summoned monster uses its added Tribute effect.
// The next battle proves the 500 ATK increase through the damage and the destroyed opposing monster.

import { activate, attack, expectNotOffered, expectOffered, pickOpponent, select, type DuelistExpect, type Scenario } from "../../support/dsl.js";
import { defineScenarioWithFfaFirstDraw as defineScenario } from "./ffa-first-draw.js";
import { SOURCE } from "./nseat-scenarios.js";
import { baseLp, baseSetup, everySeat, label, SEATS, turnsBefore, type Format, type Seat } from "./seat-kit.js";

const SPELL = "Penetration Fusion";
const FUSION = "Gaia the Dragon Champion";
const GAIA = "Gaia The Fierce Knight";
const CURSE = "Curse of Dragon";
const DRAGON = "Blue-Eyes White Dragon";
const AXE = "Axe Raider";
const OX = "Battle Ox";
const ELF = "Mystical Elf";

function penetrationFusion(format: Format): Scenario {
  const holder: Seat = format === "ffa3" ? "p2" : "p3";
  const state: Partial<Record<Seat, DuelistExpect>> = {};
  for (const seat of SEATS[format]) state[seat] = { hand: seat === "p0" ? [] : [ELF], extra: [] };
  state.p0 = { ...state.p0, lp: baseLp(format) - 2700, grave: [ELF, OX] };
  state[holder] = { ...state[holder], monsters: [DRAGON, AXE], grave: [SPELL, GAIA, CURSE, FUSION] };
  return defineScenario({
    id: `penetration-fusion-${format}-late-seat-fusion-and-tribute-after-battle-kill`,
    title: `${label(format)}: ${holder} Fusion Summons after a battle kill and Tributes the Fusion to make Axe Raider gain 500 ATK`,
    source: `${SOURCE} [R-COMMON-SEAT-STATE] the global battle flag reaches every living seat or Tag team`,
    rules: ["R-COMMON-SEAT-STATE"],
    tags: ["multiplayer", "global-effect", "flag", format, "card:8778267"],
    setup: baseSetup(format, {
      p0: { monsters: [ELF, OX] },
      [holder]: { monsters: [DRAGON, AXE], hand: [SPELL, GAIA, CURSE], extra: [FUSION] },
    }),
    steps: [
      ...turnsBefore(format, holder),
      expectNotOffered("activate", SPELL, holder),
      attack(DRAGON, { card: ELF, owner: "p0", from: "mzone" }, holder),
      expectOffered("activate", SPELL, holder),
      activate(SPELL, holder),
      ...(format === "tag" ? [pickOpponent("p0", holder)] : []),
      select(GAIA, CURSE),
      activate(FUSION, holder),
      select(AXE),
      attack(AXE, { card: OX, owner: "p0" }, holder),
      everySeat(format, state),
    ],
  });
}

export const PENETRATION_FUSION_SCENARIOS: Scenario[] = ["ffa3", "ffa4", "tag"].map((format) => penetrationFusion(format as Format));
