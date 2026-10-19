"use client";
import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { presenceRoute } from "@yugidraft/shared/presence/routes";

/** One small request per visible minute. No IDs or URL details leave the browser. */
export function PresenceHeartbeat() {
  const pathname = usePathname();
  const route = presenceRoute(pathname);
  useEffect(() => {
    let busy = false;
    let closed = false;
    const controller = new AbortController();
    async function send() {
      if (closed || busy || document.visibilityState !== "visible") return;
      busy = true;
      try {
        await fetch("/api/presence", { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ route }), signal: controller.signal });
      } catch { /* Best-effort presence must not interrupt play. */ }
      finally { busy = false; }
    }
    void send();
    const interval = setInterval(() => { void send(); }, 60_000);
    const visible = () => { if (document.visibilityState === "visible") void send(); };
    document.addEventListener("visibilitychange", visible);
    return () => { closed = true; controller.abort(); clearInterval(interval); document.removeEventListener("visibilitychange", visible); };
  }, [route]);
  return null;
}
