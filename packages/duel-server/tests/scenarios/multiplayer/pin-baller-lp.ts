// A real Fusion Summon tests the global negation protection with a later activating seat.
import { activate, expectPrompt, faceDown, pickOpponent, yes, type Scenario, type Step } from "../../support/dsl.js";
import { defineScenarioWithFfaFirstDraw as defineScenario } from "./ffa-first-draw.js";
import { baseSetup, everySeat, SEATS, turnsBefore, type Format, type Seat } from "./seat-kit.js";
import { SOURCE } from "./nseat-scenarios.js";

const PIN = "Gold Pride - Pin Baller";
const ROLLER = "Gold Pride - Roller Baller";
const LEON = "Gold Pride - Leon";
const POLY = "Polymerization";
const STRIKE = "Solemn Strike";
const ELF = "Mystical Elf";

function pin(format: Format, lower: boolean, mixed = false): Scenario {
  const actor: Seat = format === "ffa3" ? "p2" : "p3";
  const lp = format === "tag" ? (lower ? 12000 : 17000) : (lower ? 6000 : 9000);
  const other: Seat = format === "tag" ? "p2" : "p1";
  const protectedEffect = lower && !mixed;
  const spec: Parameters<typeof everySeat>[1] = {};
  for (const seat of SEATS[format]) spec[seat] = { hand: seat === "p0" ? [] : [ELF] };
  spec[other] = { hand: [ELF], monsters: [ELF] };
  spec.p0 = { hand: [], monsters: protectedEffect ? [] : [ELF], grave: [STRIKE], lp: format === "tag" ? 14500 : 6500 };
  if (mixed) spec[other]!.lp = 3000;
  spec[actor] = protectedEffect
    ? { hand: [ELF], lp, monsters: [PIN], spells: [ELF], grave: [POLY, ROLLER, LEON], extra: [] }
    : { hand: [ELF], lp, grave: [POLY, ROLLER, LEON, PIN], extra: [] };
  return defineScenario({
    id: `pin-baller-lp-${format}-${actor}-${mixed ? "mixed-negated" : lower ? "lower-protected" : "higher-negated"}`,
    title: `${format}: ${actor}'s Fusion Summoned Pin Baller ${protectedEffect ? "has lower LP than all opponents after Solemn Strike's cost" : "does not have lower LP than all opponents and can be negated"}`,
    source: `${SOURCE} [R-COMMON-OPP-PICK] [R-FFA-LP-COMPARE] owner 2026-10-21: lower than every living opponent in FFA`,
    rules: ["R-COMMON-OPP-PICK", "R-FFA-LP-COMPARE"],
    tags: ["multiplayer", "global-effect", "lp", format, "card:28497830"],
    setup: baseSetup(format, {
      p0: { monsters: [ELF], spells: [faceDown(STRIKE)] },
      [other]: { monsters: [ELF], ...(mixed ? { lp: 3000 } : {}) },
      [actor]: { lp, hand: [POLY, ROLLER, LEON], extra: [PIN] },
    }),
    steps: [
      ...turnsBefore(format, actor),
      activate(POLY, actor),
      { op: "select", sels: [ROLLER, LEON], by: actor },
      yes(actor),
      ...(format === "tag" ? [] : [pickOpponent("p0", actor)]),
      activate(STRIKE, "p0"),
      ...(lower && format === "tag" ? [{ op: "select", sels: [{ card: ELF, owner: "p0" }], by: actor } satisfies Step] : []),
      expectPrompt({ by: actor, context: "action" }),
      everySeat(format, spec),
    ],
  });
}

export const PIN_BALLER_LP_SCENARIOS: Scenario[] = (["ffa3", "ffa4", "tag"] as Format[]).flatMap((format) => [pin(format, true), pin(format, false)]);
PIN_BALLER_LP_SCENARIOS.push(pin("ffa3", true, true), pin("ffa4", true, true));
