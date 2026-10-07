"use client";

import { useEffect, useRef } from "react";
import type { DuelClock } from "@yugidraft/shared/duels";
import { LOW_CLOCK_MS, createLowClockWatcher, liveClockMs } from "./clock-beep";
import { emitDuelFxCue } from "./event-queue";

const TICK_MS = 250;
/** A crossing the audio could not play yet (not mounted while the room recovers, or still locked) is tried again for this long. */
export const PENDING_BEEP_MS = 10_000;

/**
 * Beeps once when the viewer's OWN clock reaches 1:00. The sound goes through the duel feedback audio
 * (DUEL_FX_CUE_EVENT), so the sound switch and the volume slider apply to it as to every other cue.
 * `seat` is null for a spectator or a replay: nothing is watched then. A clock that is already under 1:00
 * when the duel loads stays quiet, and a clock reset above 1:00 can beep again when it crosses again.
 * The feedback layer unmounts while the room recovers, and its audio can still be locked after it mounts again:
 * a crossing in that window stays pending and is retried until the cue is taken (or PENDING_BEEP_MS pass).
 */
export function useLowClockBeep({ clock, seat, soundEnabled }: { clock: DuelClock | null | undefined; seat: number | null; soundEnabled: boolean }): void {
  const watcher = useRef(createLowClockWatcher());
  const receivedAt = useRef<{ clock: DuelClock; at: number } | null>(null);
  const pendingUntil = useRef(0);
  const lastSeat = useRef<number | null>(null);
  const soundRef = useRef(soundEnabled);
  soundRef.current = soundEnabled;

  useEffect(() => {
    if (!clock || seat == null) {
      watcher.current.next(null, false);
      receivedAt.current = null;
      pendingUntil.current = 0;
      lastSeat.current = null;
      return;
    }
    // Another seat has another clock: its first reading is a new baseline, never a crossing.
    if (lastSeat.current !== seat) {
      watcher.current.next(null, false);
      pendingUntil.current = 0;
      lastSeat.current = seat;
    }
    // Each authoritative snapshot restarts the elapsed time, like the clock display does.
    receivedAt.current = { clock, at: performance.now() };
    const running = clock.activeSeat === seat && clock.startedAt != null;
    let timer: number | null = null;
    const stop = () => {
      if (timer != null) window.clearInterval(timer);
      timer = null;
    };
    const read = () => {
      const held = receivedAt.current;
      if (!held) return;
      const now = performance.now();
      const live = liveClockMs(held.clock, seat, now - held.at);
      if (watcher.current.next(live, soundRef.current)) pendingUntil.current = now + PENDING_BEEP_MS;
      // The clock went back above 1:00, or the sound was switched off: the old crossing no longer counts.
      if (live > LOW_CLOCK_MS || !soundRef.current) pendingUntil.current = 0;
      if (pendingUntil.current > 0) {
        if (now > pendingUntil.current) pendingUntil.current = 0;
        else if (emitDuelFxCue({ cue: "clock-low", strength: 1 })) pendingUntil.current = 0;
      }
      if (!running && pendingUntil.current === 0) stop();
    };
    read();
    if (running || pendingUntil.current > 0) timer = window.setInterval(read, TICK_MS);
    return stop;
  }, [clock, seat]);
}
