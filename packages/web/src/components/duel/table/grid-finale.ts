"use client";

import { useEffect, useRef, useState } from "react";
import { EXIT_CRUMBLE_MS } from "./rival-field";

/**
 * The end of a 4-way free-for-all: when two seats are left. After the crumble of the last seat out and a short beat, the
 * last two glide into the composition of the 1v1 room ("FINAL DUEL"): one board in the middle of the table, the bottom
 * seat (you, when you are still in) under the top seat, the other fields gone. Two seats of one facing pair keep their
 * shared Extra Monster row; two seats of different pairs ("cross") keep their own rows, face to face (the engine gives
 * them no shared zones). Pure model first, then the hook that times it.
 */

/** How long the last two take to glide to the full board, and the curve of the glide. */
export const FINALE_GLIDE_MS = 1400;
export const FINALE_GLIDE_EASING = "cubic-bezier(.5,0,.2,1)";
/** The pause between the end of the crumble and the glide. */
export const FINALE_BEAT_MS = 600;
/** How long the caption stays. */
export const CAPTION_MS = 3400;

/** "same": the two left face each other (one pair, one shared Extra Monster row). "cross": they come from two pairs. */
export type FinaleKind = "same" | "cross";

/** The finale board: who sits at the bottom (turned 0) and at the top (turned 180) of the 1v1 composition. */
export interface GridFinaleBoard {
  kind: FinaleKind;
  bottom: number;
  top: number;
}

export interface FinaleCaption {
  kind: FinaleKind;
  /** The two seats left, bottom first. */
  seats: number[];
  /** Changes with every caption, so the animation restarts. */
  id: number;
}

export const CAPTION_TEXT = "FINAL DUEL";

/** Where a seat sits on the grid (see grid-layout.ts `gridCells`). */
export interface FinaleCell {
  seat: number;
  column: 0 | 1;
  row: 0 | 1;
  home: boolean;
}

/**
 * The finale board of two live seats, or null for any other count. The bottom seat: the home seat (you, or a
 * spectator's anchor) when it is one of the two; else the one on the bottom row when only one is; else the one in the
 * home column. The other is the top seat.
 */
export function finaleBoard(live: readonly number[], cells: readonly FinaleCell[]): GridFinaleBoard | null {
  if (live.length !== 2) return null;
  const a = cells.find((cell) => cell.seat === live[0]);
  const b = cells.find((cell) => cell.seat === live[1]);
  if (!a || !b) return null;
  const kind: FinaleKind = a.column === b.column ? "same" : "cross";
  let bottom: FinaleCell;
  if (a.home || b.home) bottom = a.home ? a : b;
  else if (a.row !== b.row) bottom = a.row === 1 ? a : b;
  else {
    const homeColumn = cells.find((cell) => cell.home)?.column ?? 0;
    bottom = a.column === homeColumn ? a : b;
  }
  const top = bottom === a ? b : a;
  return { kind, bottom: bottom.seat, top: top.seat };
}

export interface UseGridFinaleArgs {
  seats: readonly { seat: number; eliminated?: boolean }[];
  cells: readonly FinaleCell[];
  reducedMotion: boolean;
}

/**
 * The finale board (null until the beat has passed) and the caption to show. A table that opens with two seats left (a
 * reload) shows the finale board at once and no caption: nothing happened to see.
 */
export function useGridFinale({ seats, cells, reducedMotion }: UseGridFinaleArgs): { board: GridFinaleBoard | null; caption: FinaleCaption | null } {
  const live = seats.filter((view) => view.eliminated !== true).map((view) => view.seat).sort((a, b) => a - b);
  const key = live.join(",");
  const now = finaleBoard(live, cells);
  const liveCount = useRef(live.length);
  liveCount.current = live.length;
  const [board, setBoard] = useState<GridFinaleBoard | null>(() => now);
  const [caption, setCaption] = useState<FinaleCaption | null>(null);
  const seen = useRef(key);
  const latest = useRef(now);
  latest.current = now;
  // The finale still to show. It lives in a ref so a change of reduced motion mid-wait restarts the timer, not loses it.
  const pending = useRef<GridFinaleBoard | null>(null);
  useEffect(() => {
    if (seen.current !== key) {
      seen.current = key;
      const next = latest.current;
      if (!next) {
        pending.current = null;
        // The last of the two who goes out crumbles on the finale board: only a new duel (more seats) ends it.
        if (liveCount.current > 2) {
          setBoard(null);
          setCaption(null);
        }
        return;
      }
      pending.current = next;
    }
    const todo = pending.current;
    if (!todo) return;
    const wait = reducedMotion ? 0 : EXIT_CRUMBLE_MS + FINALE_BEAT_MS;
    const timer = window.setTimeout(() => {
      pending.current = null;
      setCaption({ kind: todo.kind, seats: [todo.bottom, todo.top], id: Date.now() });
      setBoard(todo);
    }, wait);
    return () => window.clearTimeout(timer);
  }, [key, reducedMotion]);
  useEffect(() => {
    if (!caption) return;
    const timer = window.setTimeout(() => setCaption(null), reducedMotion ? 2600 : CAPTION_MS);
    return () => window.clearTimeout(timer);
  }, [caption, reducedMotion]);
  return { board, caption };
}
