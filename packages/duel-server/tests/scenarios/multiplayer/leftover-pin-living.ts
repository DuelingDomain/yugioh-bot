// A real Fusion Summon tests the global negation protection with a later activating seat.
import { activate, expectPrompt, faceDown, pickOpponent, yes, surrender, endTurn, expectEliminated, type Scenario, type Step } from "../../support/dsl.js";
import { defineScenarioWithFfaFirstDraw as defineScenario } from "./ffa-first-draw.js";
import { baseSetup, everySeat, SEATS, turnsBefore, type Format, type Seat } from "./seat-kit.js";
import { SOURCE } from "./nseat-scenarios.js";

const PIN = "Gold Pride - Pin Baller";
const ROLLER = "Gold Pride - Roller Baller";
const LEON = "Gold Pride - Leon";
const POLY = "Polymerization";
const STRIKE = "Solemn Strike";
const ELF = "Mystical Elf";

function pin(format: Format, lower: boolean, mixed = false, deadHigh = false): Scenario {
  const actor: Seat = format === "ffa3" ? "p2" : "p3";
  const lp = format === "tag" ? (lower ? 12000 : 17000) : (lower ? 6000 : 9000);
  const other: Seat = format === "tag" ? "p2" : "p1";
  const spec: Parameters<typeof everySeat>[1] = {};
  for (const seat of SEATS[format]) spec[seat] = { hand: seat === "p0" ? [] : [ELF], lp: format === "tag" ? (Number(seat.slice(1)) % 2 === 1 ? lp : 14500) : 8000 };
  spec[other] = { ...spec[other], hand: [ELF], monsters: [ELF] };
  spec.p0 = { hand: [], monsters: lower ? [] : [ELF], grave: [STRIKE], lp: format === "tag" ? 14500 : mixed ? 3500 : 6500 };
  spec[actor] = lower
    ? { hand: [ELF], lp, monsters: [PIN], spells: [ELF], grave: [POLY, ROLLER, LEON], extra: [] }
    : { hand: [ELF], lp, grave: [POLY, ROLLER, LEON, PIN], extra: [] };
  if (deadHigh) spec.p2 = { lp: 12000, hand: [], deckCount: 0 };
  return defineScenario({
    id: `leftover-pin-${format}-${mixed ? "middle-lp" : deadHigh ? "dead-high-lp" : lower ? "lower-control" : "higher-control"}`,
    title: `${format}: Pin Baller compares every living opposing LP pool`,
    source: `${SOURCE} [${format === "tag" ? "R-TAG-LP" : "R-FFA-OPP-ONE"}] a condition needs one living opposing LP pool that meets it`,
    rules: [format === "tag" ? "R-TAG-LP" : "R-FFA-OPP-ONE"],
    tags: ["multiplayer", "global-effect", "lp", format, "card:28497830"],
    setup: baseSetup(format, {
      p0: { ...(mixed ? { lp: 5000 } : {}), monsters: [ELF], spells: [faceDown(STRIKE)] },
      ...(deadHigh ? { p2: { lp: 12000 } } : {}),
      [other]: { monsters: [ELF] },
      [actor]: { lp, hand: [POLY, ROLLER, LEON], extra: [PIN] },
    }),
    steps: [
      ...(deadHigh ? [surrender("p2"), endTurn("p0"), expectEliminated(["p2"]), endTurn("p1")] : turnsBefore(format, actor)),
      activate(POLY, actor),
      { op: "select", sels: [ROLLER, LEON], by: actor },
      yes(actor),
      ...(format === "tag" ? [] : [pickOpponent("p0", actor)]),
      activate(STRIKE, "p0"),
      ...(lower ? [{ op: "select", sels: [{ card: ELF, owner: "p0" }], by: actor } satisfies Step] : []),
      expectPrompt({ by: actor, context: "action" }),
      everySeat(format, spec),
    ],
  });
}

export const LEFTOVER_PIN_LIVING_SCENARIOS: Scenario[] = [pin("ffa3", true, true), pin("ffa4", true, true), pin("tag", true), pin("ffa4", false, false, true)];
