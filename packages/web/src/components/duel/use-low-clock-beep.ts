"use client";

import { useEffect, useRef } from "react";
import type { DuelClock } from "@yugidraft/shared/duels";
import { createLowClockWatcher, liveClockMs } from "./clock-beep";
import { emitDuelFxCue } from "./event-queue";

const TICK_MS = 250;

/**
 * Beeps once when the viewer's OWN clock reaches 1:00. The sound goes through the duel feedback audio
 * (DUEL_FX_CUE_EVENT), so the sound switch and the volume slider apply to it as to every other cue.
 * `seat` is null for a spectator or a replay: nothing is watched then. A clock that is already under 1:00
 * when the duel loads stays quiet, and a clock reset above 1:00 can beep again when it crosses again.
 */
export function useLowClockBeep({ clock, seat, soundEnabled }: { clock: DuelClock | null | undefined; seat: number | null; soundEnabled: boolean }): void {
  const watcher = useRef(createLowClockWatcher());
  const receivedAt = useRef<{ clock: DuelClock; at: number } | null>(null);
  const soundRef = useRef(soundEnabled);
  soundRef.current = soundEnabled;

  useEffect(() => {
    if (!clock || seat == null) {
      watcher.current.next(null, false);
      receivedAt.current = null;
      return;
    }
    // Each authoritative snapshot restarts the elapsed time, like the clock display does.
    receivedAt.current = { clock, at: performance.now() };
    const read = () => {
      const held = receivedAt.current;
      if (!held) return;
      const live = liveClockMs(held.clock, seat, performance.now() - held.at);
      if (watcher.current.next(live, soundRef.current)) emitDuelFxCue({ cue: "clock-low", strength: 1 });
    };
    read();
    const running = clock.activeSeat === seat && clock.startedAt != null;
    if (!running) return;
    const timer = window.setInterval(read, TICK_MS);
    return () => window.clearInterval(timer);
  }, [clock, seat]);
}
