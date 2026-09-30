"use client";

import { useEffect, useRef, useState } from "react";
import { loadFx3d, type Fx3dHandle } from "./loader";
import type { Fx3dApi } from "./types";

/**
 * Owns the 3D layer of one host element. Loads it after the first paint (idle time), only when
 * `enabled`, and disposes the canvas, its GPU resources and its listeners on unmount or when
 * `enabled` turns false. `ref.current` is the API only while the canvas can draw, so a caller that
 * reads it when planning an effect never gets a dead one.
 */
export function useFx3d(host: HTMLElement | null, enabled: boolean): React.RefObject<Fx3dApi | null> {
  const ref = useRef<Fx3dApi | null>(null);
  const [, bump] = useState(0);

  useEffect(() => {
    if (!host || !enabled) return undefined;
    let cancelled = false;
    let handle: Fx3dHandle | null = null;
    const start = () => {
      void loadFx3d(host, (ready) => {
        ref.current = ready && handle ? handle.api : null;
        bump((n) => n + 1);
      }).then((loaded) => {
        if (cancelled) {
          loaded?.dispose();
          return;
        }
        handle = loaded;
        ref.current = loaded?.api ?? null;
        // Re-render the owner so it can publish the canvas now, not only at its next snapshot.
        if (loaded) bump((n) => n + 1);
      });
    };
    const idle = typeof window.requestIdleCallback === "function" ? window.requestIdleCallback(start, { timeout: 1500 }) : window.setTimeout(start, 200);
    return () => {
      cancelled = true;
      if (typeof window.requestIdleCallback === "function") window.cancelIdleCallback(idle);
      else window.clearTimeout(idle);
      ref.current = null;
      handle?.dispose();
      handle = null;
    };
  }, [host, enabled]);

  return ref;
}
