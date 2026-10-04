import { activate, attack, changePhase, choose, no, yes, zone, type Scenario } from "../../support/dsl.js";
import { defineScenarioWithFfaFirstDraw as defineScenario } from "./ffa-first-draw.js";
import { baseSetup, everySeat, SEATS, type Format, type Seat } from "./seat-kit.js";
import { SOURCE } from "./nseat-scenarios.js";
const FIEND = "Arcana Force XV - The Fiend";
const ELF = "Mystical Elf";
const BLUE = "Blue-Eyes White Dragon";
const BARRIER = "Light Barrier";
const REBORN = "Monster Reborn";
export const ARCANA_TARGET_CONTROLLER_SCENARIOS: Scenario[] = (["ffa3", "ffa4", "tag"] as Format[]).map((format) => {
  const target: Seat = format === "ffa3" ? "p2" : "p3";
  const spec: Parameters<typeof everySeat>[1] = {};
  for (const seat of SEATS[format]) spec[seat] = { hand: [] };
  spec.p0 = { hand: [], spells: [BARRIER], monsters: [FIEND], grave: [REBORN] };
  spec.p1 = { hand: [], monsters: [BLUE] };
  spec[target] = { hand: [], grave: [ELF], lp: (format === "tag" ? 16000 : 8000) - 500 };
  return defineScenario({
    id: `arcana-target-controller-${format}-${target}`,
    title: `${format}: Arcana Force gets Heads, attacks p1, destroys ${target}'s Elf and damages ${target}; p0 declines the attack replay`,
    source: `${SOURCE} [R-COMMON-SEP-FIELDS] the effect damage follows the target, not the battle opponent`,
    rules: ["R-COMMON-SEP-FIELDS"], tags: ["multiplayer", "controller", format, "card:59712426"],
    setup: baseSetup(format, { p0: { hand: [BARRIER, REBORN], grave: [FIEND] }, p1: { monsters: [BLUE] }, [target]: { monsters: [ELF] } }),
    steps: [activate(BARRIER, "p0"), activate(REBORN, "p0"),
      zone("p0", "s0", "p0"), zone("p0", "m0", "p0"),
      { op: "position", pos: "atk", by: "p0" }, choose("Heads", "p0"), attack(FIEND, { card: BLUE, owner: "p1" }, "p0"),
      yes("p0"), { op: "select", sels: [{ card: ELF, owner: target }], by: "p0" }, no("p0"),
      changePhase("main2", "p0"), everySeat(format, spec)],
  });
});
