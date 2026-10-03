// Red Nova Dragon - Burning Soul (65541655): the recovery and 2000 ATK bonus require a real Red Dragon Archfiend Synchro Summon.
// Later-seat holders must get that flag. A Red Dragon Archfiend placed on the field by setup does not meet the condition.
// A real battle against Blue-Eyes Ultimate Dragon proves the resulting 5500 or 3500 ATK.
import { activate, attack, expectNotOffered, expectPrompt, select, specialSummon, yes, type DuelistExpect, type Scenario } from "../../support/dsl.js";
import { defineScenarioWithFfaFirstDraw as defineScenario } from "./ffa-first-draw.js";
import { SOURCE } from "./nseat-scenarios.js";
import { baseLp, baseSetup, everySeat, label, SEATS, turnsBefore, type Format, type Seat } from "./seat-kit.js";

const NOVA = "Red Nova Dragon - Burning Soul";
const ARCHFIEND = "Red Dragon Archfiend";
const TUNER = "Genex Controller"; // Level 3 Normal Tuner
const GUARD = "Flamvell Guard"; // Level 1 Normal Tuner
const GIGA = "Giga Gagagigo"; // Level 5 Normal Monster
const VICTIM = "Blue-Eyes Ultimate Dragon"; // 4500 ATK
const ELF = "Mystical Elf";
const DOOMED = "Tribute to The Doomed";

function burningSoul(format: Format, holder: Seat, synchro: boolean): Scenario {
  const target = SEATS[format][(SEATS[format].indexOf(holder) + 1) % SEATS[format].length]!;
  const untouched: Partial<Record<Seat, DuelistExpect>> = {};
  for (const seat of SEATS[format]) untouched[seat] = { hand: seat === "p0" ? [] : [ELF], deckCount: seat === "p0" ? 20 : 19, extra: [] };
  return defineScenario({
    id: `red-nova-burning-soul-${format}-${holder}-${synchro ? "own-synchro-gives-recovery-and-bonus" : "no-synchro-gives-no-recovery-or-bonus"}`,
    title: `${label(format)}: ${holder} summons Red Nova Dragon - Burning Soul ${synchro ? "after a real Red Dragon Archfiend Synchro Summon, recovers Giga Gagagigo, and wins with 5500 ATK" : "with no Red Dragon Archfiend Synchro Summon, recovers no card, and loses with 3500 ATK"}`,
    source: `${SOURCE} [R-COMMON-SEAT-STATE] the global summon check writes the flag of the summoning seat`,
    rules: ["R-COMMON-SEAT-STATE"],
    tags: ["multiplayer", "global-effect", "flag", format, "card:65541655"],
    setup: baseSetup(format, {
      [holder]: synchro
        ? { hand: [DOOMED], monsters: [TUNER, GIGA], grave: [GUARD], extra: [ARCHFIEND, NOVA] }
        : { grave: [ARCHFIEND, TUNER, GUARD, GIGA], extra: [NOVA] },
      [target]: { monsters: [VICTIM] },
    }),
    steps: [
      ...turnsBefore(format, holder),
      ...(synchro ? [specialSummon(ARCHFIEND, holder), select(TUNER, GIGA), activate(DOOMED, holder), select(ARCHFIEND)] : []),
      specialSummon(NOVA, holder),
      select(TUNER, GUARD, ARCHFIEND),
      ...(synchro ? [expectPrompt({ by: holder, title: `Activate the Trigger Effect of "${NOVA}"` }), yes(holder), select(GIGA)] : [expectNotOffered("activate", NOVA, holder)]),
      attack(NOVA, { card: VICTIM, owner: target }, holder),
      everySeat(format, {
        ...untouched,
        [holder]: { ...untouched[holder], lp: baseLp(format) - (synchro ? 0 : 1000), monsters: synchro ? [NOVA] : [], hand: synchro ? [GIGA] : [ELF], banished: [TUNER, GUARD, ARCHFIEND], grave: synchro ? [DOOMED, ELF] : [GIGA, NOVA] },
        [target]: { ...untouched[target], lp: baseLp(format) - (synchro ? 1000 : 0), monsters: synchro ? [] : [VICTIM], grave: synchro ? [VICTIM] : [] },
      }),
    ],
  });
}

export const RED_NOVA_BURNING_SOUL_SCENARIOS: Scenario[] = [];
for (const [format, holder] of [["ffa3", "p2"], ["ffa4", "p3"], ["tag", "p3"]] as const) {
  for (const synchro of [true, false]) RED_NOVA_BURNING_SOUL_SCENARIOS.push(burningSoul(format, holder, synchro));
}
