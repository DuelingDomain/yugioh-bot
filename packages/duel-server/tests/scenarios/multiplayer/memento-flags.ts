// Mementotlan Shleepy (50042011): "(Quick Effect): You can Special Summon this card from your hand if a monster that you controlled was
// destroyed by a card effect this turn". Mementotlan Fusion (66518509): the Fusion Summon may use "Memento" monsters of the own Graveyard as
// material if a monster that you controlled was destroyed by a card effect this turn. The stock global check of both cards loops over the
// players 0 and 1 and registers a flag for the player that controlled a destroyed monster (EVENT_DESTROY). The overlay was written for the
// real seats but read the previous controller, which is the first seat at that event for a monster of EVERY seat: a holder at any other seat
// got no flag. Both overlays now write the flag for the real controller seat of each destroyed monster.
//
// Every holder has drawn a Mystical Elf for its turn.
//
// The holder (a seat that is not p0) activates Offerings to the Doomed in its own turn on a Mystical Elf:
//   - Elf of the holder: Shleepy is offered and is Special Summoned (the holder controlled the destroyed monster);
//   - Elf of an opponent: Shleepy is not offered (the monster was not controlled by the holder);
//   - Tag, Elf of the partner: see the scenario.

import { activate, auto, choose, defineScenario, expectNotOffered, expectOffered, faceDown, select, zone, type Scenario } from "../../support/dsl.js";
import { SOURCE } from "./nseat-scenarios.js";
import { baseSetup, everySeat, label, PARTNER, SEATS, turnsBefore, type Format, type Seat } from "./seat-kit.js";

const SHLEEPY = "Mementotlan Shleepy";
const SHLEEPY_CODE = 50042011;
const OFFERINGS = "Offerings to the Doomed";
const ELF = "Mystical Elf";

type Whose = "own" | "opponent" | "partner";

function shleepy(format: Format, holder: Seat, whose: Whose): Scenario {
  const seats = SEATS[format];
  const target: Seat = whose === "own" ? holder : whose === "partner" ? PARTNER[holder] : seats[(seats.indexOf(holder) + 1) % seats.length]!;
  const offered = whose !== "opponent";
  return defineScenario({
    id: `mementotlan-shleepy-${format}-${holder}-elf-of-${whose === "opponent" ? target : whose}-destroyed-by-effect-${offered ? "offered" : "not-offered"}`,
    title: `${label(format)}: ${holder} destroys the Mystical Elf of ${target} with Offerings to the Doomed and ${offered ? "may Special Summon" : "is not offered"} Mementotlan Shleepy from its hand`,
    source: `${SOURCE} [R-COMMON-SEAT-STATE] the flag of a global check is set for the seat that controlled the destroyed monster`,
    rules: ["R-COMMON-SEAT-STATE"],
    tags: ["multiplayer", "global-effect", "flag", format, `card:${SHLEEPY_CODE}`],
    setup: baseSetup(format, {
      [holder]: { hand: [OFFERINGS, SHLEEPY] },
      ...(target === holder ? { [holder]: { hand: [OFFERINGS, SHLEEPY], monsters: [ELF] } } : { [target]: { monsters: [ELF] } }),
    }),
    steps: [
      ...turnsBefore(format, holder),
      activate(OFFERINGS, holder),
      auto(holder),
      ...(offered
        ? [expectOffered("activate", SHLEEPY, holder), activate(SHLEEPY, holder), auto(holder)]
        : [expectNotOffered("activate", SHLEEPY, holder)]),
      everySeat(format, {
        [holder]: { lp: format === "tag" ? 16000 : 8000, grave: [OFFERINGS, ...(target === holder ? [ELF] : [])], monsters: offered ? [SHLEEPY] : [], hand: offered ? [ELF] : [SHLEEPY, ELF] },
        ...(target !== holder ? { [target]: { grave: [ELF] } } : {}),
      } as never),
    ],
  });
}

const FUSION = "Mementotlan Fusion";
const FUSION_CODE = 66518509;
const TWIN_DRAGON = "Mementotlan Twin Dragon"; // Fusion: 2 "Memento" monsters
const MACE = "Mementotlan Mace";
const GOBLIN = "Mementotlan Goblin";

// The only other material for the Fusion Summon is the Goblin in the own Graveyard, which the card may use only after a monster that the
// holder controlled was destroyed by a card effect this turn (Offerings to the Doomed on a Mystical Elf).
function fusion(format: Format, holder: Seat, whose: Whose): Scenario {
  const seats = SEATS[format];
  const target: Seat = whose === "own" ? holder : whose === "partner" ? PARTNER[holder] : seats[(seats.indexOf(holder) + 1) % seats.length]!;
  const usable = whose !== "opponent";
  const base = format === "tag" ? 16000 : 8000;
  return defineScenario({
    id: `mementotlan-fusion-${format}-${holder}-elf-of-${whose === "opponent" ? target : whose}-destroyed-by-effect-${usable ? "graveyard-material" : "no-graveyard-material"}`,
    title: `${label(format)}: ${holder} destroys the Mystical Elf of ${target} with Offerings to the Doomed and ${usable ? "Fusion Summons Mementotlan Twin Dragon with the Mace and the Goblin from its Graveyard" : "cannot Activate Mementotlan Fusion (the Goblin of the Graveyard is not a material)"}`,
    source: `${SOURCE} [R-COMMON-SEAT-STATE] the flag of a global check is set for the seat that controlled the destroyed monster`,
    rules: ["R-COMMON-SEAT-STATE"],
    tags: ["multiplayer", "global-effect", "flag", format, `card:${FUSION_CODE}`],
    setup: baseSetup(format, {
      [holder]: { hand: [OFFERINGS, FUSION], monsters: target === holder ? [MACE, ELF] : [MACE], grave: [GOBLIN], extra: [TWIN_DRAGON] },
      ...(target !== holder ? { [target]: { monsters: [ELF] } } : {}),
    }),
    steps: [
      ...turnsBefore(format, holder),
      activate(OFFERINGS, holder),
      zone(holder, "s0", holder),
      choose(ELF, holder),
      ...(usable
        ? [expectOffered("activate", FUSION, holder), activate(FUSION, holder), select(MACE, GOBLIN)]
        : [expectNotOffered("activate", FUSION, holder)]),
      everySeat(format, {
        [holder]: usable
          ? { lp: base, monsters: [TWIN_DRAGON], grave: [OFFERINGS, FUSION, MACE, ...(target === holder ? [ELF] : [])], hand: [ELF], extra: [] }
          : { lp: base, monsters: [MACE], grave: [OFFERINGS, GOBLIN], hand: [FUSION, ELF] },
        ...(target !== holder ? { [target]: { grave: [ELF] } } : {}),
      } as never),
    ],
  });
}

