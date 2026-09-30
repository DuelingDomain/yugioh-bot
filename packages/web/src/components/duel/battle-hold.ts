import { zoneKey } from "./constants";

/**
 * The battle hold: a destroyed card stays on its zone until the fight that killed it has landed.
 *
 * BattleFx knows when each killing strike hits (attack, then any counter strike, then the LP
 * damage). The engine's "destroy" events arrive in the same snapshot as the attack, so without
 * this the crack-and-break of SummonFx and the flight to the Graveyard of MoveFx would start at
 * once, while the counterattack is still travelling. BattleFx arms a hold per destroyed zone in
 * its render phase (before SummonFx, MoveFx and the toast layer plan the same batch); they ask
 * for it when they schedule a destroy, and start that destroy no earlier than the hold.
 *
 * Times are performance.now() stamps. A hold is read, never consumed, so every layer that plans
 * the same destroy sees the same answer. It fades on its own once its time has passed.
 */

/** The crack-in-place before a held destroy breaks (shorter than an unheld battle destroy). */
export const HELD_CRACK_MS = 100;

type Zone = { controller: number; location: number; sequence: number };

const holds = new Map<string, number>();
const armedKeys = new Set<string>();

const now = (): number => (typeof performance !== "undefined" ? performance.now() : Date.now());

/**
 * Holds the destroy of the card on `zone` until `delayMs` from now. `key` (the attack event and
 * zone) makes it idempotent: BattleFx arms while rendering, and a render may repeat.
 */
export function armBattleDestroy(key: string, zone: Zone, delayMs: number, at: number = now()): void {
  if (armedKeys.has(key)) return;
  armedKeys.add(key);
  if (armedKeys.size > 200) armedKeys.clear();
  const zoneId = zoneKey(zone.controller, zone.location, zone.sequence);
  holds.set(zoneId, Math.max(holds.get(zoneId) ?? 0, at + delayMs));
}

/** The time (performance.now()) the destroy of the card on `zone` may break, or 0 when nothing holds it. */
export function battleDestroyAt(zone: Zone | undefined | null, at: number = now()): number {
  if (!zone) return 0;
  const id = zoneKey(zone.controller, zone.location, zone.sequence);
  const until = holds.get(id);
  if (until == null) return 0;
  if (until <= at) {
    holds.delete(id);
    return 0;
  }
  return until;
}

export function clearBattleHolds(): void {
  holds.clear();
  armedKeys.clear();
}
