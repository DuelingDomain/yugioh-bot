import type { DuelClock } from "@yugidraft/shared/duels";

/** The warning fires when the viewer's own clock reaches this much time left. */
export const LOW_CLOCK_MS = 60_000;

/** Whole seconds a clock shows for `ms` left: rounded up, so the HUD bank and the player plates change on the same tick. */
export function clockSeconds(ms: number): number {
  return Math.ceil(Math.max(0, ms) / 1000);
}

/** A clock is low (red) when the seconds it shows are at the limit or under. */
export function isLowClock(ms: number, limitMs: number = LOW_CLOCK_MS): boolean {
  return clockSeconds(ms) <= limitMs / 1000;
}

const receivedAtByClock = new WeakMap<DuelClock, number>();

/** When this client first saw the snapshot (`performance.now()`). The HUD bank and the plates share it, so they count the same elapsed time. */
export function clockReceivedAt(clock: DuelClock): number {
  let at = receivedAtByClock.get(clock);
  if (at == null) {
    at = performance.now();
    receivedAtByClock.set(clock, at);
  }
  return at;
}

/** Time left on a seat's clock at `at` (the client's `performance.now()` clock, offset by `receivedAt`). */
export function liveClockMs(clock: DuelClock, seat: number, elapsedMs: number): number {
  const remaining = clock.remainingMs[seat];
  if (remaining == null) return Number.POSITIVE_INFINITY;
  const running = clock.activeSeat === seat && clock.startedAt != null;
  return Math.max(0, remaining - (running ? Math.max(0, clock.serverNow + elapsedMs - clock.startedAt!) : 0));
}

/**
 * Finds the moment a clock crosses from above the limit to the limit or below.
 * Feed it the viewer's live time on every tick. `null` means "no own clock to watch" (a spectator, a replay,
 * no clock at all) and forgets the baseline, so the next real value never counts as a crossing.
 * The first value after a baseline is lost is only a baseline: a duel that loads under 1:00 stays quiet.
 * A clock that is reset above the limit arms the watcher again.
 */
export function createLowClockWatcher(limitMs: number = LOW_CLOCK_MS) {
  let previous: number | null = null;
  return {
    /** Returns true when this reading is a new crossing and `audible` is on. Silence still moves the baseline. */
    next(liveMs: number | null, audible: boolean): boolean {
      if (liveMs == null || !Number.isFinite(liveMs)) {
        previous = null;
        return false;
      }
      const crossed = previous != null && previous > limitMs && liveMs <= limitMs;
      previous = liveMs;
      return crossed && audible;
    },
  };
}

export type LowClockWatcher = ReturnType<typeof createLowClockWatcher>;

/** The seat this viewer plays, or null when there is nothing of their own to warn about. */
export function ownClockSeat(opts: { mySeat: number | null | undefined; spectator: boolean; replay: boolean }): number | null {
  if (opts.spectator || opts.replay) return null;
  return opts.mySeat == null ? null : opts.mySeat;
}
