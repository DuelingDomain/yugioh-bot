"use client";

import { useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";
import type {
  DuelChangedPayload, DuelConnectionResponse, DuelJoinAck, DuelPresencePayload,
  DuelSubscriptionExpiredPayload,
} from "@yugidraft/shared/ws";

const WS_URL = process.env.NEXT_PUBLIC_WS_URL ||
  (typeof window !== "undefined" ? window.location.origin : "http://localhost:3001");

type Presence = Omit<DuelPresencePayload, "slug">;
type Connection = { slug: string; connected: boolean; presence: Presence | null };

/** Only invalidations travel over the socket; the authenticated GET owns the board. */
export function useDuelWebsocket(
  slug: string,
  seat: number | null | undefined,
  onChange: () => Promise<unknown>,
) {
  const changeRef = useRef(onChange);
  changeRef.current = onChange;
  const [connection, setConnection] = useState<Connection>({ slug: "", connected: false, presence: null });

  useEffect(() => {
    if (!slug || seat === undefined) return;
    let disposed = false;
    let joining = false;
    let guildId: string | undefined;
    let request: AbortController | undefined;
    let renewal: number | undefined;
    const socket = io(WS_URL, {
      autoConnect: false,
      reconnectionDelay: 250,
      reconnectionDelayMax: 3000,
      timeout: 5000,
    });
    const disconnected = () => {
      clearTimeout(renewal);
      request?.abort();
      if (!disposed) setConnection({ slug, connected: false, presence: null });
    };
    const join = async () => {
      if (disposed || joining || !socket.connected) return;
      joining = true;
      clearTimeout(renewal);
      const socketId = socket.id;
      request = new AbortController();
      try {
        const response = await fetch(`/api/duels/${encodeURIComponent(slug)}/connection`, {
          cache: "no-store", signal: AbortSignal.any([request.signal, AbortSignal.timeout(8000)]),
        });
        if (!response.ok) throw new Error("Room subscription unavailable");
        const credentials = await response.json() as DuelConnectionResponse;
        if (disposed || socket.id !== socketId || !socket.connected) return;
        guildId = credentials.guildId;
        const result = await new Promise<DuelJoinAck>((resolve, reject) => {
          socket.timeout(5000).emit("duel:join", { token: credentials.token }, (error: Error | null, answer: DuelJoinAck) => {
            if (error) reject(error);
            else resolve(answer);
          });
        });
        if (!result?.ok) throw new Error("Room subscription rejected");
        if (disposed || socket.id !== socketId || !socket.connected) return;
        setConnection({ slug, connected: false, presence: {
          onlineSeats: result.onlineSeats, spectatorCount: result.spectatorCount,
        } });
        // A fresh snapshot closes the gap between disconnect and successful rejoin.
        await changeRef.current();
        if (disposed || socket.id !== socketId || !socket.connected) return;
        setConnection((current) => ({ ...current, slug, connected: true }));
        renewal = window.setTimeout(() => void join(), Math.max(1000, credentials.expiresAt - Date.now() - 30_000));
      } catch {
        if (disposed) return;
        setConnection({ slug, connected: false, presence: null });
        if (socket.connected) renewal = window.setTimeout(() => void join(), 3000);
      } finally {
        joining = false;
        // A reconnect may have happened while the previous token request was aborting.
        if (!disposed && socket.connected && socket.id !== socketId) void join();
      }
    };
    socket.on("connect", () => void join());
    socket.on("disconnect", disconnected);
    socket.on("connect_error", disconnected);
    socket.on("duel:changed", (event: DuelChangedPayload) => {
      if (event.slug === slug) void changeRef.current().catch(() => {});
    });
    socket.on("duel:presence", (event: DuelPresencePayload) => {
      if (event.slug !== slug || disposed) return;
      setConnection((current) => ({ ...current, slug, presence: {
        onlineSeats: event.onlineSeats, spectatorCount: event.spectatorCount,
      } }));
    });
    socket.on("duel:subscription-expired", (event: DuelSubscriptionExpiredPayload) => {
      if (event.slug !== slug) return;
      setConnection({ slug, connected: false, presence: null });
      void join();
    });
    socket.connect();
    return () => {
      disposed = true;
      clearTimeout(renewal);
      request?.abort();
      if (guildId && socket.connected) socket.emit("duel:leave", { slug, guildId });
      socket.disconnect();
    };
  }, [slug, seat]);

  return connection.slug === slug ? connection : { slug, connected: false, presence: null };
}
