"use client";

import { useEffect, useState } from "react";
import { EMPTY_OPEN_NOW, type OpenNow } from "@/lib/open-now";
import { parseOpenNow } from "@/components/empty-states/open-now-model";

/** A slow answer counts as an empty one. The empty states are a nicety. */
const OPEN_NOW_TIMEOUT_MS = 6000;

export type OpenNowState = {
  /** True once the fetch has finished, with data or without. Until then show nothing for it. */
  settled: boolean;
  data: OpenNow;
};

/**
 * What a guild member can join or watch right now, for the empty states. Fetches once on mount.
 * Any failure (a bad status, a bad shape, no network, a slow answer) settles as `EMPTY_OPEN_NOW`,
 * so the page shows its "nothing is open" version.
 */
export function useOpenNow(): OpenNowState {
  const [state, setState] = useState<OpenNowState>({ settled: false, data: EMPTY_OPEN_NOW });

  useEffect(() => {
    const controller = new AbortController();
    let unmounted = false;
    const timer = setTimeout(() => controller.abort(), OPEN_NOW_TIMEOUT_MS);
    (async () => {
      let data = EMPTY_OPEN_NOW;
      try {
        const res = await fetch("/api/lobby/open", { cache: "no-store", signal: controller.signal });
        if (res.ok) data = parseOpenNow(await res.json()) ?? EMPTY_OPEN_NOW;
      } catch {
        // Treated as nothing open.
      }
      clearTimeout(timer);
      if (!unmounted) setState({ settled: true, data });
    })();
    return () => {
      unmounted = true;
      clearTimeout(timer);
      controller.abort();
    };
  }, []);

  return state;
}
