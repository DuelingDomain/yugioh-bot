// The equipped monster fixes the recipient of the next Standby Phase damage.
import { activate, changePosition, endTurn, expectPrompt, yes, type Scenario } from "../../support/dsl.js";
import { defineScenarioWithFfaFirstDraw as defineScenario } from "./ffa-first-draw.js";
import { baseSetup, everySeat, SEATS, type Format, type Seat } from "./seat-kit.js";
import { SOURCE } from "./nseat-scenarios.js";
const CARD = 'Worm Millidith';
const ELF = "Mystical Elf";
const OX = "Battle Ox";
export const WORM_CONTROLLER_SCENARIOS: Scenario[] = (["ffa3", "ffa4", "tag"] as Format[]).map((format) => {
  const target: Seat = format === "ffa3" ? "p2" : "p3";
  const spec: Parameters<typeof everySeat>[1] = {};
  for (const seat of SEATS[format]) spec[seat] = { hand: [] };
  spec.p0 = { hand: [], spells: [CARD] };
  spec.p1 = { hand: [ELF], monsters: [OX] };
  spec[target] = { hand: [], monsters: [ELF], lp: (format === "tag" ? 16000 : 8000) - 400 };
  return defineScenario({
    id: `worm-controller-${format}-${target}`,
    title: `${format}: ${CARD} damages the equipped monster's controller ${target}`,
    source: `${SOURCE} [R-COMMON-SEAT-STATE] the card controller fixes the damage recipient`,
    rules: ["R-COMMON-SEAT-STATE"], tags: ["multiplayer", "controller", format, "card:71315423"],
    setup: baseSetup(format, { p0: { monsters: [{ card: CARD, pos: "set" }] }, p1: { monsters: [OX] }, [target]: { monsters: [ELF] } }),
    steps: [changePosition(CARD, "p0"), yes("p0"), { op: "select", sels: [{ card: ELF, owner: target }], by: "p0" }, endTurn("p0"),
      expectPrompt({ by: "p1", context: "action" }), everySeat(format, spec)],
  });
});