// Dark Hole destroys monsters at p1 and p2 in the same EVENT_DESTROY group.
// Both holders must receive their flag and use their own card after that event.
function simultaneousShleepy(): Scenario {
  return defineScenario({
    id: "mementotlan-shleepy-ffa3-two-seats-destroyed-in-one-event",
    title: "FFA3: Dark Hole destroys an Elf at p1 and p2; both holders summon Shleepy",
    source: `${SOURCE} [R-COMMON-SEAT-STATE] one destruction event writes the flag for each affected seat`,
    rules: ["R-COMMON-SEAT-STATE"],
    tags: ["multiplayer", "global-effect", "flag", "ffa3", `card:${SHLEEPY_CODE}`],
    setup: baseSetup("ffa3", {
      p0: { hand: ["Dark Hole"] },
      p1: { monsters: [ELF], hand: [SHLEEPY] },
      p2: { monsters: [ELF], hand: [SHLEEPY] },
    }),
    steps: [
      activate("Dark Hole", "p0"),
      expectOffered("activate", SHLEEPY, "p1"), activate(SHLEEPY, "p1"),
      expectOffered("activate", SHLEEPY, "p2"), activate(SHLEEPY, "p2"),
      everySeat("ffa3", {
        p0: { hand: [], grave: ["Dark Hole"] },
        p1: { hand: [], grave: [ELF], monsters: [SHLEEPY] },
        p2: { hand: [], grave: [ELF], monsters: [SHLEEPY] },
      }),
    ],
  });
}

function simultaneousFusion(): Scenario {
  return defineScenario({
    id: "mementotlan-fusion-ffa3-two-seats-destroyed-in-one-event",
    title: "FFA3: Dark Hole destroys an Elf at p1 and p2; both holders use a Goblin from their own Graveyard to Fusion Summon",
    source: `${SOURCE} [R-COMMON-SEAT-STATE] one destruction event writes the flag for each affected seat`,
    rules: ["R-COMMON-SEAT-STATE"],
    tags: ["multiplayer", "global-effect", "flag", "ffa3", `card:${FUSION_CODE}`],
    setup: baseSetup("ffa3", {
      p1: { hand: ["Dark Hole", FUSION, MACE], monsters: [ELF], grave: [GOBLIN], extra: [TWIN_DRAGON] },
      p2: { hand: [MACE], spells: [faceDown(FUSION)], monsters: [ELF], grave: [GOBLIN], extra: [TWIN_DRAGON] },
    }),
    steps: [
      ...turnsBefore("ffa3", "p1"),
      activate("Dark Hole", "p1"),
      expectOffered("activate", FUSION, "p1"), activate(FUSION, "p1"),
      expectOffered("activate", FUSION, "p2"), activate(FUSION, "p2"),
      select({ card: MACE, owner: "p2" }, { card: GOBLIN, owner: "p2" }),
      select({ card: MACE, owner: "p1" }, { card: GOBLIN, owner: "p1" }),
      everySeat("ffa3", {
        p0: { hand: [] },
        p1: { hand: [ELF], monsters: [TWIN_DRAGON], grave: ["Dark Hole", FUSION, MACE, ELF], extra: [] },
        p2: { hand: [], monsters: [TWIN_DRAGON], grave: [FUSION, MACE, ELF], extra: [] },
      }),
    ],
  });
}

export const MEMENTO_FLAG_SCENARIOS: Scenario[] = [
  simultaneousShleepy(), simultaneousFusion(),
  shleepy("ffa3", "p1", "own"), shleepy("ffa3", "p2", "own"), shleepy("ffa4", "p3", "own"), shleepy("tag", "p1", "own"), shleepy("tag", "p3", "own"),
  shleepy("ffa3", "p1", "opponent"), shleepy("ffa3", "p2", "opponent"), shleepy("ffa4", "p3", "opponent"), shleepy("tag", "p1", "opponent"), shleepy("tag", "p3", "opponent"),
  shleepy("tag", "p1", "partner"), shleepy("tag", "p3", "partner"),
  fusion("ffa3", "p1", "own"), fusion("ffa3", "p2", "own"), fusion("ffa4", "p3", "own"), fusion("tag", "p1", "own"), fusion("tag", "p3", "partner"),
  fusion("ffa3", "p1", "opponent"), fusion("ffa4", "p3", "opponent"), fusion("tag", "p1", "opponent"),
];
