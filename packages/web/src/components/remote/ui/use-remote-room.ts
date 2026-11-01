"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { io, type Socket } from "socket.io-client";
import type { RemoteAction, RemoteActionProposal, RemoteClientEvents, RemoteRoom, RemoteServerEvents } from "@yugidraft/shared/remote";

/** Server clock minus browser clock, from the HTTP Date header (whole seconds, so it leans to the later second). */
let clockSkew = 0;
/** Best guess of the server time now. Used for the undo window, which the server measures with its own clock. */
export const serverNow = () => Date.now() + clockSkew;

export async function remoteApi<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api/remote${path}`, { cache: "no-store", ...(body === undefined ? {} : {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  }) });
  const date = Date.parse(response.headers.get("date") ?? "");
  if (Number.isFinite(date)) clockSkew = date + 999 - Date.now();
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? "Could not update the table");
  return data;
}

export type RoomController = ReturnType<typeof useRemoteRoom>;

/** Loads one table, keeps it fresh from the socket (5 s poll as backup) and posts actions. */
export function useRemoteRoom(slug: string) {
  const router = useRouter();
  const { data: room, error: loadError, mutate } = useSWR(`remote:${slug}`, () => remoteApi<RemoteRoom>(`/${slug}`), { refreshInterval: 5000 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [realtime, setRealtime] = useState("Connecting…");
  const roomRef = useRef<RemoteRoom | undefined>(room);
  roomRef.current = room;
  const lastSeq = useRef(0);
  const status = room?.status; const mySeat = room?.mySeat;
  const socketRef = useRef<Socket<RemoteServerEvents, RemoteClientEvents> | null>(null);
  const dataHandlers = useRef(new Set<(payload: Parameters<RemoteServerEvents["remote:data"]>[0]) => void>());

  useEffect(() => {
    if (mySeat === undefined || status === "ended") return;
    let disposed = false; let renewing = false;
    const socket: Socket<RemoteServerEvents, RemoteClientEvents> = io(process.env.NEXT_PUBLIC_WS_URL || undefined, { autoConnect: false });
    socketRef.current = socket;
    async function join() {
      if (renewing) return; renewing = true;
      try {
        const credentials = await fetch(`/api/remote/${slug}/connection`, { cache: "no-store" }); const data = await credentials.json();
        if (!credentials.ok) throw new Error(data.error);
        if (disposed || !socket.connected) return;
        socket.emit("remote:join", { token: data.token }, result => {
          setRealtime(result.ok ? "Connected" : result.error);
          if (result.ok) void mutate();
        });
      } catch { if (!disposed) setRealtime("Realtime unavailable; refreshing every 5 seconds"); }
      finally { renewing = false; }
    }
    socket.on("connect", () => void join());
    socket.on("connect_error", () => { if (!disposed) setRealtime("Realtime unavailable; refreshing every 5 seconds"); });
    socket.on("disconnect", () => setRealtime("Reconnecting…"));
    socket.on("remote:subscription-expired", () => void join());
    socket.on("remote:data", payload => { if (payload.slug === slug) for (const handler of dataHandlers.current) handler(payload); });
    socket.on("remote:changed", snapshot => {
      if (snapshot.table.slug !== slug) return;
      void mutate(current => current && current.lastSeq <= snapshot.table.lastSeq
        ? { ...snapshot.table, state: snapshot.state, events: snapshot.events, mySeat: current.mySeat } : current, { revalidate: false });
    });
    socket.connect(); const timer = setInterval(() => void join(), 4 * 60_000);
    return () => { disposed = true; clearInterval(timer); socket.emit("remote:leave"); socket.disconnect(); socketRef.current = null; };
  }, [slug, mySeat, status, mutate]);

  const operation = useCallback(async (path: string, body: unknown = {}) => {
    setBusy(true); setError("");
    try {
      await remoteApi(`/${slug}/${path}`, body);
      if (path === "leave") router.push("/duels/remote"); else await mutate();
    } catch (e) { setError((e as Error).message); void mutate(); } finally { setBusy(false); }
  }, [slug, router, mutate]);

  /** Posts one action; resolves to the updated room, or null when the foundation refused it. */
  const action = useCallback(async (payload: RemoteActionProposal): Promise<RemoteRoom | null> => {
    const current = roomRef.current; if (!current) return null;
    const input = { baseSeq: Math.max(current.lastSeq, lastSeq.current), action: { ...payload, idempotencyKey: crypto.randomUUID() } as RemoteAction };
    setError("");
    try {
      const updated = await remoteApi<RemoteRoom>(`/${slug}/actions`, input);
      lastSeq.current = Math.max(lastSeq.current, updated.lastSeq);
      roomRef.current = updated;
      await mutate(old => old && old.lastSeq > updated.lastSeq ? old : updated, { revalidate: false });
      return updated;
    } catch (e) { setError((e as Error).message); void mutate(); return null; }
  }, [slug, mutate]);

  const sendData = useCallback((message: Parameters<RemoteClientEvents["remote:data"]>[0]) => { socketRef.current?.emit("remote:data", message); }, []);
  const onData = useCallback((handler: (payload: Parameters<RemoteServerEvents["remote:data"]>[0]) => void) => {
    dataHandlers.current.add(handler); return () => { dataHandlers.current.delete(handler); };
  }, []);

  return { slug, room, loadError, busy, error, setError, realtime, operation, action, mutate, sendData, onData };
}
