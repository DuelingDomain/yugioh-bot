"use client";

import { useEffect, useMemo, useState } from "react";
import type { DuelClock } from "@yugidraft/shared/duels";
import { clockReceivedAt, liveClockMs } from "./clock-beep";

const TICK_MS = 250;

/**
 * The time left on one seat's clock, ticking like the HUD clock bank does. `remainingMs` of a snapshot is the bank at
 * `startedAt`, so the answering seat's real time is that minus what ran since (`serverNow` of the snapshot plus the
 * time passed here since it arrived). Every new snapshot (a new `clock` object) restarts the count, so a state change
 * never shows an old tick. `null` when the duel has no clock or the seat has no entry.
 */
export function useLiveClockMs(clock: DuelClock | null | undefined, seat: number): number | null {
  const [tick, setTick] = useState<{ clock: DuelClock; elapsed: number } | null>(null);
  const running = clock != null && clock.activeSeat === seat && clock.startedAt != null;
  useEffect(() => {
    if (!clock || !running) return;
    const receivedAt = clockReceivedAt(clock);
    setTick({ clock, elapsed: performance.now() - receivedAt });
    const timer = window.setInterval(() => setTick({ clock, elapsed: performance.now() - receivedAt }), TICK_MS);
    return () => window.clearInterval(timer);
  }, [clock, running]);
  if (!clock) return null;
  const ms = liveClockMs(clock, seat, tick != null && tick.clock === clock ? tick.elapsed : 0);
  return Number.isFinite(ms) ? ms : null;
}

/** The old snapshot stops ticking as soon as an action is submitted; the reply replaces it. */
export function useServerWaitClock(clock: DuelClock | null | undefined, waiting: boolean): DuelClock | null | undefined {
  return useMemo(() => {
    if (!clock || !waiting) return clock;
    const elapsed = performance.now() - clockReceivedAt(clock);
    return {
      ...clock,
      remainingMs: clock.remainingMs.map((_, seat) => liveClockMs(clock, seat, elapsed)),
      activeSeat: null,
      startedAt: null,
    };
  }, [clock, waiting]);
}
