"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { parseLiveNow, type LiveNow } from "./shell-model";
import { useDuelPresence } from "@/lib/hooks/use-duel-presence";

export const LIVE_POLL_MS = 30_000;
/** A tab that comes back to the foreground refetches unless it just did. */
const FOCUS_REFETCH_AFTER_MS = 5_000;

/**
 * The sidebar's "Live now" data. Fetches on mount and on every route change, every 30 seconds
 * while the tab is visible, and when the tab comes back. Fails quietly: a bad answer or a network
 * error keeps the last good value, and a 401 clears it.
 */
export function useLiveNow(pathname: string): LiveNow | null {
  const [live, setLive] = useState<LiveNow | null>(null);
  const slug = live?.yourDuel?.href.match(/^\/duels\/([^/?#]+)$/)?.[1] ?? null;
  const presence = useDuelPresence(slug);
  const abortRef = useRef<AbortController | null>(null);
  const lastRef = useRef(0);

  const load = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    lastRef.current = Date.now();
    try {
      const res = await fetch("/api/live", { cache: "no-store", signal: controller.signal });
      if (controller.signal.aborted) return;
      if (res.status === 401) {
        setLive(null);
        return;
      }
      if (!res.ok) return;
      const parsed = parseLiveNow(await res.json());
      if (!controller.signal.aborted && parsed) setLive(parsed);
    } catch {
      // The row is a nicety. A failed poll leaves what was there.
    }
  }, []);

  // Mount, and every page change.
  useEffect(() => {
    void load();
  }, [pathname, load]);

  useEffect(() => {
    const visible = () => document.visibilityState !== "hidden";
    const timer = setInterval(() => {
      if (visible()) void load();
    }, LIVE_POLL_MS);
    const onVisibility = () => {
      if (visible() && Date.now() - lastRef.current > FOCUS_REFETCH_AFTER_MS) void load();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [load]);

  useEffect(() => () => abortRef.current?.abort(), []);

  return live?.yourDuel ? { ...live, presence } : live;
}
