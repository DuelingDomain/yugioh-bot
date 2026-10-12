"use client";

import { useEffect, useRef, useState } from "react";
import { crumbleWaiting, onCrumbleStart } from "./crumble-gate";
import { EXIT_CRUMBLE_MS } from "./rival-field";

/**
 * The end of a 3-way or 4-way free-for-all: when two seats are left, a caption says "FINAL DUEL" and names them. Nothing
 * moves: the fields stay where they are, and the place of a seat that is out stays empty. The caption shows after the
 * crumble of the last seat out and a short beat.
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
}

/**
 * The caption to show, or null. A table that opens with two seats left (a reload) shows no caption: nothing happened to see.
 */
export function useFinalDuelCaption({ seats, viewerSeat, reducedMotion }: UseFinalDuelCaptionArgs): FinaleCaption | null {
  const live = seats.filter((view) => view.eliminated !== true).map((view) => view.seat).sort((a, b) => a - b);
  const key = live.join(",");
  const now = finalDuelSeats(live, viewerSeat);
  const [caption, setCaption] = useState<FinaleCaption | null>(null);
  const seen = useRef(key);
  const latest = useRef(now);
  latest.current = now;
  // The caption still to show. It lives in a ref so a change of reduced motion mid-wait restarts the timer, not loses it.
  const pending = useRef<number[] | null>(null);
  useEffect(() => {
    if (seen.current !== key) {
      seen.current = key;
      pending.current = latest.current;
      if (!latest.current) setCaption(null);
    }
    const todo = pending.current;
    if (!todo) return;
    const wait = reducedMotion ? 0 : EXIT_CRUMBLE_MS + FINALE_BEAT_MS;
    let timer: number | undefined;
    const start = () => {
      timer = window.setTimeout(() => {
        pending.current = null;
        setCaption({ seats: todo, id: Date.now() });
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
  return caption;
}
