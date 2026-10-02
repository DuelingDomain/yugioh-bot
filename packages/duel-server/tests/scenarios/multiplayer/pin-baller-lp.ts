// A real Fusion Summon tests the global negation protection with a later activating seat.
import { activate, defineScenario, expectPrompt, faceDown, pickOpponent, yes, type Scenario } from "../../support/dsl.js";
import { baseSetup, everySeat, SEATS, turnsBefore, type Format, type Seat } from "./seat-kit.js";
import { SOURCE } from "./nseat-scenarios.js";

const PIN = "Gold Pride - Pin Baller";
const ROLLER = "Gold Pride - Roller Baller";
const LEON = "Gold Pride - Leon";
const POLY = "Polymerization";
const STRIKE = "Solemn Strike";
const ELF = "Mystical Elf";

function pin(format: Format, lower: boolean): Scenario {
  const actor: Seat = format === "ffa3" ? "p2" : "p3";
  const lp = format === "tag" ? (lower ? 12000 : 17000) : (lower ? 6000 : 9000);
  const other: Seat = format === "tag" ? "p2" : "p1";
  const spec: Parameters<typeof everySeat>[1] = {};
  for (const seat of SEATS[format]) spec[seat] = { hand: seat === "p0" ? [] : [ELF] };
  spec[other] = { hand: [ELF], monsters: [ELF] };
  spec.p0 = { hand: [], monsters: lower ? [] : [ELF], grave: [STRIKE], lp: format === "tag" ? 14500 : 6500 };
  spec[actor] = lower
    ? { hand: [ELF], lp, monsters: [PIN], spells: [ELF], grave: [POLY, ROLLER, LEON], extra: [] }
    : { hand: [ELF], lp, grave: [POLY, ROLLER, LEON, PIN], extra: [] };
  return defineScenario({
    id: `pin-baller-lp-${format}-${actor}-${lower ? "lower-protected" : "higher-negated"}`,
    title: `${format}: ${actor}'s Fusion Summoned Pin Baller ${lower ? "keeps lower LP after Solemn Strike's cost and equips p0's monster" : "has higher LP and p0 negates it with Solemn Strike"}`,
    source: `${SOURCE} [R-COMMON-OPP-PICK] compare LP with the picked opponent`,
    rules: ["R-COMMON-OPP-PICK"],
    tags: ["multiplayer", "global-effect", "lp", format, "card:28497830"],
    setup: baseSetup(format, {
      p0: { monsters: [ELF], spells: [faceDown(STRIKE)] },
      [other]: { monsters: [ELF] },
      [actor]: { lp, hand: [POLY, ROLLER, LEON], extra: [PIN] },
    }),
    steps: [
      ...turnsBefore(format, actor),
      activate(POLY, actor),
      { op: "select", sels: [ROLLER, LEON], by: actor },
      yes(actor),
      ...(format === "tag" ? [] : [pickOpponent("p0", actor)]),
      activate(STRIKE, "p0"),
      ...(lower ? [{ op: "select", sels: [{ card: ELF, owner: "p0" }], by: actor } as const] : []),
      expectPrompt({ by: actor, context: "action" }),
      everySeat(format, spec),
    ],
  });
}

export const PIN_BALLER_LP_SCENARIOS: Scenario[] = (["ffa3", "ffa4", "tag"] as Format[]).flatMap((format) => [pin(format, true), pin(format, false)]);
