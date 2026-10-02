// A battle kill enables the Quick Fusion effect of Favorite HERO Flame Wingman at a later seat.
// The global battle flag must reach that seat in FFA and its team in Tag.

import { activate, attack, expectNotOffered, expectOffered, pickOpponent, select, type Scenario, type DuelistExpect } from "../../support/dsl.js";
import { defineScenarioWithFfaFirstDraw as defineScenario } from "./ffa-first-draw.js";
import { SOURCE } from "./nseat-scenarios.js";
import { baseLp, baseSetup, everySeat, label, SEATS, turnsBefore, type Format, type Seat } from "./seat-kit.js";

const FAVORITE = "Favorite HERO Flame Wingman";
const FUSION = "Elemental HERO Flame Wingman";
const AVIAN = "Elemental HERO Avian";
const BURSTINATRIX = "Elemental HERO Burstinatrix";
const DRAGON = "Blue-Eyes White Dragon";
const ELF = "Mystical Elf";

function flameWingman(format: Format): Scenario {
  const holder: Seat = format === "ffa3" ? "p2" : "p3";
  const state: Partial<Record<Seat, DuelistExpect>> = {};
  for (const seat of SEATS[format]) state[seat] = { hand: seat === "p0" ? [] : [ELF], extra: [] };
  state.p0 = { ...state.p0, lp: baseLp(format) - 2200, grave: [ELF] };
  state[holder] = { ...state[holder], monsters: [FAVORITE, DRAGON, FUSION], grave: [AVIAN, BURSTINATRIX] };
  return defineScenario({
    id: `flame-wingman-${format}-late-seat-fusion-after-battle-kill`,
    title: `${label(format)}: ${holder} may Fusion Summon with Favorite HERO Flame Wingman only after a battle kill`,
    source: `${SOURCE} [R-COMMON-SEAT-STATE] the global battle flag reaches every living seat or Tag team`,
    rules: ["R-COMMON-SEAT-STATE"],
    tags: ["multiplayer", "global-effect", "flag", format, "card:13243124"],
    setup: baseSetup(format, {
      p0: { monsters: [ELF] },
      [holder]: { monsters: [FAVORITE, DRAGON], hand: [AVIAN, BURSTINATRIX], extra: [FUSION] },
    }),
    steps: [
      ...turnsBefore(format, holder),
      expectNotOffered("activate", FAVORITE, holder),
      attack(DRAGON, { card: ELF, owner: "p0" }, holder),
      expectOffered("activate", FAVORITE, holder),
      activate(FAVORITE, holder),
      ...(format === "tag" ? [pickOpponent("p0", holder)] : []),
      select(AVIAN, BURSTINATRIX),
      everySeat(format, state),
    ],
  });
}

export const FLAME_WINGMAN_SCENARIOS: Scenario[] = ["ffa3", "ffa4", "tag"].map((format) => flameWingman(format as Format));
