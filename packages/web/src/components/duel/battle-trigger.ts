import type { DuelEvent, DuelZoneRef } from "@yugidraft/shared/duels";
import { battleCalculation } from "./battle-calculation";

/**
 * Which engine event starts the battle animation.
 *
 * The attack event only DECLARES the attack. The duel then stops for response windows (when a card
 * can really act), and many attacks never resolve: an effect can negate the attack, or take the
 * attacker away. So the full animation (lunge, slash or beam, impact, counter, break, LP roll)
 * starts when the battle RESOLVES:
 *   - a battle damage event, or
 *   - a destroy event caused by battle (of the attacker or of the target), or
 *   - the engine's Damage Step end, for a calculated fight that leaves neither.
 * An attack-negated event (MSG_ATTACK_DISABLED) ends the attack at once, with no animation.
 * MSG_BATTLE supplies stats, but after-calculation response windows can still precede destruction.
 * Older replays without calculation events close a fight with neither damage nor destruction
 * (ATK equal to a Defense Position DEF) at the next attack or phase, as a short clash.
 * An attack that leaves no trace of a fight (an effect was activated, the attacker or the target
 * left the field, or the attack is direct and no damage came) fizzles: no attack animation.
 *
 * Pure: events in, one decision out. BattleFx calls it with the whole event list on every snapshot.
 */

export type BattleTrigger =
  | { action: "wait" }
  | { action: "play"; reason: "calculation" | "damage" | "destroy" | "clash" }
  | { action: "fizzle"; reason: "negated" | "attacker-left" | "target-left" | "no-battle" | "stale" };

/** A clash that no event closed for this long is not shown: it would play long after the fight. */
export const CLASH_MAX_AGE_MS = 6000;

function sameZone(a: DuelZoneRef | undefined, b: DuelZoneRef | undefined): boolean {
  return a != null && b != null && a.controller === b.controller && a.location === b.location && a.sequence === b.sequence;
}

/** True for a cause that belongs to the fight. An event with no cause (an older replay) counts. */
function isBattleCause(cause: string | undefined): boolean {
  return cause == null || cause === "battle";
}

export function battleTrigger(events: readonly DuelEvent[], attack: DuelEvent, ageMs = 0): BattleTrigger {
  if (attack.kind !== "attack" || !attack.zone) return { action: "fizzle", reason: "no-battle" };
  const after = events.filter((event) => event.id > attack.id).sort((a, b) => a.id - b.id);
  const direct = attack.target == null;
  let responded = false;
  for (const event of after) {
    switch (event.kind) {
      case "toss":
        break;
      case "battle-end":
        if (battleCalculation(events, attack)) {
          // MSG_BATTLE proves the fight occurred, even after responses or a long window.
          return { action: "play", reason: "calculation" };
        }
        break;
      case "damage":
        if (event.cause === "cost") break;
        // Effect damage after the declaration is not the fight; battle damage is.
        if (isBattleCause(event.cause)) return { action: "play", reason: "damage" };
        break;
      case "destroy":
        if (sameZone(event.zone, attack.zone)) {
          return isBattleCause(event.cause) ? { action: "play", reason: "destroy" } : { action: "fizzle", reason: "attacker-left" };
        }
        if (!direct && sameZone(event.zone, attack.target)) {
          return isBattleCause(event.cause) ? { action: "play", reason: "destroy" } : { action: "fizzle", reason: "target-left" };
        }
        break;
      case "move":
        // The core moves battle casualties before announcing their destruction.
        if (event.reason === "destroy" && event.cause === "battle") break;
        // Banished, bounced or sent away without a destroy event.
        if (sameZone(event.from, attack.zone)) return { action: "fizzle", reason: "attacker-left" };
        if (!direct && sameZone(event.from, attack.target)) return { action: "fizzle", reason: "target-left" };
        break;
      case "activate":
        responded = true;
        break;
      case "attack-negated":
        // The engine said so (Negate Attack, Magic Cylinder, ...): the declared attack is over, with no fight.
        return { action: "fizzle", reason: "negated" };
      case "attack":
      case "phase":
        // The battle ended without damage or a destroy.
        if (direct || responded) return { action: "fizzle", reason: direct ? "no-battle" : "negated" };
        return ageMs > CLASH_MAX_AGE_MS ? { action: "fizzle", reason: "stale" } : { action: "play", reason: "clash" };
      default:
        break;
    }
  }
  return { action: "wait" };
}
