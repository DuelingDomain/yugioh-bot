"use client";
import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { TABLE_PRESENCE_ROUTES, presenceRoute } from "@yugidraft/shared/presence/routes";

/**
 * The server accepts a beat for the same route after 30 s and for a changed route after 10 s (HEARTBEAT_RATE_MS and
 * ROUTE_CHANGE_RATE_MS in shared/presence). Sending sooner only earns a 429. The last beat is kept in localStorage, so a
 * reload or a second tab waits as well; module memory alone is lost on every reload.
 */
// A margin on top: the server stamps a beat when it answers, a little after the browser sent it.
const SAFETY_MS = 2_000;
const SAME_ROUTE_GAP_MS = 30_000 + SAFETY_MS;
const ROUTE_CHANGE_GAP_MS = 10_000 + SAFETY_MS;
const LAST_BEAT_KEY = "dd-presence-last-beat";
type Beat = { at: number; route: string };
let lastBeat: Beat | null = null;

function readLastBeat(): Beat | null {
  try {
    const stored = JSON.parse(localStorage.getItem(LAST_BEAT_KEY) ?? "null") as Partial<Beat> | null;
    if (stored && typeof stored.at === "number" && typeof stored.route === "string" && (!lastBeat || stored.at >= lastBeat.at)) return { at: stored.at, route: stored.route };
  } catch { /* Storage can be blocked; the memory copy still covers in-app navigation. */ }
  return lastBeat;
}

function writeLastBeat(beat: Beat): void {
  lastBeat = beat;
  try { localStorage.setItem(LAST_BEAT_KEY, JSON.stringify(beat)); } catch { /* Best effort. */ }
}

/** Milliseconds until the server accepts a beat for `route`. */
function waitBeforeBeat(route: string): number {
  const last = readLastBeat();
  if (!last) return 0;
  const gap = last.route === route ? SAME_ROUTE_GAP_MS : ROUTE_CHANGE_GAP_MS;
  return Math.max(0, last.at + gap - Date.now());
}

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
      const delay = waitBeforeBeat(route);
      if (delay > 0) { wait = setTimeout(() => { wait = undefined; void post(); }, delay); return; }
      void post();
    }
    let retried = false;
    async function post() {
      if (closed || busy || document.visibilityState !== "visible") return;
      busy = true;
      writeLastBeat({ at: Date.now(), route });
      try {
        const res = await fetch("/api/presence", { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ route }), signal: controller.signal });
        // Another tab or device may have beaten this one to the limit. Try once more after the gap instead of waiting for the next minute.
        if (res.status === 429 && !retried && !closed) { retried = true; wait = setTimeout(() => { wait = undefined; void post(); }, SAME_ROUTE_GAP_MS); }
      } catch { /* Best-effort presence must not interrupt play. */ }
      finally { busy = false; }
    }
    function leave() {
      if (!TABLE_PRESENCE_ROUTES.includes(route)) return;
      // The server swaps the table route for "/app", so the next page may beat after the shorter route-change gap.
      if (lastBeat?.route === route) writeLastBeat({ at: lastBeat.at, route: "/app" });
      try {
        void fetch("/api/presence", { method: "POST", keepalive: true, headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ route, leave: true }) }).catch(() => undefined);
      } catch { /* The page is closing; nothing to do. */ }
    }
    send();
    const interval = setInterval(send, 60_000);
    const visible = () => { if (document.visibilityState === "visible") send(); };
    // Back from the back-forward cache: the page sent a leave beat when it was hidden, so tell the server it is back.
    const shown = (event: PageTransitionEvent) => { if (event.persisted) send(); };
    document.addEventListener("visibilitychange", visible);
    window.addEventListener("pagehide", leave);
    window.addEventListener("pageshow", shown);
    return () => {
      closed = true; controller.abort(); clearInterval(interval); clearTimeout(wait);
      document.removeEventListener("visibilitychange", visible); window.removeEventListener("pagehide", leave); window.removeEventListener("pageshow", shown);
    };
  }, [route]);
  return null;
}
