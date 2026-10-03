"use client";

import { useEffect, useRef, useSyncExternalStore, type ComponentPropsWithoutRef } from "react";

/**
 * A page bar that sticks to the bottom of the screen (the draft action block on a phone, the tournament action bar)
 * would sit under the floating Report bug button. Such a bar registers itself here (`BugFabLift`), and the button
 * lifts above it by the amount the bar rises over the button's corner.
 */
const FAB_BOTTOM = 12;
const FAB_HEIGHT = 36;
const GAP = 8;

const lifts = new Map<HTMLElement, number>();
const listeners = new Set<() => void>();
let total = 0;

function publish() {
  const next = Math.max(0, ...lifts.values());
  if (next === total) return;
  total = next;
  listeners.forEach((listener) => listener());
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};

/** How far the button rises, in px. 0 while no bottom bar is on screen; the server render says 0 too. */
export function useBugFabLift(): number {
  return useSyncExternalStore(subscribe, () => total, () => 0);
}

/** The lift one bar asks for: 0 unless it is stuck or fixed and reaches into the button's corner. */
export function liftFor(rect: { top: number; bottom: number; height: number }, position: string, viewportHeight: number): number {
  if (position !== "sticky" && position !== "fixed") return 0;
  if (rect.height <= 0 || rect.bottom < viewportHeight - FAB_BOTTOM - FAB_HEIGHT) return 0;
  return Math.max(0, Math.ceil(viewportHeight - rect.top + GAP - FAB_BOTTOM));
}

/** A div that keeps the Report bug button above it while it sticks to the bottom of the screen. */
export function BugFabLift(props: ComponentPropsWithoutRef<"div">) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const viewport = window.visualViewport?.height ?? window.innerHeight;
      lifts.set(el, liftFor(el.getBoundingClientRect(), getComputedStyle(el).position, viewport));
      publish();
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    measure();
    window.addEventListener("scroll", schedule, { passive: true, capture: true });
    window.addEventListener("resize", schedule);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(schedule);
    observer?.observe(el);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule, true);
      window.removeEventListener("resize", schedule);
      observer?.disconnect();
      lifts.delete(el);
      publish();
    };
  }, []);
  return <div ref={ref} {...props} />;
}
