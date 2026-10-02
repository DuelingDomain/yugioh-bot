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

/** Lock for the events with an id above `afterId`: the strongest reason, the longest time. Null when none locks. */
export function lockForEvents(events: readonly DuelEvent[], afterId: number): FxLock | null {
  let best: FxLock | null = null;
  let lastId = afterId;
  for (const event of events) {
    if (event.id <= afterId) continue;
    lastId = Math.max(lastId, event.id);
    const reason = reasonOf(event);
    if (!reason) continue;
    const ms = TIMES[reason];
    if (!best || PRIORITY[reason] > PRIORITY[best.reason]) best = { reason, ms: Math.max(ms, best?.ms ?? 0), lastId };
    else best = { ...best, ms: Math.max(best.ms, ms), lastId };
  }
  return best ? { ...best, lastId } : null;
}
