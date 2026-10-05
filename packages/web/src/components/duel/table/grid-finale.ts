"use client";

import { useEffect, useRef, useState } from "react";
import { EXIT_CRUMBLE_MS } from "./rival-field";

/**
 * The end of a 4-way free-for-all: when two seats are left.
 * Both on the same facing pair: after the crumble and a short beat the pair grows to one full 1v1 board ("FINAL DUEL").
 * On different pairs nothing moves ("LAST TWO REMAINING"). Pure model first, then the hook that times it.
 */

/** How long the pair takes to glide to the full board, and the curve of the glide. */
export const FINALE_GLIDE_MS = 1400;
export const FINALE_GLIDE_EASING = "cubic-bezier(.5,0,.2,1)";
/** The pause between the end of the crumble and the glide. */
export const FINALE_BEAT_MS = 600;
/** How long the caption stays. */
export const CAPTION_MS = 3400;

export type FinaleKind = "final" | "last";

export interface FinaleCaption {
  kind: FinaleKind;
  /** The two seats left. */
  seats: number[];
  /** Changes with every caption, so the animation restarts. */
  id: number;
}

export const CAPTION_TEXT: Record<FinaleKind, string> = { final: "FINAL DUEL", last: "LAST TWO REMAINING" };

/** What two live seats mean: one facing pair (the finale board of that column) or two pairs. Null for any other count. */
export function lastTwo(live: readonly number[], columnOf: ReadonlyMap<number, 0 | 1>): { kind: FinaleKind; column: 0 | 1 | null } | null {
  if (live.length !== 2) return null;
  const a = columnOf.get(live[0]);
  const b = columnOf.get(live[1]);
  if (a == null || b == null) return null;
  return a === b ? { kind: "final", column: a } : { kind: "last", column: null };
}

export interface UseGridFinaleArgs {
  seats: readonly { seat: number; eliminated?: boolean }[];
  columnOf: ReadonlyMap<number, 0 | 1>;
  reducedMotion: boolean;
}

/**
 * The column that is laid out as the finale board (null until the beat has passed) and the caption to show. A table
 * that opens with two seats left (a reload) shows the finale board at once and no caption: nothing happened to see.
 */
export function useGridFinale({ seats, columnOf, reducedMotion }: UseGridFinaleArgs): { column: 0 | 1 | null; caption: FinaleCaption | null } {
  const live = seats.filter((view) => view.eliminated !== true).map((view) => view.seat).sort((a, b) => a - b);
  const key = live.join(",");
  const now = lastTwo(live, columnOf);
  const [column, setColumn] = useState<0 | 1 | null>(() => (now?.kind === "final" ? now.column : null));
  const [caption, setCaption] = useState<FinaleCaption | null>(null);
  const seen = useRef(key);
  const latest = useRef({ now, live });
  latest.current = { now, live };
  useEffect(() => {
    if (seen.current === key) return;
    seen.current = key;
    const { now: next, live: seats2 } = latest.current;
    if (!next) {
      setColumn(null);
      setCaption(null);
      return;
    }
    const wait = reducedMotion ? 0 : EXIT_CRUMBLE_MS + FINALE_BEAT_MS;
    const timer = window.setTimeout(() => {
      setCaption({ kind: next.kind, seats: seats2, id: Date.now() });
      setColumn(next.kind === "final" ? next.column : null);
    }, wait);
    return () => window.clearTimeout(timer);
  }, [key, reducedMotion]);
  useEffect(() => {
    if (!caption) return;
    const timer = window.setTimeout(() => setCaption(null), reducedMotion ? 2600 : CAPTION_MS);
    return () => window.clearTimeout(timer);
  }, [caption, reducedMotion]);
  return { column, caption };
}
