// Vanquish Soul Rocks (77894049): a Vanquish Soul battle at later seats must set the global alternative-Xyz flag.
// A battle that involves no Vanquish Soul monster does not permit that summon. The procedure can be used only once per turn.
import { attack, changePhase, expectNotOffered, expectOffered, specialSummon, type DuelistExpect, type Scenario } from "../../support/dsl.js";
import { defineScenarioWithFfaFirstDraw as defineScenario } from "./ffa-first-draw.js";
import { SOURCE } from "./nseat-scenarios.js";
import { baseLp, baseSetup, everySeat, label, SEATS, turnsBefore, type Format, type Seat } from "./seat-kit.js";

const ROCKS = "Vanquish Soul Rocks";
const RAZEN = "Vanquish Soul Razen"; // 1800 ATK, FIRE
const OX = "Battle Ox"; // 1700 ATK
const ELF = "Mystical Elf"; // 800 ATK

function rocks(format: Format, holder: Seat, vanquishBattled: boolean): Scenario {
  const target = SEATS[format][(SEATS[format].indexOf(holder) + 1) % SEATS[format].length]!;
  const untouched: Partial<Record<Seat, DuelistExpect>> = {};
  for (const seat of SEATS[format]) untouched[seat] = { hand: seat === "p0" ? [] : [ELF], deckCount: seat === "p0" ? 20 : 19, extra: [] };
  return defineScenario({
    id: `vanquish-soul-rocks-${format}-${holder}-${vanquishBattled ? "vanquish-battle-permits-one-summon" : "other-battle-does-not-permit-summon"}`,
    title: `${label(format)}: ${holder} ${vanquishBattled ? "Xyz Summons Vanquish Soul Rocks once after Razen battles" : "cannot Xyz Summon Vanquish Soul Rocks after only Battle Ox battles"}`,
    source: `${SOURCE} [R-COMMON-SEAT-STATE] a battle at a later seat sets the global flag for all holders`,
    rules: ["R-COMMON-SEAT-STATE"],
    tags: ["multiplayer", "global-effect", "flag", format, "card:77894049"],
    setup: baseSetup(format, { [holder]: { monsters: [RAZEN, OX], extra: [ROCKS, ROCKS] }, [target]: { monsters: [ELF] } }),
    steps: [
      ...turnsBefore(format, holder),
      expectNotOffered("specialSummon", ROCKS, holder),
      attack(vanquishBattled ? RAZEN : OX, { card: ELF, owner: target }, holder),
      changePhase("main2", holder),
      ...(vanquishBattled
        ? [expectOffered("specialSummon", ROCKS, holder), specialSummon(ROCKS, holder), expectNotOffered("specialSummon", ROCKS, holder)]
        : [expectNotOffered("specialSummon", ROCKS, holder)]),
      everySeat(format, {
        ...untouched,
        [holder]: { ...untouched[holder], monsters: vanquishBattled ? [ROCKS, OX] : [RAZEN, OX], extra: vanquishBattled ? [ROCKS] : [ROCKS, ROCKS], ...(vanquishBattled ? { zones: { m0: { card: ROCKS, materials: 1 } } } : {}) },
        [target]: { ...untouched[target], lp: baseLp(format) - (vanquishBattled ? 1000 : 900), grave: [ELF] },
      }),
    ],
  });
}

export const VANQUISH_SOUL_ROCKS_SCENARIOS: Scenario[] = [];
for (const [format, holder] of [["ffa3", "p2"], ["ffa4", "p3"], ["tag", "p3"]] as const) {
  for (const battled of [true, false]) VANQUISH_SOUL_ROCKS_SCENARIOS.push(rocks(format, holder, battled));
}
