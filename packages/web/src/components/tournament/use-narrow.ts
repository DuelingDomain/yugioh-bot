"use client";

import { useEffect, useState, type RefObject } from "react";

/**
 * True when the element is narrower than `max` px. The board's phone panes drop and reflow
 * parts of a row (tiers, delta chips, the grid), which one stylesheet cannot do for markup
 * that has to stay accessible once. Without ResizeObserver (tests, old browsers) it stays wide.
 */
export function useNarrow(ref: RefObject<HTMLElement | null>, max = 620): boolean {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const node = ref.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const measure = () => setNarrow(node.getBoundingClientRect().width > 0 && node.getBoundingClientRect().width < max);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [ref, max]);
  return narrow;
}
