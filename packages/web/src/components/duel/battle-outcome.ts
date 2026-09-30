import type { DuelEvent, DuelZoneRef } from "@yugidraft/shared/duels";

/** Which side of an attack was destroyed by it. */
export type BattleOutcome = {
  attacker: boolean;
  target: boolean;
};

function sameZone(a: DuelZoneRef | undefined, b: DuelZoneRef | undefined): boolean {
  return a != null && b != null && a.controller === b.controller && a.location === b.location && a.sequence === b.sequence;
}

/**
 * Which cards an attack destroyed, read from the "destroy" events that follow it in the same
 * snapshot (each carries `zone`, the zone the card left). A lower-ATK attacker dies alone, the
 * target dies when it loses, both die on equal ATK, and neither when a defender holds. The scan
 * Destroys with a non-battle `cause` (effect, rule, cost) are skipped; a missing cause counts. The scan
 * stops at the next attack or the next phase change so a later fight or effect never counts.
 */
export function battleOutcome(events: readonly DuelEvent[], attack: DuelEvent): BattleOutcome {
  const outcome: BattleOutcome = { attacker: false, target: false };
  if (attack.kind !== "attack" || !attack.zone) return outcome;
  const sorted = [...events].filter((event) => event.id > attack.id).sort((a, b) => a.id - b.id);
  for (const event of sorted) {
    if (event.kind === "attack" || event.kind === "phase") break;
    if (event.kind !== "destroy" || !event.zone) continue;
    // A trap or effect that kills a battler (Mirror Force, Sakuretsu Armor) is not the battle's result.
    // An event with no cause (an older replay) keeps the old heuristic and counts.
    if (event.cause != null && event.cause !== "battle") continue;
    if (sameZone(event.zone, attack.zone)) outcome.attacker = true;
    if (attack.target && sameZone(event.zone, attack.target)) outcome.target = true;
  }
  return outcome;
}
