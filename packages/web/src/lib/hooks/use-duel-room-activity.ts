"use client";

import { useEffect, useState } from "react";

const ACTIVITY_BATCH_MS = 15_000;

/**
 * Retain a waiting seat during actual room/editor input. A passive tab cannot renew it.
 * Returns the time (ms since 1970) the room closes if nobody acts, or null while it is not known.
 */
export function useDuelRoomActivity(slug: string | null): number | null {
  const [idleDeadline, setIdleDeadline] = useState<number | null>(null);
  useEffect(() => {
    if (!slug) { setIdleDeadline(null); return; }
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
        .then(async response => {
          if ([401, 403, 404, 409].includes(response.status)) stopped = true;
          // Keep the input pending after a transient failure. Retry only on more player input.
          else if (!response.ok) pending = true;
          else if (!stopped) {
            const body: unknown = await Promise.resolve().then(() => response.clone().json()).catch(() => null);
            const at = body && typeof body === "object" && "idleDeadlineAt" in body && typeof body.idleDeadlineAt === "string"
              ? Date.parse(body.idleDeadlineAt) : NaN;
            // A newer input may have come while this answer was on its way: it moved the deadline, so keep it cleared.
            if (!pending && Number.isFinite(at)) setIdleDeadline(at);
          }
        }).catch(() => { pending = true; });
    };
    const activity = () => {
      if (stopped) return;
      pending = true;
      // The deadline moves with this input; the next answer says the new time.
      setIdleDeadline(null);
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
  return slug ? idleDeadline : null;
}
