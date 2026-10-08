"use client";

import { useCallback, useSyncExternalStore } from "react";

const hasMatchMedia = () => typeof window !== "undefined" && typeof window.matchMedia === "function";

/**
 * A media query that follows the viewport. False where matchMedia does not exist and on the server, so a hydrated page
 * first renders what the server sent and then moves to the real answer.
 */
export function useMedia(query: string): boolean {
  // A stable subscribe: a new function each render would make React unsubscribe and subscribe again every time.
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (!hasMatchMedia()) return () => {};
      const mq = window.matchMedia(query);
      mq.addEventListener?.("change", onChange);
      return () => mq.removeEventListener?.("change", onChange);
    },
    [query],
  );
  return useSyncExternalStore(subscribe, () => hasMatchMedia() && window.matchMedia(query).matches, () => false);
}
