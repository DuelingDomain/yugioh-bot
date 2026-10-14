"use client";

import { useEffect, useRef, useState } from "react";
import { crumbleWaiting, onCrumbleStart } from "./crumble-gate";
import { EXIT_CRUMBLE_MS } from "./rival-field";

/**
 * The end of a 3-way or 4-way free-for-all: when two seats are left, a caption says "FINAL DUEL" and names them. The
 * caption shows after the crumble of the last seat out and a short beat; the fields of the two seats left face each other
 * at the same moment (a visual change only: grid-finale.ts for the 4-way grid, `aliveLayout` for the 3-way plaza). The
 * rules do not change: the facing pairs stay as they were.
 */

/** The pause between the end of the crumble and the caption. */
export const FINALE_BEAT_MS = 600;
/** How long the caption stays. */
export const CAPTION_MS = 3400;

export interface FinaleCaption {
  /** The two seats left: the viewer first when it is one of them, else in seat order. */
  seats: number[];
  /** Changes with every caption, so the animation restarts. */
  id: number;
}

export const CAPTION_TEXT = "FINAL DUEL";

/** The two live seats in caption order, or null for any other count. */
export function finalDuelSeats(live: readonly number[], viewerSeat: number | null): number[] | null {
  if (live.length !== 2) return null;
  const sorted = [...live].sort((a, b) => a - b);
  return viewerSeat != null && sorted[1] === viewerSeat ? [sorted[1], sorted[0]] : sorted;
}

export interface UseFinalDuelCaptionArgs {
  seats: readonly { seat: number; eliminated?: boolean }[];
  viewerSeat: number | null;
  reducedMotion: boolean;
  /** Changes with the duel (and the game of a series): the state starts again as already seen, with no caption. */
  resetKey?: string;
}

export interface FinalDuel {
  caption: FinaleCaption | null;
  /**
   * The two seats left, in seat order, from the moment the face-off starts (the crumble of the last seat out and the beat),
   * or null. A table that opens with two seats left has them at once. It stays when the last seat goes out (that seat
   * crumbles on the face-off); only a new duel with more seats ends it.
   */
  reached: readonly number[] | null;
}

/**
 * The caption to show and the face-off to draw. A table that opens with two seats left (a reload, a new game) has the
 * face-off at once and no caption: nothing happened to see.
 */
export function useFinalDuel({ seats, viewerSeat, reducedMotion, resetKey = "" }: UseFinalDuelCaptionArgs): FinalDuel {
  const live = seats.filter((view) => view.eliminated !== true).map((view) => view.seat).sort((a, b) => a - b);
  const key = live.join(",");
  const now = finalDuelSeats(live, viewerSeat);
  const [caption, setCaption] = useState<FinaleCaption | null>(null);
  const [reached, setReached] = useState<readonly number[] | null>(() => (live.length === 2 ? live : null));
  const seen = useRef(key);
  const latest = useRef(now);
  latest.current = now;
  const liveCount = useRef(live.length);
  liveCount.current = live.length;
  const liveSeats = useRef(live);
  liveSeats.current = live;
  // The caption still to show. It lives in a ref so a change of reduced motion mid-wait restarts the timer, not loses it.
  const pending = useRef<number[] | null>(null);
  // A new duel (or game): what was seen starts again.
  const lastReset = useRef(resetKey);
  if (lastReset.current !== resetKey) {
    lastReset.current = resetKey;
    seen.current = key;
    pending.current = null;
    setCaption(null);
    setReached(live.length === 2 ? live : null);
  }
  useEffect(() => {
    if (seen.current !== key) {
      seen.current = key;
      pending.current = latest.current;
      if (!latest.current) {
        setCaption(null);
        // The last of the two who goes out crumbles on the face-off: only more seats (a new duel) end it.
        if (liveCount.current > 2) setReached(null);
      }
    }
    const todo = pending.current;
    if (!todo) return;
    const wait = reducedMotion ? 0 : EXIT_CRUMBLE_MS + FINALE_BEAT_MS;
    let timer: number | undefined;
    const start = () => {
      timer = window.setTimeout(() => {
        pending.current = null;
        setCaption({ seats: todo, id: Date.now() });
        if (liveSeats.current.length === 2) setReached(liveSeats.current);
      }, wait);
    };
    // A crumble that waits for the battle (crumble-gate.ts) starts late: the wait counts from its start.
    let stop: () => void = () => undefined;
    if (crumbleWaiting()) {
      stop = onCrumbleStart(() => {
        stop();
        start();
      });
    } else {
      start();
    }
    return () => {
      stop();
      window.clearTimeout(timer);
    };
  }, [key, reducedMotion]);
  useEffect(() => {
    if (!caption) return;
    const timer = window.setTimeout(() => setCaption(null), reducedMotion ? 2600 : CAPTION_MS);
    return () => window.clearTimeout(timer);
  }, [caption, reducedMotion]);
  return { caption, reached };
}

/** The caption alone (the stages that draw no face-off do not need the rest). */
export function useFinalDuelCaption(args: UseFinalDuelCaptionArgs): FinaleCaption | null {
  return useFinalDuel(args).caption;
}
