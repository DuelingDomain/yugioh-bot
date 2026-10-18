"use client";

import { useCallback, useEffect, useMemo, useRef, type PointerEvent } from "react";

/** A finger must rest this long on a tile before it counts as a long press. */
const LONG_PRESS_MS = 450;
/** A finger that moves further than this is scrolling or dragging. */
const SLOP = 10;
/** The click or contextmenu of a finished long press comes right after it; the flag stays this long. */
const SETTLE_MS = 400;

/**
 * A long press with a finger or a pen on a card tile. It runs `onLong` for that card and says, through `fired()`,
 * that the click and the contextmenu that follow it must do nothing (a long press also sends a contextmenu on Android).
 * A mouse never starts one.
 */
export function useTileLongPress<T>(onLong: (item: T) => void) {
  const timer = useRef<number | undefined>(undefined);
  const settle = useRef<number | undefined>(undefined);
  const origin = useRef<{ x: number; y: number } | null>(null);
  const done = useRef(false);
  const handler = useRef(onLong);
  handler.current = onLong;

  const cancel = useCallback(() => {
    window.clearTimeout(timer.current);
    timer.current = undefined;
    origin.current = null;
  }, []);
  useEffect(() => () => { cancel(); window.clearTimeout(settle.current); }, [cancel]);

  return useMemo(() => ({
    bind: (item: T) => ({
      onPointerDown(event: PointerEvent) {
        window.clearTimeout(settle.current);
        done.current = false;
        cancel();
        if (event.pointerType !== "touch" && event.pointerType !== "pen") return;
        origin.current = { x: event.clientX, y: event.clientY };
        timer.current = window.setTimeout(() => {
          timer.current = undefined;
          done.current = true;
          handler.current(item);
        }, LONG_PRESS_MS);
      },
      onPointerMove(event: PointerEvent) {
        const start = origin.current;
        if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > SLOP) cancel();
      },
      onPointerUp() {
        cancel();
        if (done.current) settle.current = window.setTimeout(() => { done.current = false; }, SETTLE_MS);
      },
      onPointerCancel() { cancel(); },
    }),
    /** True while a finished long press still owns the click and contextmenu that follow it. */
    fired: () => done.current,
  }), [cancel]);
}
