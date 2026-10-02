// Hama keeps the battle damage of each seat (team in Tag). Copies at two seats must not share the flag of the first holder.
import { attack, changePhase, expectPrompt, pickOpponent, yes, type Scenario } from "../../support/dsl.js";
import { defineScenarioWithFfaFirstDraw as defineScenario } from "./ffa-first-draw.js";
import { baseLp, baseSetup, everySeat, SEATS, turnsBefore, type Format, type Seat } from "./seat-kit.js";
import { SOURCE } from "./nseat-scenarios.js";

const HAMA = "Battlewasp - Hama the Conquering Bow";
const TWINBOW = "Battlewasp - Twinbow the Attacker";
const BLUE_EYES = "Blue-Eyes White Dragon";

function hama(format: Format, otherCopy: boolean, damage: boolean): Scenario {
  const holder: Seat = format === "ffa3" ? "p2" : "p3";
  const base = baseLp(format);
  const monsters = otherCopy && damage ? [HAMA, BLUE_EYES] : [HAMA];
  const spec: Parameters<typeof everySeat>[1] = {};
  for (const seat of SEATS[format]) spec[seat] = { hand: seat === "p0" ? [] : ["Mystical Elf"] };
  spec[holder] = { ...spec[holder], monsters, grave: [TWINBOW] };
  spec.p0 = { hand: [], ...(otherCopy ? (damage ? { grave: [HAMA] } : { monsters: [HAMA] }) : {}), lp: base - (damage ? (otherCopy ? 200 : 2800) : 300) };
  return defineScenario({
    id: `hama-damage-state-${format}-${holder}-${otherCopy ? "two-copies" : "one-copy"}-${damage ? "damage-stops-burn" : "no-damage-allows-burn"}`,
    title: `${format}: Hama of ${holder} ${damage ? "does not burn after battle damage to an opponent" : "burns for 300 after a Battle Phase with no battle damage"}${otherCopy ? "; p0 has another Hama" : ""}`,
    source: `${SOURCE} [R-COMMON-SEAT-STATE] battle damage is stored per seat in FFA and per team in Tag`,
    rules: ["R-COMMON-SEAT-STATE"],
    tags: ["multiplayer", "global-effect", "flag", format, "card:80949182"],
    setup: baseSetup(format, {
      ...(otherCopy ? { p0: { monsters: [HAMA] } } : {}),
      [holder]: { monsters, grave: [TWINBOW] },
    }),
    steps: [
      ...turnsBefore(format, holder),
      ...(damage
        ? otherCopy
          ? [attack(BLUE_EYES, { card: HAMA, owner: "p0" }, holder)]
          : [attack(HAMA, "direct", holder), pickOpponent("p0", holder)]
        : [changePhase("battle", holder)]),
      changePhase("main2", holder),
      ...(damage ? [expectPrompt({ by: holder, context: "action" })] : [yes(holder), ...(format === "tag" ? [] : [pickOpponent("p0", holder)])]),
      everySeat(format, spec),
    ],
  });
}

export const HAMA_DAMAGE_STATE_SCENARIOS: Scenario[] = (["ffa3", "ffa4", "tag"] as Format[]).flatMap((format) => [
  hama(format, false, true), hama(format, true, true), hama(format, true, false),
]);
