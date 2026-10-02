// A real opponent Trap summons a monster. Cheatah must go to that monster's actual field.
import { activate, expectPrompt, faceDown, normalSummon, type Scenario } from "../../support/dsl.js";
import { defineScenarioWithFfaFirstDraw as defineScenario } from "./ffa-first-draw.js";
import { baseSetup, everySeat, SEATS, type Format, type Seat } from "./seat-kit.js";
import { SOURCE } from "./nseat-scenarios.js";
const CARD = "Fallin' Cheatah";
const ELF = "Mystical Elf";
const OX = "Battle Ox";
const CALL = "Call of the Haunted";
export const CHEATAH_CONTROLLER_SCENARIOS: Scenario[] = (["ffa3", "ffa4", "tag"] as Format[]).map((format) => {
  const target: Seat = format === "ffa3" ? "p2" : "p3";
  const spec: Parameters<typeof everySeat>[1] = {};
  for (const seat of SEATS[format]) spec[seat] = { hand: [] };
  spec.p0 = { hand: [], monsters: [OX] };
  spec[target] = { hand: [], monsters: [ELF, CARD], spells: [CALL] };
  return defineScenario({
    id: `cheatah-controller-${format}-${target}`,
    title: `${format}: ${target} revives Mystical Elf with Call of the Haunted; Cheatah goes to ${target}`,
    source: `${SOURCE} [R-COMMON-SEP-FIELDS] give control to the summoned monster's real controller`,
    rules: ["R-COMMON-SEP-FIELDS"], tags: ["multiplayer", "controller", format, "card:59011257"],
    setup: baseSetup(format, { p0: { monsters: [CARD], hand: [OX] }, [target]: { spells: [faceDown(CALL)], grave: [ELF] } }),
    steps: [normalSummon(OX, "p0"), activate(CALL, target), expectPrompt({ by: "p0", context: "action" }), everySeat(format, spec)],
  });
});
