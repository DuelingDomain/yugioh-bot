"use client";
import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { presenceRoute } from "@yugidraft/shared/presence/routes";

/** The server accepts a route change after 10 s. Sending sooner would only earn a 429. */
const MIN_GAP_MS = 10_000;
let lastSentAt = 0;

/** One small request per visible minute, and one when the page changes. No IDs or URL details leave the browser. */
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
    async function post() {
      if (closed || busy || document.visibilityState !== "visible") return;
      busy = true;
      lastSentAt = Date.now();
      try {
        await fetch("/api/presence", { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ route }), signal: controller.signal });
      } catch { /* Best-effort presence must not interrupt play. */ }
      finally { busy = false; }
    }
    send();
    const interval = setInterval(send, 60_000);
    const visible = () => { if (document.visibilityState === "visible") send(); };
    document.addEventListener("visibilitychange", visible);
    return () => { closed = true; controller.abort(); clearInterval(interval); clearTimeout(wait); document.removeEventListener("visibilitychange", visible); };
  }, [route]);
  return null;
}
