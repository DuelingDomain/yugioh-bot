import { zoneKey } from "./constants";
import { MOVE_PACE } from "./duel-timing";
import type { BattleClock } from "./battle-clock";

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

type Hold = { at: number | BattleClock; delayMs: number };
const deadline = (hold: Hold): number => (typeof hold.at === "number" ? hold.at : hold.at.startedAt) + hold.delayMs;
const holds = new Map<string, Hold>();
/**
 * Wipe takeovers (see fx3d/effects/wipes): the canvas draws the whole card from `takeAt`, and the card
 * reaches its pile at `moveAt`. Keyed by the zone the card stands on. The page keeps the card whole until
 * `takeAt` (SummonFx ghost, or the ghost of DestroyFx for a banish), and the move to the pile waits for
 * `moveAt` and then only fades in (no flight, no gap in the move queue).
 */
const takeovers = new Map<string, { takeAt: number; moveAt: number }>();
/** Zones whose break the 3D layer draws (a claim), so the DOM skips its own shards. */
const claims = new Set<string>();
const impacts = new Map<number, number>();
const armedKeys = new Set<string>();

const now = (): number => (typeof performance !== "undefined" ? performance.now() : Date.now());

/**
 * Holds the destroy of the card on `zone` until `delayMs` from now. `key` (the attack event and
 * zone) makes it idempotent: BattleFx arms while rendering, and a render may repeat.
 */
export type BattleTakeover = { takeAt: number; moveAt: number };

export function armBattleDestroy(key: string, zone: Zone, delayMs: number, at: number | BattleClock = now(), claim3d = false, takeover?: { moveAfterMs: number }): void {
  if (armedKeys.has(key)) return;
  armedKeys.add(key);
  // Forget the oldest key only: clearing them all could let a repeat render of the current
  // attack arm it again, later, and push its hold back.
  if (armedKeys.size > 200) armedKeys.delete(armedKeys.values().next().value as string);
  const zoneId = zoneKey(zone.controller, zone.location, zone.sequence);
  const hold = { at, delayMs };
  const knownHold = holds.get(zoneId);
  if (!knownHold || deadline(hold) >= deadline(knownHold)) holds.set(zoneId, hold);
  if (claim3d) claims.add(zoneId);
  if (takeover) {
    const startedAt = typeof at === "number" ? at : at.startedAt;
    const known = takeovers.get(zoneId);
    const moveAt = startedAt + Math.max(delayMs, takeover.moveAfterMs);
    takeovers.set(zoneId, { takeAt: Math.max(known?.takeAt ?? 0, startedAt + delayMs), moveAt: Math.max(known?.moveAt ?? 0, moveAt) });
  }
}

/**
 * The takeover armed for the card on `zone`, or null when there is none or its move time has passed.
 * `takeAt` is when the canvas starts to draw the card; `moveAt` is when the card may reach its pile.
 */
export function battleTakeover(zone: Zone | undefined | null, at: number = now()): BattleTakeover | null {
  if (!zone) return null;
  const id = zoneKey(zone.controller, zone.location, zone.sequence);
  const found = takeovers.get(id);
  if (!found) return null;
  if (found.moveAt <= at) {
    takeovers.delete(id);
    return null;
  }
  return found;
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
  const hold = holds.get(id);
  if (hold == null) return 0;
  const until = deadline(hold);
  if (until <= at) {
    holds.delete(id);
    claims.delete(id);
    return 0;
  }
  return until;
}

export function clearBattleHolds(): void {
  holds.clear();
  takeovers.clear();
  claims.clear();
  impacts.clear();
  armedKeys.clear();
}
