import { zoneKey } from "./constants";
import { MOVE_PACE } from "./duel-timing";

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
export const HELD_CRACK_MS = MOVE_PACE.heldCrackMs;

type Zone = { controller: number; location: number; sequence: number };

/** How long the shards of a 3D break fall before the card may reach the Graveyard. */
export const BREAK_SETTLE_MS = MOVE_PACE.breakSettleMs;

const holds = new Map<string, number>();
/** Zones whose break the 3D layer draws (a claim), so the DOM skips its own shards. */
const claims = new Set<string>();
const impacts = new Map<number, number>();
const armedKeys = new Set<string>();

const now = (): number => (typeof performance !== "undefined" ? performance.now() : Date.now());

/**
 * Holds the destroy of the card on `zone` until `delayMs` from now. `key` (the attack event and
 * zone) makes it idempotent: BattleFx arms while rendering, and a render may repeat.
 */
export function armBattleDestroy(key: string, zone: Zone, delayMs: number, at: number = now(), claim3d = false): void {
  if (armedKeys.has(key)) return;
  armedKeys.add(key);
  // Forget the oldest key only: clearing them all could let a repeat render of the current
  // attack arm it again, later, and push its hold back.
  if (armedKeys.size > 200) armedKeys.delete(armedKeys.values().next().value as string);
  const zoneId = zoneKey(zone.controller, zone.location, zone.sequence);
  holds.set(zoneId, Math.max(holds.get(zoneId) ?? 0, at + delayMs));
  if (claim3d) claims.add(zoneId);
}

/** True while the 3D layer draws the break of the card on `zone` (its hold has not passed). */
export function battleBreakIs3d(zone: Zone | undefined | null, at: number = now()): boolean {
  if (!zone) return false;
  const id = zoneKey(zone.controller, zone.location, zone.sequence);
  return claims.has(id) && battleDestroyAt(zone, at) > 0;
}

/** Records the absolute time (performance.now()) an attack lands, for the scenes that react to it. */
export function noteAttackImpact(attackId: number, absMs: number): void {
  impacts.set(attackId, absMs);
  if (impacts.size > 50) impacts.delete(impacts.keys().next().value as number);
}

export function attackImpactAt(attackId: number): number {
  return impacts.get(attackId) ?? 0;
}

/** The time (performance.now()) the destroy of the card on `zone` may break, or 0 when nothing holds it. */
export function battleDestroyAt(zone: Zone | undefined | null, at: number = now()): number {
  if (!zone) return 0;
  const id = zoneKey(zone.controller, zone.location, zone.sequence);
  const until = holds.get(id);
  if (until == null) return 0;
  if (until <= at) {
    holds.delete(id);
    claims.delete(id);
    return 0;
  }
  return until;
}

export function clearBattleHolds(): void {
  holds.clear();
  claims.clear();
  impacts.clear();
  armedKeys.clear();
}
