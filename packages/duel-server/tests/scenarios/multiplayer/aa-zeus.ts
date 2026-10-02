// AA-ZEUS (90448279): a battle involving an Xyz Monster permits the alternative Xyz Summon for any holder.
// The holder is a later seat. A battle between non-Xyz monsters does not set the flag.
import { attack, changePhase, defineScenario, expectNotOffered, expectOffered, specialSummon, type DuelistExpect, type Scenario } from "../../support/dsl.js";
import { SOURCE } from "./nseat-scenarios.js";
import { baseLp, baseSetup, everySeat, label, SEATS, turnsBefore, type Format, type Seat } from "./seat-kit.js";

const ZEUS = "Divine Arsenal AA-ZEUS - Sky Thunder";
const XYZ = "Daigusto Emeral"; // 1800 ATK; its ignition effect needs a material, so it does not open a chain window.
const OX = "Battle Ox"; // 1700 ATK
const ELF = "Mystical Elf"; // 800 ATK

function zeus(format: Format, holder: Seat, xyzBattled: boolean): Scenario {
  const target = SEATS[format][(SEATS[format].indexOf(holder) + 1) % SEATS[format].length]!;
  const untouched: Partial<Record<Seat, DuelistExpect>> = {};
  for (const seat of SEATS[format]) untouched[seat] = { hand: seat === "p0" ? [] : [ELF], deckCount: seat === "p0" ? 20 : 19, extra: [] };
  return defineScenario({
    id: `aa-zeus-${format}-${holder}-${xyzBattled ? "xyz-battle-permits-summon" : "non-xyz-battle-does-not-permit-summon"}`,
    title: `${label(format)}: ${holder} ${xyzBattled ? "Xyz Summons AA-ZEUS after its Xyz Monster battles" : "cannot Xyz Summon AA-ZEUS after only its Battle Ox battles"}`,
    source: `${SOURCE} [R-COMMON-SEAT-STATE] the global battle flag reaches each seat`,
    rules: ["R-COMMON-SEAT-STATE"],
    tags: ["multiplayer", "global-effect", "flag", format, "card:90448279"],
    setup: baseSetup(format, { [holder]: { monsters: [XYZ, OX], extra: [ZEUS] }, [target]: { monsters: [ELF] } }),
    steps: [
      ...turnsBefore(format, holder),
      expectNotOffered("specialSummon", ZEUS, holder),
      attack(xyzBattled ? XYZ : OX, { card: ELF, owner: target }, holder),
      changePhase("main2", holder),
      ...(xyzBattled
        ? [expectOffered("specialSummon", ZEUS, holder), specialSummon(ZEUS, holder)]
        : [expectNotOffered("specialSummon", ZEUS, holder)]),
      everySeat(format, {
        ...untouched,
        [holder]: { monsters: xyzBattled ? [ZEUS, OX] : [XYZ, OX], hand: [ELF], extra: xyzBattled ? [] : [ZEUS], ...(xyzBattled ? { zones: { m0: { card: ZEUS, materials: 1 } } } : {}) },
        [target]: { ...untouched[target], lp: baseLp(format) - (xyzBattled ? 1000 : 900), grave: [ELF] },
      }),
    ],
  });
}

export const AA_ZEUS_SCENARIOS: Scenario[] = [];
for (const [format, holder] of [["ffa3", "p2"], ["ffa4", "p3"], ["tag", "p3"]] as const) {
  for (const battled of [true, false]) AA_ZEUS_SCENARIOS.push(zeus(format, holder, battled));
}
