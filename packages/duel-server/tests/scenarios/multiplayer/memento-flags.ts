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

import { activate, auto, choose, defineScenario, expectNotOffered, expectOffered, select, zone, type Scenario } from "../../support/dsl.js";
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

export const MEMENTO_FLAG_SCENARIOS: Scenario[] = [
  shleepy("ffa3", "p1", "own"), shleepy("ffa3", "p2", "own"), shleepy("ffa4", "p3", "own"), shleepy("tag", "p1", "own"), shleepy("tag", "p3", "own"),
  shleepy("ffa3", "p1", "opponent"), shleepy("ffa3", "p2", "opponent"), shleepy("ffa4", "p3", "opponent"), shleepy("tag", "p1", "opponent"), shleepy("tag", "p3", "opponent"),
  shleepy("tag", "p1", "partner"), shleepy("tag", "p3", "partner"),
  fusion("ffa3", "p1", "own"), fusion("ffa3", "p2", "own"), fusion("ffa4", "p3", "own"), fusion("tag", "p1", "own"), fusion("tag", "p3", "partner"),
  fusion("ffa3", "p1", "opponent"), fusion("ffa4", "p3", "opponent"), fusion("tag", "p1", "opponent"),
];
