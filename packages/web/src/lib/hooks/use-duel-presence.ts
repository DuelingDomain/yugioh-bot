"use client";

import { useEffect, useState } from "react";
import { io } from "socket.io-client";
import type { DuelConnectionResponse, DuelJoinAck, DuelPresencePayload } from "@yugidraft/shared/ws";

const WS_URL = process.env.NEXT_PUBLIC_WS_URL ||
  (typeof window !== "undefined" ? window.location.origin : "http://localhost:3001");
type Presence = Omit<DuelPresencePayload, "slug">;

/** Authenticated sidebar subscription. Observing never counts as entering the duel room. */
export function useDuelPresence(slug: string | null): Presence | null {
  const [snapshot, setSnapshot] = useState<{ slug: string; presence: Presence } | null>(null);

  useEffect(() => {
    if (!slug) {
      setSnapshot(null);
      return;
    }
    let disposed = false;
    let generation = 0;
    let subscribed = false;
    let guildId: string | undefined;
    let request: AbortController | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let retryDelay = 1000;
    const socket = io(WS_URL, { autoConnect: false, reconnectionDelay: 250, reconnectionDelayMax: 3000, timeout: 5000 });
    const clear = () => {
      generation++;
      subscribed = false;
      request?.abort();
      clearTimeout(timer);
      if (!disposed) setSnapshot(null);
    };
    const join = async () => {
      if (disposed || !socket.connected) return;
      const attempt = ++generation;
      const socketId = socket.id;
      const current = () => !disposed && attempt === generation && socket.connected && socket.id === socketId;
      clearTimeout(timer);
      request?.abort();
      request = new AbortController();
      try {
        const response = await fetch(`/api/duels/${encodeURIComponent(slug)}/connection`, {
          cache: "no-store", signal: AbortSignal.any([request.signal, AbortSignal.timeout(8000)]),
        });
        if (!current()) return;
        if (!response.ok) {
          if (response.status === 401 || response.status === 403 || response.status === 404) { clear(); return; }
          throw new Error("Presence subscription unavailable");
        }
        const credentials = await response.json() as DuelConnectionResponse;
        if (!current()) return;
        guildId = credentials.guildId;
        const result = await new Promise<DuelJoinAck>((resolve, reject) => {
          socket.timeout(5000).emit("duel:join", { token: credentials.token, observe: true },
            (error: Error | null, answer: DuelJoinAck) => error ? reject(error) : resolve(answer));
        });
        if (!current()) return;
        if (!result?.ok) throw new Error("Presence subscription rejected");
        subscribed = true;
        retryDelay = 1000;
        setSnapshot({ slug, presence: { onlineSeats: result.onlineSeats, spectatorCount: result.spectatorCount } });
        timer = setTimeout(() => void join(), Math.max(1000, credentials.expiresAt - Date.now() - 30_000));
      } catch {
        if (!current()) return;
        subscribed = false;
        setSnapshot(null);
        timer = setTimeout(() => void join(), retryDelay);
        retryDelay = Math.min(retryDelay * 2, 15_000);
      }
    };
    socket.on("connect", () => { clear(); void join(); });
    socket.on("disconnect", clear);
    socket.on("connect_error", clear);
    socket.on("duel:presence", (event: DuelPresencePayload) => {
      if (!disposed && subscribed && event.slug === slug) {
        setSnapshot({ slug, presence: { onlineSeats: event.onlineSeats, spectatorCount: event.spectatorCount } });
      }
    });
    socket.on("duel:subscription-expired", (event: { slug: string }) => {
      if (event.slug !== slug || disposed) return;
      clear();
      void join();
    });
    const online = () => {
      if (socket.connected) void join();
      else socket.connect();
    };
    window.addEventListener("offline", clear);
    window.addEventListener("online", online);
    socket.connect();
    return () => {
      disposed = true;
      clear();
      window.removeEventListener("offline", clear);
      window.removeEventListener("online", online);
      if (guildId && socket.connected) socket.emit("duel:leave", { slug, guildId });
      socket.disconnect();
    };
  }, [slug]);

  return snapshot?.slug === slug ? snapshot.presence : null;
}
