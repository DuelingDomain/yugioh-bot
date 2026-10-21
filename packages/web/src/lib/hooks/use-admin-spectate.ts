"use client";
import { useEffect } from "react";
import useSWR from "swr";
import { io } from "socket.io-client";

const WS_URL = process.env.NEXT_PUBLIC_WS_URL || (typeof window === "undefined" ? "http://localhost:3001" : window.location.origin);
export function useAdminSpectate<T>(kind: "duel" | "draft", slug: string, seat: number | null) {
  const base = `/api/admin/${kind}s/${encodeURIComponent(slug)}/spectate`;
  const state = useSWR<T>(`${base}?seat=${seat ?? "public"}`, async url => {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) {
      const body = await response.json().catch(() => null) as { code?: string } | null;
      if (body?.code === "ADMIN_SPECTATE_PARTICIPANT") throw new Error("You cannot use admin watch while you are a player or invitee in this live game. Open the player view instead.");
      throw new Error(response.status === 401 || response.status === 404 ? "This watch session is no longer available." : "The live view is unavailable. Retrying…");
    }
    return response.json();
  }, { refreshInterval: 15_000, keepPreviousData: true });
  const { mutate } = state;
  useEffect(() => {
    const socket = io(WS_URL);
    let stopped = false;
    let joining = false;
    let joined = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    function schedule(delay: number) { clearTimeout(timer); if (!stopped) timer = setTimeout(() => void join(), delay); }
    async function join() {
      if (stopped || joining || !socket.connected) return;
      joining = true;
      try {
        const response = await fetch(`${base}/connection`, { cache: "no-store", signal: controller.signal });
        if (!response.ok) { void mutate(); if (response.status !== 401 && response.status !== 404) schedule(5000); return; }
        const data = await response.json() as { token: string; expiresAt: number };
        if (stopped || !socket.connected) return;
        const ack = await socket.timeout(5000).emitWithAck("admin:spectate", { token: data.token }) as { ok: boolean };
        if (!ack.ok) { void mutate(); schedule(5000); return; }
        if (!joined) { joined = true; refresh(); }
        schedule(Math.max(1000, data.expiresAt - Date.now() - 15_000));
      } catch { schedule(5000); }
      finally { joining = false; }
    }
    const refresh = () => {
      if (stopped) return;
      if (kind === "duel") { void mutate(); return; }
      clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => { if (!stopped) void mutate(); }, 350);
    };
    socket.on("connect", () => { joined = false; void join(); });
    socket.on("admin:spectate-expired", () => { refresh(); void join(); });
    for (const event of kind === "duel" ? ["duel:changed"] : ["draft:pick", "draft:resync", "draft:status", "draft:seats", "draft:complete"]) socket.on(event, refresh);
    return () => { stopped = true; clearTimeout(timer); clearTimeout(refreshTimer); controller.abort(); socket.disconnect(); };
  }, [base, kind, mutate]);
  return state;
}
