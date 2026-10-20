"use client";
import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { presenceRoute, type PresenceRoute } from "@yugidraft/shared/presence/routes";

/** The server accepts a route change after 10 s. Sending sooner would only earn a 429. */
const MIN_GAP_MS = 10_000;
let lastSentAt = 0;
/** Same list as TABLE_PRESENCE_ROUTES on the server (that module also holds database code, so it is not imported here). */
const TABLE_ROUTES: readonly PresenceRoute[] = ["/duels/[slug]", "/draft/[slug]", "/decks/draft/[slug]"];

/**
 * One small request per visible minute, and one when the page changes. No IDs or URL details leave the browser.
 * Closing a duel or draft tab sends one "leave" so the admin console stops showing the person at that table.
 */
export function PresenceHeartbeat() {
  const pathname = usePathname();
  const route = presenceRoute(pathname);
  useEffect(() => {
    let busy = false;
    let closed = false;
    let wait: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    function send() {
      if (closed || busy || wait !== undefined || document.visibilityState !== "visible") return;
      const delay = Math.max(0, lastSentAt + MIN_GAP_MS - Date.now());
      if (delay > 0) { wait = setTimeout(() => { wait = undefined; void post(); }, delay); return; }
      void post();
    }
    let retried = false;
    async function post() {
      if (closed || busy || document.visibilityState !== "visible") return;
      busy = true;
      lastSentAt = Date.now();
      try {
        const res = await fetch("/api/presence", { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ route }), signal: controller.signal });
        // A reload right after a beat is refused for up to 10 s (the leave beat of the old page changed the route).
        // Try once more after the gap instead of waiting for the next minute.
        if (res.status === 429 && !retried && !closed) { retried = true; wait = setTimeout(() => { wait = undefined; void post(); }, MIN_GAP_MS); }
      } catch { /* Best-effort presence must not interrupt play. */ }
      finally { busy = false; }
    }
    function leave() {
      if (!TABLE_ROUTES.includes(route)) return;
      try {
        void fetch("/api/presence", { method: "POST", keepalive: true, headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ route, leave: true }) }).catch(() => undefined);
      } catch { /* The page is closing; nothing to do. */ }
    }
    send();
    const interval = setInterval(send, 60_000);
    const visible = () => { if (document.visibilityState === "visible") send(); };
    document.addEventListener("visibilitychange", visible);
    window.addEventListener("pagehide", leave);
    return () => {
      closed = true; controller.abort(); clearInterval(interval); clearTimeout(wait);
      document.removeEventListener("visibilitychange", visible); window.removeEventListener("pagehide", leave);
    };
  }, [route]);
  return null;
}
