"use client";

import { useCallback, useEffect, useRef } from "react";
import { duelFxClock } from "./fx-clock";

/** How often a waiting view change looks again for a quiet board, and the longest it waits (duel time, ms). */
export const QUIET_POLL_MS = 100;
export const QUIET_WAIT_CAP_MS = 3000;

/**
 * Applies a change of the board look (3D mode, Tilt or Flat) only when nothing is moving on the board
 * (`boardQuiet`, see `boardQuietNow`), so a flight or a slam never re-lays out in the middle of its path.
 * While the board is busy it looks again every 100 ms through the FX clock and applies anyway after 3 s.
 * `onBefore` runs right before the change (close the card menu and the hover info). A newer request
 * replaces one that still waits.
 */
export function useQuietViewChange(boardQuiet: () => boolean, onBefore: () => void): (apply: () => void) => void {
  const latest = useRef({ boardQuiet, onBefore });
  latest.current = { boardQuiet, onBefore };
  const timer = useRef<number | null>(null);
  const cancel = useCallback(() => {
    if (timer.current != null) duelFxClock.clearInterval(timer.current);
    timer.current = null;
  }, []);
  useEffect(() => cancel, [cancel]);
  return useCallback((apply: () => void) => {
    cancel();
    const run = () => {
      cancel();
      latest.current.onBefore();
      apply();
    };
    if (latest.current.boardQuiet()) {
      run();
      return;
    }
    const since = duelFxClock.now();
    timer.current = duelFxClock.setInterval(() => {
      if (latest.current.boardQuiet() || duelFxClock.now() - since >= QUIET_WAIT_CAP_MS) run();
    }, QUIET_POLL_MS);
  }, [cancel]);
}
