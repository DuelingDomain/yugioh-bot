// Real tribute events after p0 reaches LP 0. The shared global memory must use a key that still has flags.
import { pickOpponent, activate, attack, auto, changePhase, endTurn, expectEliminated, normalSummon, select, yes, xyz, type Scenario } from "../../support/dsl.js";
import { defineScenarioWithFfaFirstDraw as defineScenario } from "./ffa-first-draw.js";
import { SOURCE } from "./nseat-scenarios.js";
import { baseSetup, everySeat } from "./seat-kit.js";

const ELF = "Mystical Elf";
const BEWD = "Blue-Eyes White Dragon";
const COWBOY = "Gagaga Cowboy";
const CLOWN = "Clown Crew Matinee Operatics";
const PANTHER = "Swiftwind Panther Warrior";
const GATE = "Monster Gate";

function clown(format: "ffa3" | "ffa4"): Scenario {
  return defineScenario({
    id: `clown-crew-${format}-p0-lp-zero-two-xyz-tributes-draw-one`,
    title: `${format}: p2 draws one card for two Tributed Xyz monsters after p0 reaches LP 0`,
    source: `${SOURCE} [R-COMMON-SEAT-STATE] global labels reach every key after an LP loss`,
    rules: ["R-COMMON-SEAT-STATE", "R-FFA-ELIMINATION"],
    tags: ["multiplayer", "global-effect", "flag", format, "card:57847269"],
    setup: baseSetup(format, {
      p0: { lp: 100 }, p1: { monsters: [ELF] },
      p2: { monsters: [xyz(COWBOY, []), xyz(COWBOY, [])], hand: [BEWD], spells: [CLOWN] },
      ...(format === "ffa4" ? { p3: { monsters: [BEWD] } } : {}),
    }),
    steps: [
      endTurn("p0"), attack(ELF, "direct", "p1"), pickOpponent("p0", "p1"), changePhase("main2", "p1"), expectEliminated("p0"), endTurn("p1"),
      normalSummon(BEWD, "p2"), select({ card: COWBOY, seq: 0 }, { card: COWBOY, seq: 1 }),
      endTurn("p2"), yes("p2"),
      everySeat(format, {
        p0: { lp: 0, hand: [] },
        p1: { monsters: [ELF], hand: { count: format === "ffa3" ? 2 : 1 } },
        p2: { monsters: [BEWD], spells: [CLOWN], grave: [COWBOY, COWBOY], hand: { count: 2 } },
        ...(format === "ffa4" ? { p3: { monsters: [BEWD], hand: { count: 1 } } } : {}),
      }),
    ],
  });
}

function panther(format: "ffa3" | "ffa4"): Scenario {
  return defineScenario({
    id: `swiftwind-panther-${format}-p0-lp-zero-two-tribute-events-one-flag`,
    title: `${format}: two tribute events leave one Panther flag per living seat after p0 reaches LP 0`,
    source: `${SOURCE} [R-COMMON-SEAT-STATE] the global guard reads the first remaining key`,
    rules: ["R-COMMON-SEAT-STATE", "R-FFA-ELIMINATION"],
    tags: ["multiplayer", "global-effect", "flag", format, "card:77482666"],
    setup: baseSetup(format, {
      p0: { lp: 100 }, p1: { monsters: [ELF, ELF, PANTHER], hand: [GATE, GATE] },
      p2: { monsters: [BEWD] }, ...(format === "ffa4" ? { p3: { monsters: [BEWD] } } : {}),
    }),
    steps: [
      endTurn("p0"), attack({ card: ELF, nth: 0 }, "direct", "p1"), pickOpponent("p0", "p1"), changePhase("main2", "p1"), expectEliminated("p0"),
      activate(GATE, "p1"), ...(format === "ffa4" ? [pickOpponent("p2", "p1")] : []), select({ card: ELF, nth: 0 }), auto("p1"),
      activate(GATE, "p1"), ...(format === "ffa4" ? [pickOpponent("p2", "p1")] : []), select({ card: ELF, nth: 0 }), auto("p1"),
      everySeat(format, {
        p0: { lp: 0, hand: [] },
        p1: { monsters: { include: [ELF], count: 3 }, grave: [ELF, ELF, GATE, GATE], hand: { count: 1 } },
        p2: { monsters: [BEWD], hand: [] }, ...(format === "ffa4" ? { p3: { monsters: [BEWD], hand: [] } } : {}),
      }),
    ],
  });
}

export const GLOBAL_FLAG_MEMORY_SCENARIOS = [clown("ffa3"), clown("ffa4"), panther("ffa3"), panther("ffa4")];
