import type { DuelEvent } from "@yugidraft/shared/duels";
import type { CameraLockReason } from "../table/types";

/**
 * The camera lock of the Rooftop. While an attack, a chain link or a destroy plays, the camera eases to the play view
 * and ignores input until the lock ends. The shell passes the events newer than the last one it handled.
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

/** The newest event id, or `afterId` when there is none. A caller that skips the lock still moves its cursor with this. */
export function lastEventId(events: readonly DuelEvent[], afterId: number): number {
  return events.reduce((last, event) => Math.max(last, event.id), afterId);
}

/**
 * Lock for the events with an id above `afterId`: the strongest reason, the longest time. Null when none locks.
 * With reduced motion the camera never locks (no eased move, no input freeze); use `lastEventId` for the cursor.
 */
export function lockForEvents(events: readonly DuelEvent[], afterId: number, reducedMotion = false): FxLock | null {
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
  return reason === null ? null : { reason, ms, lastId };
}
