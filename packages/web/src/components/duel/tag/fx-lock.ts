import type { DuelEvent } from "@yugidraft/shared/duels";
import { scaleLockMs } from "../camera-lock-time";
import { ROOF_LOCK_IN_MS } from "./roof-camera";
import type { CameraLockReason } from "../table/types";

/**
 * The camera lock of the Rooftop. While an attack, a chain link or a destroy plays on the overview, the camera ignores
 * input until the lock ends. A close-up never locks (it stays, or it goes out once: see `otherPlayerActed`). The shell
 * passes the events newer than the last one it handled.
 */
export interface FxLock {
  reason: CameraLockReason;
  ms: number;
  lastId: number;
}

const PRIORITY: Record<CameraLockReason, number> = { destroy: 1, chain: 2, battle: 3, direct: 4, elimination: 5 };
const TIMES: Record<CameraLockReason, number> = { destroy: 1500, chain: 1900, battle: 2600, direct: 2400, elimination: 3200 };

function reasonOf(event: DuelEvent): CameraLockReason | null {
  switch (event.kind) {
    case "toss":
      return null;
    case "attack":
      return event.target ? "battle" : "direct";
    case "chain-resolving":
      return "chain";
    case "destroy":
      return "destroy";
    default:
      return null;
  }
}

/**
 * The seats an event touches and the seat that caused it, for a close-up that must go out when another player acts. Only an
 * activate, a summon, a set and an attack are actions; a destroy or a move names the owner of the card, not who acted.
 * - activate: the actor is `event.seat` (the activating player). It touches the field the card is on and the field of each target.
 * - attack: the actor is the attacking seat. It touches that field and the attacked one (the target zone, or `targetSeat` for a
 *   direct attack).
 * - summon / set: `event.seat` is the controller of the card, not the actor (a Kaiju goes to the rival's field, a token to
 *   another seat). The actor is the owner of the chain link that is resolving, else the turn player.
 */
function actionOf(event: DuelEvent, resolvingSeat: number | null, turnSeat: number | null): { actor: number | null; touched: number[] } | null {
  switch (event.kind) {
    case "activate": {
      const own = event.zone?.controller ?? event.seat;
      return { actor: event.seat ?? null, touched: [own, ...(event.targets ?? []).map((zone) => zone.controller)].filter((seat): seat is number => seat != null) };
    }
    case "attack": {
      const attacked = event.target?.controller ?? event.targetSeat;
      return { actor: event.seat ?? null, touched: [event.seat, attacked].filter((seat): seat is number => seat != null) };
    }
    case "summon":
    case "set": {
      const controller = event.zone?.controller ?? event.seat;
      return { actor: resolvingSeat ?? turnSeat, touched: controller == null ? [] : [controller] };
    }
    default:
      return null;
  }
}

/**
 * True when another player acted since `afterId` on a field other than the one in close-up (`focusSeat`). It is the one
 * reason the Rooftop camera moves by itself, and it only moves out: the shell sends the camera to the overview once and
 * leaves it there. The viewer's own actions never count, wherever they land. `turnSeat` is the actor of a summon or a set
 * that no chain link causes.
 */
export function otherPlayerActed(
  events: readonly DuelEvent[],
  afterId: number,
  viewerSeat: number | null,
  focusSeat: number | null,
  turnSeat: number | null = null,
): boolean {
  let resolvingSeat: number | null = null;
  for (const event of events) {
    if (event.kind === "chain-resolving") resolvingSeat = event.seat ?? null;
    else if (event.kind === "chain-resolved" || event.kind === "chain-negated" || event.kind === "chain-end") resolvingSeat = null;
    if (event.id <= afterId) continue;
    const action = actionOf(event, resolvingSeat, turnSeat);
    if (!action || action.actor == null || action.actor === viewerSeat) continue;
    if (action.touched.some((seat) => seat !== focusSeat)) return true;
  }
  return false;
}

/** The newest event id, or `afterId` when there is none. A caller that skips the lock still moves its cursor with this. */
export function lastEventId(events: readonly DuelEvent[], afterId: number): number {
  return events.reduce((last, event) => Math.max(last, event.id), afterId);
}

/**
 * Lock for the events with an id above `afterId`: the strongest reason, the longest time. Null when none locks.
 * With reduced motion the camera never locks (no eased move, no input freeze); use `lastEventId` for the cursor.
 * `speed` is the viewer's FX rate (`duelFxClock.factor()`): the effects last 1/speed as long, so the lock does too.
 */
export function lockForEvents(events: readonly DuelEvent[], afterId: number, reducedMotion = false, speed = 1): FxLock | null {
  if (reducedMotion) return null;
  let reason: CameraLockReason | null = null;
  let ms = 0;
  let lastId = afterId;
  for (const event of events) {
    if (event.id <= afterId) continue;
    lastId = Math.max(lastId, event.id);
    const next = reasonOf(event);
    if (!next) continue;
    if (reason === null || PRIORITY[next] > PRIORITY[reason]) reason = next;
    ms = Math.max(ms, TIMES[next]);
  }
  return reason === null ? null : { reason, ms: scaleLockMs(ms, speed, ROOF_LOCK_IN_MS), lastId };
}
