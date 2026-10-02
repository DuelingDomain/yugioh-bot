// Dark Time Wizard destroys a monster. A later seat can then Tribute a monster for Red-Eyes Black Dragon Exceed.
// This proves the global destruction flag and the real summon and optional summon prompts.

import { activate, choose, defineScenario, expectNotOffered, expectOffered, pickOpponent, select, specialSummon, yes, zone, type DuelistExpect, type Scenario } from "../../support/dsl.js";
import { SOURCE } from "./nseat-scenarios.js";
import { baseLp, baseSetup, everySeat, label, SEATS, turnsBefore, type Format, type Seat } from "./seat-kit.js";

const EXCEED = 17242022;
const WIZARD = 40235813;
const AXE = "Axe Raider";
const OX = "Battle Ox";
const DRAGON = "Blue-Eyes White Dragon";
const ELF = "Mystical Elf";

function redEyesExceed(format: Format): Scenario {
  const holder: Seat = format === "ffa3" ? "p2" : "p3";
  const state: Partial<Record<Seat, DuelistExpect>> = {};
  for (const seat of SEATS[format]) state[seat] = { hand: seat === "p0" ? [] : [ELF], extra: [] };
  state.p0 = { ...state.p0, grave: [ELF], lp: baseLp(format) - 400 };
  state[holder] = { ...state[holder], monsters: [EXCEED, DRAGON, OX], grave: [WIZARD, AXE] };
  return defineScenario({
    id: `red-eyes-exceed-${format}-late-seat-tribute-after-dark-time-wizard`,
    title: `${label(format)}: ${holder} summons Red-Eyes Black Dragon Exceed after Dark Time Wizard destroys a monster`,
    source: `${SOURCE} [R-COMMON-SEAT-STATE] the global destruction flag reaches every living seat or Tag team`,
    rules: ["R-COMMON-SEAT-STATE"],
    tags: ["multiplayer", "global-effect", "flag", format, "card:17242022"],
    seed: ["5", "6", "7", "8"], // The first coin is tails on the real generator.
    setup: baseSetup(format, {
      p0: { monsters: [ELF] },
      [holder]: { hand: [WIZARD, DRAGON], monsters: [AXE, OX], extra: [EXCEED] },
    }),
    steps: [
      ...turnsBefore(format, holder),
      expectNotOffered("specialSummon", EXCEED, holder),
      activate(WIZARD, holder),
      zone(holder, "s0", holder),
      ...(format !== "tag" ? [pickOpponent("p0", holder)] : []),
      choose("Tails", holder),
      expectOffered("specialSummon", EXCEED, holder),
      specialSummon(EXCEED, holder),
      select(AXE),
      yes(holder),
      select(DRAGON),
      everySeat(format, state),
    ],
  });
}

export const RED_EYES_EXCEED_SCENARIOS: Scenario[] = ["ffa3", "ffa4", "tag"].map((format) => redEyesExceed(format as Format));
