"use client";

import { useEffect, useState } from "react";
import type { DuelOpeningView } from "@yugidraft/shared/duels";
import { revealEndsAt } from "./opening-model";

/**
 * Server time plus monotonic elapsed time; ticks countdowns and ends reveals without a poll.
 * `tickMs` is how often it samples while the opening is live (the dice screen needs a faster tick than a countdown).
 */
export function useNow(opening: DuelOpeningView, receivedAt?: number, tickMs = 500): number | null {
  // A remount from a cached room starts at the sampled server time, not at the old `serverNow`.
  const [clock, setClock] = useState(() => ({ opening, receivedAt, now: opening.serverNow == null ? null : sampleServerNow(opening, receivedAt) }));
  useEffect(() => {
    const serverNow = opening.serverNow ?? Date.now();
    // Browser time already includes the cache age when an older host omits serverNow.
    const at = opening.serverNow == null ? performance.now() : receivedAt ?? performance.now();
    const sample = () => serverNow + (performance.now() - at);
    const update = () => setClock({ opening, receivedAt, now: sample() });
    update();
    if (opening.phase === "start") return undefined;
    const interval = window.setInterval(update, tickMs);
    const end = "rounds" in opening ? Date.parse(opening.deadlineAt) : revealEndsAt(opening);
    const wait = end - sample();
    const timer = wait > 0 ? window.setTimeout(update, wait + 20) : undefined;
    return () => {
      window.clearInterval(interval);
      if (timer != null) window.clearTimeout(timer);
    };
  }, [opening, receivedAt, tickMs]);
  return (clock.opening === opening && clock.receivedAt === receivedAt ? clock.now : opening.serverNow) ?? null;
}

/** The server clock right now: `serverNow` plus the monotonic time since the room response arrived. */
export function sampleServerNow(opening: DuelOpeningView, receivedAt?: number): number {
  if (opening.serverNow == null) return Date.now();
  return opening.serverNow + (performance.now() - (receivedAt ?? performance.now()));
}
