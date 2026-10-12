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

/** Events a player causes by acting: the actor is `event.seat`. A destroy or a move names the owner of the card, not who acted. */
const ACTOR_KINDS: ReadonlySet<DuelEvent["kind"]> = new Set(["activate", "chain-resolving", "summon", "set", "attack"]);

/**
 * True when another player acted since `afterId`: an actor event of a seat that is neither the viewer nor the field in
 * close-up (`focusSeat`, null when no field is). It is the one reason the Rooftop camera moves by itself, and it only
 * moves out: the shell sends the camera to the overview once and leaves it there.
 */
export function otherPlayerActed(events: readonly DuelEvent[], afterId: number, viewerSeat: number | null, focusSeat: number | null): boolean {
  return events.some((event) => event.id > afterId && ACTOR_KINDS.has(event.kind) && event.seat != null && event.seat !== viewerSeat && event.seat !== focusSeat);
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
