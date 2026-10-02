import { activate, attack, defineScenario, faceDown, normalSummon, pickOpponent, type Scenario, type Step } from "../../support/dsl.js";
import { baseSetup, everySeat, SEATS, type Format, type Seat } from "./seat-kit.js";
import { SOURCE } from "./nseat-scenarios.js";
const TAI = "TA.I. Strike";
const OX = "Battle Ox";
const BLUE = "Blue-Eyes White Dragon";
const ELF = "Mystical Elf";
const GIVE = "Give and Take";
function tai(format: Format, changed: boolean): Scenario {
  const target: Seat = format === "ffa3" ? "p2" : "p3";
  const lp = format === "tag" ? 16000 : 8000;
  const spec: Parameters<typeof everySeat>[1] = {};
  for (const seat of SEATS[format]) spec[seat] = { hand: [] };
  spec.p0 = changed ? { hand: [], monsters: [OX, ELF], grave: [GIVE, BLUE, TAI] }
    : { hand: [], grave: [OX, TAI], lp: lp - 1700 };
  spec[target] = { hand: [], grave: changed ? [] : [BLUE], lp: lp - 3000 };
  return defineScenario({
    id: `tai-battle-controller-${format}-${target}-${changed ? "given-monster" : "own-monster"}`,
    title: `${format}: TA.I. Strike ${changed ? "destroys the Defense Position defender owned by p0" : "destroys both battle monsters"}; actual defender ${target} takes 3000 effect damage`,
    source: `${SOURCE} [R-COMMON-SEAT-STATE] damage follows the controller at the battle`,
    rules: ["R-COMMON-SEAT-STATE"], tags: ["multiplayer", "battle", format, "card:86449372"],
    setup: baseSetup(format, { p0: { monsters: [OX], hand: [TAI, ...(changed ? [ELF] : [])] },
      ...(changed ? { p0: { monsters: [OX], hand: [TAI, ELF], spells: [faceDown(GIVE)], grave: [BLUE] } } : { [target]: { monsters: [BLUE] } }) }),
    steps: [...(changed ? [normalSummon(ELF, "p0"), activate(GIVE, "p0"), pickOpponent(target, "p0"),
      { op: "select", sels: [{ card: ELF, owner: "p0" }], by: "p0" } as Step] : []),
      attack(OX, { card: BLUE, owner: target }, "p0"), activate(TAI, "p0"), everySeat(format, spec)],
  });
}
export const TAI_BATTLE_CONTROLLER_SCENARIOS: Scenario[] = (["ffa3", "ffa4", "tag"] as Format[]).flatMap((format) => [tai(format, false), tai(format, true)]);
