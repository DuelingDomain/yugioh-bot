import type { DuelEvent } from "@yugidraft/shared/duels";

export type DuelEventKind = DuelEvent["kind"];

/** Cap remaining cue time so a burst does not stack full-length playback. */
const CATCH_UP_BUDGET_MS = 1000;
const MIN_CUE_MS = 120;

export function maxEventId(events: readonly DuelEvent[]): number | null {
  let max: number | null = null;
  for (const event of events) {
    if (typeof event.id !== "number") continue;
    if (max == null || event.id > max) max = event.id;
  }
  return max;
}

/**
 * Engine-order events with id > cursor, de-duplicated by id.
 * Cursor advances to the max seen id so polling/reconnect does not replay.
 * Ordinary chain batches are not last-N trimmed; presentation pacing handles backlog.
 */
export function collectFreshEvents(
  events: readonly DuelEvent[],
  cursor: number,
): { nextCursor: number; fresh: DuelEvent[] } {
  const seen = new Set<number>();
  const fresh: DuelEvent[] = [];
  let nextCursor = cursor;
  for (const event of events) {
    if (typeof event.id !== "number" || event.id <= cursor) continue;
    if (seen.has(event.id)) continue;
    seen.add(event.id);
    fresh.push(event);
    if (event.id > nextCursor) nextCursor = event.id;
  }
  fresh.sort((a, b) => a.id - b.id);
  return { nextCursor, fresh };
}

export function cueDuration(kind: DuelEventKind, reducedMotion: boolean): number {
  if (reducedMotion) {
    return kind === "activate" ? 900 : 650;
  }
  switch (kind) {
    case "activate":
      return 1100;
    case "summon":
    case "set":
    case "attack":
      return 720;
    case "phase":
      return 820;
    case "chain-resolving":
      return 520;
    case "chain-resolved":
    case "chain-negated":
      return 640;
    case "chain-end":
      return 420;
    default:
      return 600;
  }
}

export function pacedCueDuration(
  kind: DuelEventKind,
  reducedMotion: boolean,
  remainingCount: number,
): number {
  const base = cueDuration(kind, reducedMotion);
  if (remainingCount <= 1) return base;
  return Math.min(base, Math.max(MIN_CUE_MS, Math.floor(CATCH_UP_BUDGET_MS / remainingCount)));
}
