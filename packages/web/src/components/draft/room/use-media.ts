"use client";

import { useSyncExternalStore } from "react";

const hasMatchMedia = () => typeof window !== "undefined" && typeof window.matchMedia === "function";

/**
 * A media query that follows the viewport. False where matchMedia does not exist and on the server, so a hydrated page
 * first renders what the server sent and then moves to the real answer.
 */
export function useMedia(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      if (!hasMatchMedia()) return () => {};
      const mq = window.matchMedia(query);
      mq.addEventListener?.("change", onChange);
      return () => mq.removeEventListener?.("change", onChange);
    },
    () => hasMatchMedia() && window.matchMedia(query).matches,
    () => false,
  );
}
