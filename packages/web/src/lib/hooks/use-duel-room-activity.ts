"use client";

import { useEffect } from "react";

const ACTIVITY_BATCH_MS = 15_000;

/** Retain a waiting seat during actual room/editor input. A passive tab cannot renew it. */
export function useDuelRoomActivity(slug: string | null): void {
  useEffect(() => {
    if (!slug) return;
    let stopped = false;
    let pending = false;
    let lastSent = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const send = () => {
      clearTimeout(timer);
      timer = undefined;
      if (stopped || !pending) return;
      pending = false;
      lastSent = Date.now();
      void fetch(`/api/duels/${encodeURIComponent(slug)}/activity`, { method: "POST", keepalive: true })
        .then(response => {
          if ([401, 403, 404, 409].includes(response.status)) stopped = true;
          // Keep the input pending after a transient failure. Retry only on more player input.
          else if (!response.ok) pending = true;
        }).catch(() => { pending = true; });
    };
    const activity = () => {
      if (stopped) return;
      pending = true;
      if (Date.now() - lastSent >= ACTIVITY_BATCH_MS) send();
      else if (!timer) timer = setTimeout(send, ACTIVITY_BATCH_MS - (Date.now() - lastSent));
    };
    const events = ["pointerdown", "keydown", "input", "wheel"] as const;
    for (const event of events) window.addEventListener(event, activity, { capture: true, passive: true });
    window.addEventListener("pagehide", send);
    // Opening the room or its editor is player activity too.
    activity();
    return () => {
      for (const event of events) window.removeEventListener(event, activity, true);
      window.removeEventListener("pagehide", send);
      send();
      stopped = true;
      clearTimeout(timer);
    };
  }, [slug]);
}
