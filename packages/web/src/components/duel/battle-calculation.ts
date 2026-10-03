import type { DuelEvent, DuelZoneRef } from "@yugidraft/shared/duels";

const sameZone = (a: DuelZoneRef | undefined, b: DuelZoneRef | undefined) =>
  a === b || (a != null && b != null && a.controller === b.controller && a.location === b.location && a.sequence === b.sequence);

/** Only this attack's engine calculation; never borrow stats from a later fight. */
export function battleCalculation(events: readonly DuelEvent[], attack: DuelEvent): DuelEvent["battle"] | null {
  for (const event of [...events].filter(e => e.id > attack.id).sort((a, b) => a.id - b.id)) {
    if (event.kind === "attack" || event.kind === "phase") break;
    if (event.kind === "battle" && event.battle && sameZone(event.zone, attack.zone) && sameZone(event.target, attack.target)) {
      return event.battle;
    }
  }
  return null;
}
