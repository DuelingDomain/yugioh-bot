import { useEffect, useLayoutEffect, useState, type RefObject } from "react";
import { DURATION, inputWasKeyboard, prefersReducedMotion, trackInputModality } from "@/lib/motion";

/**
 * Tab motion ("quick and quiet", part 4). Two pieces, both CSS-driven (rules in app/globals.css):
 *
 * - Panels. `useTabDirection` says which way a switch travelled; put the result on the panel as
 *   `data-pane-dir` (see `data-pane` in globals.css). The arriving panel fades in over 180ms with an
 *   8px slide from the side the tab is on. There is no exit, so new content is never held back.
 * - A sliding marker. Equal-width tab rows slide a pseudo-element with `segmentSlide` (CSS vars, so
 *   it is right on the server). Rows whose tabs differ in width use `useTabMarker`, which measures.
 */

export type PaneDirection = "next" | "prev";

/** Which way a switch went along `order`, or undefined when either end is not in it. */
export function paneDirection<T>(order: readonly T[], from: T, to: T): PaneDirection | undefined {
  const a = order.indexOf(from);
  const b = order.indexOf(to);
  if (a < 0 || b < 0 || a === b) return undefined;
  return b > a ? "next" : "prev";
}

/**
 * The direction of the latest switch of `value` along `order`, for the panel's `data-pane-dir`.
 * Undefined until the first switch, so first paint never animates, and for a switch made from the
 * keyboard (arrowing through tabs repeats all day) or under reduced motion. It is decided in the
 * same render the new panel mounts, so the panel's first frame already has it. It clears once the
 * arrival has played, so a part of the panel that mounts later (results, a list) does not slide.
 * `enabled` is false for a change nobody chose by hand (a hover or a pin flipping a view).
 */
export function useTabDirection<T>(value: T, order: readonly T[], enabled = true): PaneDirection | undefined {
  const [seen, setSeen] = useState<{ value: T; dir: PaneDirection | undefined }>({ value, dir: undefined });
  if (seen.value !== value) {
    const dir = !enabled || inputWasKeyboard() || prefersReducedMotion() ? undefined : paneDirection(order, seen.value, value);
    setSeen({ value, dir });
  }
  // Listen for keys from the first paint, so the very first switch already knows how it was made.
  useEffect(() => trackInputModality(), []);
  const playing = seen.dir !== undefined;
  useEffect(() => {
    if (!playing) return;
    const timer = setTimeout(() => setSeen((now) => (now.dir ? { value: now.value, dir: undefined } : now)), DURATION.paneIn + 60);
    return () => clearTimeout(timer);
  }, [playing, seen.value]);
  return seen.dir;
}

/** The place and width of the selected tab (or pressed button) inside its row, or null when none is. */
export function measureTab(list: HTMLElement): { x: number; w: number } | null {
  const tab = list.querySelector<HTMLElement>('[role="tab"][aria-selected="true"], button[aria-pressed="true"]');
  return tab ? { x: tab.offsetLeft, w: tab.offsetWidth } : null;
}

function placeMarker(list: HTMLElement): void {
  const spot = measureTab(list);
  if (!spot) {
    list.removeAttribute("data-marker");
    return;
  }
  list.style.setProperty("--tab-x", `${spot.x}px`);
  list.style.setProperty("--tab-w", String(spot.w));
  list.setAttribute("data-marker", "");
}

/**
 * A sliding underline or fill for a tab row whose tabs differ in width. Put the ref on the row (it
 * must be `position: relative`). An underline is a `<span data-tab-marker aria-hidden />` inside it;
 * a `.seg` row uses its `::before` (`data-seg-measured`, match-sheet.css). The hook writes `--tab-x`
 * and `--tab-w` on the row and turns the marker on with `data-marker`; the CSS moves it with
 * transform only (translate and scaleX). The first placement and any re-measure
 * after a resize happen with the transition off, so only a change of tab slides, and it is
 * interruptible because it is a plain transition.
 */
export function useTabMarker(listRef: RefObject<HTMLElement | null>, selected: string): void {
  useLayoutEffect(() => {
    const list = listRef.current;
    if (list) placeMarker(list);
  }, [listRef, selected]);

  // Slide only from the second placement on: motion turns on a frame after the first one.
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const frame = requestAnimationFrame(() => list.setAttribute("data-marker-motion", ""));
    return () => cancelAnimationFrame(frame);
  }, [listRef]);

  useEffect(() => {
    const list = listRef.current;
    if (!list || typeof ResizeObserver === "undefined") return;
    let frame = 0;
    const observer = new ResizeObserver(() => {
      // A resize is a re-measure, not a move: no slide for it.
      list.removeAttribute("data-marker-motion");
      placeMarker(list);
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => list.setAttribute("data-marker-motion", ""));
    });
    observer.observe(list);
    // Tabs can change width without the row doing so (a web font arriving, a badge appearing).
    for (const child of Array.from(list.children)) observer.observe(child);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [listRef]);
}
