"use client";

import { noteRemoteActionError } from "@/lib/remote/room-mutations";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { io, type Socket } from "socket.io-client";
import { remoteApi } from "./api";
import type { RemoteAction, RemoteActionProposal, RemoteBestOf, RemoteClientEvents, RemoteRoom, RemoteServerEvents } from "@yugidraft/shared/remote";

import {markFieldAction,markFieldState} from '@/lib/remote/field-timing';
import {applyRoomPatch,classifyPatch,createRepairScheduler,createRoomMutationQueue,remoteChangeNeedsFetch} from '@/lib/remote/room-mutations';
export type RoomController = ReturnType<typeof useRemoteRoom>;

/** Loads one table, keeps it fresh from the socket (poll as backup: 30 s while the socket is joined, else 5 s) and posts actions. */
export function useRemoteRoom(slug: string) {
  const router = useRouter();
  const [realtime, setRealtime] = useState("Connecting…");
  // A person with no seat watches a public table. The spectate request also keeps the spectator slot, so this poll holds it.
  const spectating = useRef(false);
  const [watching, setWatching] = useState(false);
  // A GET that answers after a patch or an action reply must not put an older room back on screen.
  const roomRef = useRef<RemoteRoom | undefined>(undefined);
  const newest = useCallback((fetched: RemoteRoom) => { const held = roomRef.current; return held && held.slug === slug && held.lastSeq > fetched.lastSeq ? held : fetched; }, [slug]);
  const load = useCallback(async () => {
    const watch = async () => { const view = await remoteApi<RemoteRoom>(`/${slug}/spectate`, {}); spectating.current = !!view.spectator; setWatching(spectating.current); return newest(view); };
    if (spectating.current) return watch();
    try { return newest(await remoteApi<RemoteRoom>(`/${slug}`)); }
    catch (e) { const { status, code } = e as { status?: number; code?: string }; if (status === 404 || code === "SPECTATOR_READ_ONLY") return watch(); throw e; }
  }, [slug, newest]);
  const { data: room, error: loadError, mutate } = useSWR(`remote:${slug}`, load, { refreshInterval: realtime === "Connected" ? 30_000 : 5000, /* A hidden tab still receives video, so it must keep its slot. */ refreshWhenHidden: watching });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if(room&&(!roomRef.current||room.slug!==roomRef.current.slug||room.lastSeq>=roomRef.current.lastSeq))roomRef.current = room;
  const lastSeq = useRef(0),tableKey=useRef(slug),socketSeq=useRef(0);
  if(tableKey.current!==slug){tableKey.current=slug;lastSeq.current=0;socketSeq.current=0;roomRef.current=room?.slug===slug?room:undefined;}
  const status = room?.status; const mySeat = room?.mySeat;
  // Every reason to doubt the held room ends here: one jittered GET, however many reasons arrive.
  const heldSeq = useCallback(() => Math.max(socketSeq.current, roomRef.current?.slug === slug ? roomRef.current.lastSeq : 0), [slug]);
  const repair = useMemo(() => createRepairScheduler(() => mutate(), heldSeq), [mutate, heldSeq]);
  useEffect(() => () => repair.cancel(), [repair]);
  // A tab that comes back may have missed messages while it slept.
  useEffect(() => {
    const shown = () => { if (document.visibilityState === "visible") repair.ask(0, 1000); };
    document.addEventListener("visibilitychange", shown);
    return () => document.removeEventListener("visibilitychange", shown);
  }, [repair]);
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
          if (result.ok) repair.ask(0, 500);
        });
      } catch { if (!disposed) setRealtime("Realtime unavailable; refreshing every 5 seconds"); }
      finally { renewing = false; }
    }
    socket.on("connect", () => void join());
    socket.on("connect_error", () => { if (!disposed) setRealtime("Realtime unavailable; refreshing every 5 seconds"); });
    socket.on("disconnect", () => setRealtime("Reconnecting…"));
    socket.on("remote:subscription-expired", () => void join());
    socket.on("remote:data", payload => { if (payload.slug === slug) for (const handler of dataHandlers.current) handler(payload); });
    // Public notifications never replace the viewer's private state. The private snapshot of the same sequence normally arrived just before,
    // so the GET runs only when this browser holds an older sequence: that is how a lost private delivery recovers.
    socket.on("remote:changed", snapshot => {
      if(snapshot.table.slug!==slug) return;
      const held=Math.max(socketSeq.current,roomRef.current?.slug===slug?roomRef.current.lastSeq:0);
      // The patch or private snapshot of this change may be a moment behind the notice, so wait briefly before the GET.
      if(remoteChangeNeedsFetch(held,snapshot.table.lastSeq)) repair.ask(snapshot.table.lastSeq, 400);
    });
    socket.on("remote:private", snapshot => {
      if (snapshot.table.slug !== slug) return;
      markFieldState({...snapshot.table,state:snapshot.state} as RemoteRoom,'wsState');
      const held=roomRef.current;
      if(held&&held.slug===slug&&held.lastSeq<=snapshot.table.lastSeq)socketSeq.current=Math.max(socketSeq.current,snapshot.table.lastSeq);
      const fromSnapshot = (current: RemoteRoom): RemoteRoom => ({ ...snapshot.table, state: snapshot.state, events: snapshot.events, mySeat: current.mySeat, isDeveloper: current.isDeveloper, spectator: current.spectator, spectatorCount: current.spectatorCount });
      // The held room moves now, so a patch that follows at once builds on this snapshot.
      const built=held&&held.slug===slug&&held.lastSeq<=snapshot.table.lastSeq?fromSnapshot(held):undefined;
      if(built)roomRef.current=built;
      void mutate(current => current && current.lastSeq <= snapshot.table.lastSeq ? built ?? fromSnapshot(current) : current, { revalidate: false });
    });
    // A server that sends no patches never reaches this handler; the snapshots above and the GETs keep such a browser current.
    socket.on("remote:patch", patch => {
      if(patch.slug&&patch.slug!==slug) return;
      const held=roomRef.current;
      if(!held||held.slug!==slug){repair.ask(patch.seq,300);return;}
      const kind=classifyPatch(held.lastSeq,patch);
      if(kind==='stale') return; // our own action reply or a snapshot already gave this sequence
      if(kind==='repair'){repair.ask(patch.seq,300);return;}
      let next:RemoteRoom;
      try{next=applyRoomPatch(held,patch);}catch{repair.ask(patch.seq,300);return;}
      roomRef.current=next;lastSeq.current=Math.max(lastSeq.current,next.lastSeq);socketSeq.current=Math.max(socketSeq.current,next.lastSeq);
      markFieldState(next,'wsState');
      void mutate(current => current && current.lastSeq > next.lastSeq ? current : next, { revalidate: false });
    });
    socket.connect(); const timer = setInterval(() => void join(), 4 * 60_000);
    return () => { disposed = true; clearInterval(timer); socket.emit("remote:leave"); socket.disconnect(); socketRef.current = null; };
  }, [slug, mySeat, status, mutate, repair]);

  useEffect(()=>{if(!room)return;const frame=requestAnimationFrame(()=>markFieldState(room,'render'));return()=>cancelAnimationFrame(frame);},[room]);

  const operation = useCallback(async (path: string, body: unknown = {}) => {
    setBusy(true); setError("");
    try {
      await remoteApi(`/${slug}/${path}`, body);
      if (path === "leave") router.push("/duels/remote"); else await mutate();
      return true;
    } catch (e) { setError((e as Error).message); void mutate(); return false; } finally { setBusy(false); }
  }, [slug, router, mutate]);

  /** Lobby-only host setting; the server validates permissions and clears Ready marks. */
  const setBestOf = useCallback((bestOf: RemoteBestOf) => operation("format", { bestOf }), [operation]);

  // Bypass an outstanding SWR revalidation: recovery has its own bounded request.
  const refresh=useCallback(async()=>{
    const refreshed=await remoteApi<RemoteRoom>(`/${slug}`);
    if(tableKey.current!==slug||refreshed.slug!==slug)return;
    if(!roomRef.current||refreshed.lastSeq>=roomRef.current.lastSeq)roomRef.current=refreshed;
    lastSeq.current=Math.max(lastSeq.current,refreshed.lastSeq);
    await mutate(old=>old&&old.lastSeq>refreshed.lastSeq?old:refreshed,{revalidate:false});
  },[slug,mutate]);

  /** Posts one action; resolves to the updated room, or null when the foundation refused it. */
  const postAction = useCallback(async (payload: RemoteActionProposal, idempotencyKey = crypto.randomUUID()): Promise<RemoteRoom | null> => {
    const current = roomRef.current; if (tableKey.current!==slug||!current||current.slug!==slug) return null;
    const input = { baseSeq: Math.max(current.lastSeq, lastSeq.current), action: { ...payload, idempotencyKey } as RemoteAction };
    setError("");
    try {
      markFieldAction(idempotencyKey,'httpStart');
      const updated = await remoteApi<RemoteRoom>(`/${slug}/actions`, input);
      markFieldState(updated,'httpState');
      if(tableKey.current!==slug)return updated;
      lastSeq.current = Math.max(lastSeq.current, updated.lastSeq);
      if(!roomRef.current||roomRef.current.slug!==slug||updated.lastSeq>=roomRef.current.lastSeq)roomRef.current = updated; // a patch may have moved the room past this reply
      await mutate(old => old && old.lastSeq > updated.lastSeq ? old : updated, { revalidate: false });
      return updated;
    } catch (e) {
      if(tableKey.current!==slug)return null;
      noteRemoteActionError(e);setError((e as Error).message);
      try{await refresh();}catch{/* Keep the failed action recoverable during a network outage. */}
      return null;
    }
  }, [slug, mutate, refresh]);

  const {action,transaction}=useMemo(()=>createRoomMutationQueue(()=>tableKey.current===slug&&roomRef.current?.slug===slug?roomRef.current:undefined,postAction),[postAction,slug]);

  const sendData = useCallback((message: Parameters<RemoteClientEvents["remote:data"]>[0]) => { socketRef.current?.emit("remote:data", message); }, []);
  const onData = useCallback((handler: (payload: Parameters<RemoteServerEvents["remote:data"]>[0]) => void) => {
    dataHandlers.current.add(handler); return () => { dataHandlers.current.delete(handler); };
  }, []);

  return { slug, room, loadError, busy, error, setError, realtime, operation, setBestOf, action, transaction, mutate, sendData, onData };
}
