// True Draco Heritage (49430782): "(Ignition, 1/turn) draw cards equal to the number of card types (Monster, Spell, Trap) among the True Draco and True King
// cards sent from the field to the Graveyard this turn". The global check keeps ONE flag per new card type: it reads the type bits of the flag of the literal
// seat 0 (Duel.GetFlagEffectLabel(0,id)) and writes the new bits (Duel.SetFlagEffectLabel(0,id,bits)), and the holder draws Duel.GetFlagEffect(0,id) cards.
// The overlay keeps the memory at the first key visited by MPEachSeat and writes the label to every key. With p0 at LP 0, a literal-seat-0
// label read used to return nil for every monster: the holder drew one card per monster instead of one for the type "Monster".
//
// The holder (a seat of the turn) destroys the 2 monsters of the opponents (Ignis Heat and Majesty Maiden are both True Draco monsters) with Raigeki and
// draws with the Heritage: ONE card, because both are Monster cards.

import { activate, attack, changePhase, defineScenario, endTurn, expectEliminated, expectPrompt, surrender, yes, type Scenario, type Step } from "../../support/dsl.js";
import { SOURCE } from "./nseat-scenarios.js";
import { baseSetup, everySeat, label, SEATS, turnsBefore, type Format, type Seat } from "./seat-kit.js";

const HERITAGE = "True Draco Heritage";
const RAIGEKI = "Raigeki";
const IGNIS = "Ignis Heat, the True Dracowarrior";
const MAIDEN = "Majesty Maiden, the True Dracocaster";

function heritage(format: Format, holder: Seat, p0Out: boolean): Scenario {
  const seats = SEATS[format];
  const living = seats.filter((seat) => !(p0Out && seat === "p0"));
  const team = (seat: Seat) => Number(seat[1]) % 2;
  const foes = living.filter((seat) => (format === "tag" ? team(seat) !== team(holder) : seat !== holder));
  // The monsters of each opponent: 2 opponents have 1 each, a single living opponent has both.
  const monsters = (n: number): string[] => (foes.length === 1 ? [IGNIS, MAIDEN] : [n === 0 ? IGNIS : MAIDEN]);
  const setup: Record<string, object> = { [holder]: { hand: [RAIGEKI], spells: [HERITAGE] } };
  foes.forEach((seat, i) => { setup[seat] = { monsters: monsters(i) }; });
  const first = p0Out ? "p1" : "p0";
  // A seat that had its turn (p0 never: the first player does not draw, and p0 gave up) drew 1 card; the holder drew 1 more with the Heritage.
  const hand = (seat: Seat): number => (seat !== "p0" && living.includes(seat) && Number(seat[1]) <= Number(holder[1]) ? 1 : 0) + (seat === holder ? 1 : 0);
  const spec: Record<string, object> = {};
  for (const seat of seats) spec[seat] = { hand: { count: hand(seat) } };
  spec[holder] = { ...spec[holder], spells: [HERITAGE], grave: [RAIGEKI] };
  foes.forEach((seat, i) => { spec[seat] = { ...spec[seat], grave: monsters(i) }; });
  const steps: Step[] = [
    ...(p0Out ? [surrender("p0"), expectEliminated("p0")] : []),
    ...turnsBefore(format, holder, first),
    activate(RAIGEKI, holder),
    activate({ card: HERITAGE, from: "szone" }, holder),
    expectPrompt({ by: holder, context: "action" }),
  ];
  return defineScenario({
    id: `true-draco-heritage-${format}-${holder}${p0Out ? "-p0-out" : ""}-two-monsters-draw-one-card`,
    title: `${label(format)}${p0Out ? " (p0 gave up)" : ""}: ${holder} destroys 2 True Draco monsters with Raigeki and draws 1 card with the Heritage (one card type: Monster)`,
    source: `${SOURCE} [R-COMMON-SEAT-STATE] the label of the flag of a global check is kept for the living seats`,
    rules: ["R-COMMON-SEAT-STATE"],
    tags: ["multiplayer", "global-effect", "flag", format, "card:49430782"],
    setup: baseSetup(format, setup),
    steps: [...steps, everySeat(format, spec as never)],
  });
}

export const TRUE_DRACO_SCENARIOS: Scenario[] = [
  heritage("ffa3", "p1", false), heritage("ffa3", "p2", false), heritage("ffa3", "p1", true), heritage("ffa3", "p2", true),
  heritage("ffa4", "p3", false), heritage("ffa4", "p1", true), heritage("ffa4", "p3", true),
  heritage("tag", "p1", false), heritage("tag", "p3", false), heritage("tag", "p0", false),
];

function heritageAtLpZero(format: "ffa3" | "ffa4"): Scenario {
  return defineScenario({
    id: `true-draco-heritage-${format}-p0-lp-zero-two-monsters-draw-one-card`,
    title: `${label(format)}: p1 defeats p0 at LP 0, destroys two True Draco monsters and draws one card`,
    source: `${SOURCE} [R-COMMON-SEAT-STATE] the global flag memory skips a seat at LP 0`,
    rules: ["R-COMMON-SEAT-STATE", "R-FFA-ELIMINATION"],
    tags: ["multiplayer", "global-effect", "flag", format, "card:49430782"],
    setup: baseSetup(format, {
      p0: { lp: 100 },
      p1: { monsters: ["Mystical Elf"], hand: [RAIGEKI], spells: [HERITAGE] },
      p2: { monsters: [IGNIS, MAIDEN] },
      ...(format === "ffa4" ? { p3: { monsters: ["Blue-Eyes White Dragon"] } } : {}),
    }),
    steps: [
      endTurn("p0"), attack("Mystical Elf", "direct", "p1"), yes("p1"), changePhase("main2", "p1"), expectEliminated("p0"),
      activate(RAIGEKI, "p1"), activate({ card: HERITAGE, from: "szone" }, "p1"),
      expectPrompt({ by: "p1", context: "action" }),
      everySeat(format, {
        p0: { lp: 0, hand: [] },
        p1: { hand: { count: 2 }, monsters: ["Mystical Elf"], spells: [HERITAGE], grave: [RAIGEKI] },
        p2: { hand: [], grave: [IGNIS, MAIDEN] },
        ...(format === "ffa4" ? { p3: { hand: [], grave: ["Blue-Eyes White Dragon"] } } : {}),
      }),
    ],
  });
}
TRUE_DRACO_SCENARIOS.push(heritageAtLpZero("ffa3"), heritageAtLpZero("ffa4"));
