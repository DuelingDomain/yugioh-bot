/**
 * Order of a big summon (heavy, Tribute, Fusion, Synchro, Xyz, Link, Ritual, Pendulum):
 *   1. the portrait rises while the zone is empty (the real card is hidden, no card flies in),
 *   2. the portrait slams into the zone,
 *   3. the real card, with its stat plate, shows at the slam (the hand-over beat).
 * The pure rules for it live here so they can be tested without a DOM.
 */
import type { DuelEvent } from "@yugidraft/shared/duels";
import { isHeavySummon, summonStyleOf } from "./event-queue";

/**
 * The real card is never held hidden longer than this, whatever the queue looks like (a safety net:
 * a stuck effect must not leave a zone empty). A chain of big summons waits about 1.4 s each.
 */
export const BIG_HOLD_CAP_MS = 8000;

/**
 * True when `summon` plays the big animation, so the card flight that carries it is not drawn: the
 * portrait is the arrival. Reduced motion keeps the short fade flight and the plain glow.
 */
export function playsBigSummon(summon: DuelEvent, fromLocation: number | undefined, reduced: boolean): boolean {
  if (reduced || summon.kind !== "summon") return false;
  return isHeavySummon(summon) || summonStyleOf(summon, fromLocation) != null;
}

/**
 * How long the real card in the zone stays hidden, in ms from the moment the summon event is
 * applied: the wait before the effect starts plus the time until its hand-over beat, capped by the
 * safety net. Bad input (NaN, negative) never gives a negative or endless hold.
 */
export function hiddenHoldMs(delayMs: number, handOverMs: number, capMs: number = BIG_HOLD_CAP_MS): number {
  const wait = Number.isFinite(delayMs) ? Math.max(0, delayMs) : 0;
  const over = Number.isFinite(handOverMs) ? Math.max(0, handOverMs) : 0;
  return Math.min(wait + over, Math.max(0, capMs));
}
