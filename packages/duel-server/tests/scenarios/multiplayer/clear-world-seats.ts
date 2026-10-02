// Clear World's EARTH, WATER and FIRE effects must run for seats 2 and 3. The stock script registers only players 0 and 1.
import { choose, defense, endTurn, normalSummon, type Scenario, type Step } from "../../support/dsl.js";
import { defineScenarioWithFfaFirstDraw as defineScenario } from "./ffa-first-draw.js";
import { baseLp, baseSetup, everySeat, SEATS, turnsBefore, type Format, type Seat } from "./seat-kit.js";
import { SOURCE } from "./nseat-scenarios.js";

const WORLD = "Clear World";
const ELF = "Mystical Elf";
const FIRE = "Flame Manipulator";
const WATER = "Aqua Madoor";
const EARTH = "Battle Ox";

function world(format: Format, attribute: "fire" | "water" | "earth"): Scenario {
  const holder: Seat = format === "ffa3" ? "p2" : "p3";
  const tag = format === "tag";
  const monster = attribute === "fire" ? FIRE : attribute === "water" ? WATER : EARTH;
  const lead = tag
    ? [endTurn("p0"), endTurn("p1"), choose("Pay 500 LP", holder), endTurn("p2")]
    : turnsBefore(format, holder);
  const spec: Parameters<typeof everySeat>[1] = {};
  for (const seat of SEATS[format]) spec[seat] = { hand: seat === "p0" ? [] : [ELF] };
  spec.p0 = { hand: [ELF] }; // The next turn starts after all End Phase effects finish.
  spec[holder] = {
    hand: [ELF],
    spells: [WORLD],
    ...(attribute === "earth" ? { grave: [EARTH] } : { monsters: [monster], ...(attribute === "water" ? { grave: [ELF] } : {}) }),
    lp: baseLp(format) - (tag ? 1000 : 500) - (attribute === "fire" ? 1000 : 0),
  };
  return defineScenario({
    id: `clear-world-seats-${format}-${holder}-${attribute}`,
    title: `${format}: Clear World applies its ${attribute.toUpperCase()} effect in the turn of ${holder}`,
    source: `${SOURCE} [R-COMMON-ALL-BOTH] Clear World affects every duelist`,
    rules: ["R-COMMON-ALL-BOTH"],
    tags: ["multiplayer", "global-effect", format, "card:33900648"],
    setup: baseSetup(format, {
      [holder]: attribute === "earth"
        ? { field: WORLD, monsters: [defense(EARTH)] }
        : { field: WORLD, hand: [monster, ...(attribute === "water" ? [ELF] : [])] },
    }),
    steps: [
      ...lead,
      ...(attribute === "earth" ? [] : [normalSummon(monster, holder)]),
      endTurn(holder),
      ...(attribute === "earth" ? [] : [choose(attribute === "fire" ? "Take 1000 damage" : "Discard 1 card", holder)]),
      ...(attribute === "water" ? [{ op: "select", sels: [{ card: ELF, seq: 0 }], by: holder } as Step] : []),
      choose("Pay 500 LP", holder),
      everySeat(format, spec),
    ],
  });
}

export const CLEAR_WORLD_SEAT_SCENARIOS: Scenario[] = [
  ...(["ffa3", "ffa4", "tag"] as Format[]).flatMap((format) => [world(format, "fire"), world(format, "water")]),
  world("ffa3", "earth"), world("ffa4", "earth"),
];
