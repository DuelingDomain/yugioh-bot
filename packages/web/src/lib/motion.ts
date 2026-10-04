import { useEffect, useState, useSyncExternalStore } from "react";

/**
 * Site motion helpers ("quick and quiet"). Client-side only: every function that touches the DOM
 * guards for a missing window, matchMedia or Element.animate (jsdom has none of them).
 *
 * The CSS tokens live in app/globals.css (`--ease-*`, `--d-*`, `--motion-*`). WAAPI easings cannot
 * use var(), so the values JS needs are mirrored here; tests/lib/motion.test.ts checks they agree.
 * Only transform and opacity animate. Reduced motion means a short opacity fade or nothing at all.
 */

export const EASE_OUT = "cubic-bezier(0.23, 1, 0.32, 1)";
export const EASE_IN_OUT = "cubic-bezier(0.77, 0, 0.175, 1)";
export const EASE_DRAWER = "cubic-bezier(0.32, 0.72, 0, 1)";

/** Milliseconds; same numbers as the `--d-*` tokens. */
export const DURATION = {
  pageIn: 200,
  flip: 300,
  /** The only duration used under reduced motion. */
  reduced: 140,
} as const;

const REDUCED_QUERY = "(prefers-reduced-motion: reduce)";

/** One-shot read of the reduced-motion preference. False when it can't be read. */
export function prefersReducedMotion(): boolean {
  try {
    return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(REDUCED_QUERY).matches === true;
  } catch {
    return false;
  }
}

function subscribeReduced(onChange: () => void): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
  const query = window.matchMedia(REDUCED_QUERY);
  if (typeof query?.addEventListener !== "function") return () => {};
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/**
 * The reduced-motion preference as live state. The server snapshot is `false`, so the first client
 * render matches the server and React corrects it right after hydration.
 */
export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(subscribeReduced, prefersReducedMotion, () => false);
}

export type Presence = { mounted: boolean; state: "open" | "closed" };

/**
 * Keeps an overlay mounted while it plays its exit. `mounted` turns true the moment `open` does
 * (the same render, so there is no empty first frame). `state` is "open" from that first render, so
 * the enter has to be a CSS `@keyframes` on `[data-state="open"]`, not a transition. When `open`
 * goes false, `state` turns "closed" at once (play the exit on `[data-state="closed"]`) and
 * `mounted` follows after `exitMs`. Opening again during the exit cancels the unmount. Under reduced
 * motion no timer runs: it unmounts on the next frame.
 *
 * Release the focus trap and `inert` when `open` goes false, not when `mounted` does.
 */
export function usePresence(open: boolean, exitMs: number): Presence {
  const reduced = usePrefersReducedMotion();
  const [exited, setExited] = useState(!open);

  // Adjusting state while rendering is the supported way to derive it from a prop.
  if (open && exited) setExited(false);

  useEffect(() => {
    if (open || exited) return;
    if (reduced) {
      const frame = requestAnimationFrame(() => setExited(true));
      return () => cancelAnimationFrame(frame);
    }
    const timer = setTimeout(() => setExited(true), exitMs);
    return () => clearTimeout(timer);
  }, [open, exited, reduced, exitMs]);

  return { mounted: open || !exited, state: open ? "open" : "closed" };
}

// ---------------------------------------------------------------------------------------------
// FLIP
// ---------------------------------------------------------------------------------------------

export type FlipOptions = {
  /** Milliseconds. Default `DURATION.flip`. */
  duration?: number;
  /** A CSS easing string. Default `EASE_IN_OUT`, because the elements are already on screen. */
  easing?: string;
};

/** Where each element was, measured before a change. */
export type FlipSnapshot = Map<Element, { left: number; top: number }>;

const running = new WeakMap<Element, Animation>();

function canAnimate(el: Element): boolean {
  return typeof (el as HTMLElement).animate === "function";
}

/**
 * Reads where each element is on screen right now. A FLIP still in flight is included, so a second
 * change starts from where the element visibly is. Reads only; call it before the change.
 */
export function measureFlip(elements: Iterable<Element>): FlipSnapshot {
  const snapshot: FlipSnapshot = new Map();
  for (const el of elements) {
    const rect = el.getBoundingClientRect();
    snapshot.set(el, { left: rect.left, top: rect.top });
  }
  return snapshot;
}

/**
 * Plays the move from a snapshot to where the elements are now (transform: translate only).
 * Call it after the change has reached the DOM (in a layout effect for React state). Cancels any
 * FLIP still running on the same element first, so layouts are read with no stale transform.
 * Does nothing under reduced motion or without Element.animate.
 */
export function playFlip(first: FlipSnapshot, options: FlipOptions = {}): void {
  const reduced = prefersReducedMotion();
  const moves: Array<[HTMLElement, number, number]> = [];
  for (const el of first.keys()) {
    const prev = running.get(el);
    if (prev) {
      prev.cancel();
      running.delete(el);
    }
  }
  if (reduced) return;
  // All reads, then all writes.
  for (const [el, from] of first) {
    if (!canAnimate(el)) continue;
    const rect = el.getBoundingClientRect();
    const dx = from.left - rect.left;
    const dy = from.top - rect.top;
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue;
    moves.push([el as HTMLElement, dx, dy]);
  }
  for (const [el, dx, dy] of moves) {
    const animation = el.animate(
      [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }],
      { duration: options.duration ?? DURATION.flip, easing: options.easing ?? EASE_IN_OUT },
    );
    running.set(el, animation);
    const done = () => {
      if (running.get(el) === animation) running.delete(el);
    };
    animation.onfinish = done;
    animation.oncancel = done;
  }
}

/**
 * Runs `mutate` (which must change the DOM synchronously) and glides every element in `elements`
 * from its old place to its new one. Reads before writes; interruptible. For React state, use
 * `measureFlip` before the update and `playFlip` in a layout effect after it.
 */
export function flip(elements: Iterable<Element>, mutate: () => void, options?: FlipOptions): void {
  const first = measureFlip(elements);
  mutate();
  playFlip(first, options);
}
