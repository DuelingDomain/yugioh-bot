// Invincible Demise Lord (71108540): "During the End Phase, if a monster(s) was destroyed by battle this turn: You can Special Summon this card
// from your hand or GY, and if "Invincible Demise Lord" was destroyed by battle this turn, this card's original ATK becomes 3000, also it
// cannot be destroyed by card effects".
//
// The stock global check registers TWO flags: slot 0 for any monster destroyed by battle, slot 1 only when a Demise Lord was destroyed. The
// overlay wrapper of initial_effect fans a flag of a global effect out to every living duelist. It sent both slots to one key, so at 3 or
// more seats the 3000 ATK bonus came after ANY battle kill (the Lord of a holder that had only an Elf destroyed attacked as a 3000 ATK
// monster). The wrapper now registers slot 1 under a second key (id+100) and reads it with the own seat of the holder.
//
// Each scenario: p0 attacks with its Blue-Eyes White Dragon (3000 ATK) the monster of the holder in its own turn, the holder Special
// Summons the Lord at the End Phase and attacks the Blue-Eyes with it in its own turn.
//   - only an Elf was destroyed (the Lord is in the hand): the Lord has its printed 1300 ATK, loses the battle and the holder takes 1700 more;
//   - a Lord was destroyed (the control, the Lord comes back from the Graveyard): the Lord has 3000 ATK and both monsters are destroyed.

import { attack, defineScenario, endTurn, yes, type Scenario } from "../../support/dsl.js";
import { SOURCE } from "./nseat-scenarios.js";
import { baseLp, baseSetup, everySeat, label, turnsBefore, type Format, type Seat } from "./seat-kit.js";

const LORD = "Invincible Demise Lord";
const LORD_CODE = 71108540;
const BEWD = "Blue-Eyes White Dragon"; // 3000 ATK
const ELF = "Mystical Elf"; // 800 ATK

function lord(format: "ffa3" | "tag", holder: Seat, lordDied: boolean): Scenario {
  const base = baseLp(format);
  const victim = lordDied ? LORD : ELF;
  const first = base - (lordDied ? 1700 : 2200);
  return defineScenario({
    id: `demise-lord-${format}-${holder}-${lordDied ? "lord-destroyed-gets-3000-atk" : "only-an-elf-destroyed-keeps-1300-atk"}`,
    title: lordDied
      ? `${label(format)}: the Demise Lord of ${holder} that comes back from the Graveyard after a Demise Lord was destroyed by battle has 3000 ATK (slot 1 flag set for ${holder}): both monsters are destroyed`
      : `${label(format)}: the Demise Lord of ${holder} that is Special Summoned after only a Mystical Elf was destroyed by battle keeps 1300 ATK (slot 1 flag not set): it loses the battle to the Blue-Eyes`,
    source: `${SOURCE} [R-COMMON-SEAT-STATE] the second flag of the global check of a card is a key of its own for every living duelist`,
    rules: ["R-COMMON-SEAT-STATE"],
    tags: ["multiplayer", "global-effect", "flag", format, `card:${LORD_CODE}`],
    setup: baseSetup(format, { p0: { monsters: [BEWD] }, [holder]: lordDied ? { monsters: [LORD] } : { monsters: [ELF], hand: [LORD] } }),
    steps: [
      attack(BEWD, victim, "p0"),
      endTurn("p0"),
      yes(holder),
      ...turnsBefore(format, holder, "p1"),
      attack(LORD, BEWD, holder),
      lordDied
        ? everySeat(format, { p0: { grave: [BEWD] }, [holder]: { lp: first, grave: [LORD] } })
        : everySeat(format, { p0: { monsters: [BEWD] }, [holder]: { lp: first - 1700, grave: [ELF, LORD] } }),
    ],
  });
}

export const DEMISE_LORD_SCENARIOS: Scenario[] = [
  lord("ffa3", "p1", false), lord("ffa3", "p2", false), lord("tag", "p1", false), lord("tag", "p3", false),
  lord("ffa3", "p1", true), lord("ffa3", "p2", true), lord("tag", "p1", true), lord("tag", "p3", true),
];
