"use client";

import { noteRemoteActionError } from "@/lib/remote/room-mutations";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { isTransientError, noteReachable, noteWriteLost, reconnecting as isReconnecting, subscribeReconnecting, wakeOutage, endOutage } from "@/lib/remote/outage";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { io, type Socket } from "socket.io-client";
import { remoteApi, tabId } from "./api";
import { cardInfo, preloadRoomCards } from "./catalog";
import { deckIdsOf } from "./model";
import type { RemoteAction, RemoteActionProposal, RemoteBestOf, RemoteClientEvents, RemoteRoom, RemoteServerEvents } from "@yugidraft/shared/remote";

import {markFieldState,stampedProposal} from '@/lib/remote/field-timing';
import {peerPreviews,publishPeerPreview,setPeerPreviewCardFacts} from '@/lib/remote/peer-preview';
import {applyRoomPatch,classifyPatch,createRepairScheduler,createRoomMutationQueue,hasPendingTwinConfirmation,remoteChangeNeedsFetch} from '@/lib/remote/room-mutations';
setPeerPreviewCardFacts(cardInfo);
export type RoomController = ReturnType<typeof useRemoteRoom>;
const PEER_REPAIR_MS = 150;

/** Loads one table, keeps it fresh from the socket (poll as backup: 30 s while the socket is joined, else 5 s) and posts actions. */
export function useRemoteRoom(slug: string, options: { watchAsAdmin?: boolean } = {}) {
  const watchAsAdmin = options.watchAsAdmin === true;
  const router = useRouter();
  const [realtime, setRealtime] = useState("Connecting…");
  // A person with no seat watches a public table. The spectate request also keeps the spectator slot, so this poll holds it.
  const spectating = useRef(false);
  const [watching, setWatching] = useState(false);
  // A GET that answers after a patch or an action reply must not put an older room back on screen.
  const roomRef = useRef<RemoteRoom | undefined>(undefined);
  const newest = useCallback((fetched: RemoteRoom) => { const held = roomRef.current; return held && held.slug === slug && held.lastSeq > fetched.lastSeq ? held : fetched; }, [slug]);
  const load = useCallback(async () => {
    // The Watch button of the admin list asks for the admin view; the server grants it to the owner list only, and a private table stays closed to everyone else.
    const watch = async () => { const view = await remoteApi<RemoteRoom>(`/${slug}/spectate`, watchAsAdmin ? { admin: true, tab: tabId } : { tab: tabId }); spectating.current = !!view.spectator; setWatching(spectating.current); return newest(view); };
    if (spectating.current || watchAsAdmin) return watch();
    try { return newest(await remoteApi<RemoteRoom>(`/${slug}`)); }
    catch (e) { const { status, code } = e as { status?: number; code?: string }; if (status === 404 || code === "SPECTATOR_READ_ONLY") return watch(); throw e; }
  }, [slug, newest, watchAsAdmin]);
  const { data: room, error: loadError, mutate } = useSWR(`remote:${slug}`, load, { refreshInterval: latest => /* A finished match has no socket; a rematch answer arrives by this poll. */ latest && latest.status === "ended" && latest.endReason === "game" && latest.mySeat >= 0 && !latest.solo && !latest.tournamentMatchId ? 2000 : realtime === "Connected" ? 30_000 : 5000, /* A hidden tab still receives video, so it must keep its slot. */ refreshWhenHidden: watching });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if(room&&(!roomRef.current||room.slug!==roomRef.current.slug||room.lastSeq>=roomRef.current.lastSeq))roomRef.current = room;
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; endOutage(); }; }, []);
  const lastSeq = useRef(0),tableKey=useRef(slug),socketSeq=useRef(0);
  if(tableKey.current!==slug){tableKey.current=slug;lastSeq.current=0;socketSeq.current=0;roomRef.current=room?.slug===slug?room:undefined;}
  const status = room?.status; const mySeat = room?.mySeat;
  const preparingDeckKey = room && room.mySeat >= 0 && (status === "lobby" || room.state.match.phase === "siding")
    ? deckIdsOf(room, room.mySeat).join(",") : "";
  useEffect(() => {
    const opened = roomRef.current;
    if (opened?.slug === slug && mySeat !== undefined && mySeat >= 0 && status !== "ended") {
      void preloadRoomCards(opened);
    }
  }, [slug, mySeat, status, preparingDeckKey]);
  const peerStamps = useRef(false);
  useEffect(() => {
    try { peerStamps.current = sessionStorage.getItem("remote-peer-latency") === "1"; } catch { /* Optional diagnostics. */ }
  }, []);
  const stampPeer = useCallback((view: RemoteRoom, stage: "httpState" | "wsState" | "render", previousSeq?: number, actionId?: string) => {
    if (!peerStamps.current) return;
    const at = performance.timeOrigin + performance.now();
    const emit = (seq: number, commitAt?: number) => window.dispatchEvent(new CustomEvent("remote-peer-latency", {
      detail: { slug: view.slug, seq, stage, at, commitAt },
    }));
    if (previousSeq !== undefined) {
      for (const event of view.events) if (event.seq > previousSeq) emit(event.seq, event.at);
      return;
    }
    const event = view.events.findLast(event => actionId === undefined ? event.seq === view.lastSeq :
      "idempotencyKey" in event.action && event.action.idempotencyKey === actionId);
    if (event) emit(event.seq, event.at);
  }, []);
  const [awaitingWrites] = useState(() => new Map<string, {
    slug: string; actorSeat: number; baseSeq: number; accept: (view: RemoteRoom) => void;
  }>());
  const acceptSocketWrites = useCallback((view: RemoteRoom, previousSeq: number) => {
    if (!awaitingWrites.size || view.lastSeq <= previousSeq) return;
    // Callers use the returned state and Undo entry for this write. If a
    // packet already includes later writes, wait for the action's own reply.
    const event = view.events.at(-1);
    if (event?.seq !== view.lastSeq || !("idempotencyKey" in event.action)) return;
    const entry = awaitingWrites.get(event.action.idempotencyKey);
    if (entry?.slug === view.slug && entry.actorSeat === event.actorSeat && event.seq > entry.baseSeq) entry.accept(view);
  }, [awaitingWrites]);
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
  // A spectator who closes the tab frees the slot at once, so a watching admin's badge and the count end quickly. A GET poll would take up to 90 s.
  useEffect(() => {
    const leave = () => { if (spectating.current) void fetch(`/api/remote/${slug}/spectate?tab=${tabId}`, { method: "DELETE", keepalive: true }).catch(() => undefined); };
    window.addEventListener("pagehide", leave);
    return () => window.removeEventListener("pagehide", leave);
  }, [slug]);
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
        socket.emit("remote:join", { token: data.token, patch: 1 }, result => {
          setRealtime(result.ok ? "Connected" : result.error);
          if (result.ok) repair.ask(0, 500);
        });
      } catch { if (!disposed) setRealtime("Realtime unavailable; refreshing every 5 seconds"); }
      finally { renewing = false; }
    }
    socket.on("connect", () => { wakeOutage(); void join(); });
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
      if(remoteChangeNeedsFetch(held,snapshot.table.lastSeq)) repair.ask(snapshot.table.lastSeq, PEER_REPAIR_MS);
    });
    socket.on("remote:private", snapshot => {
      if (snapshot.table.slug !== slug) return;
      markFieldState({...snapshot.table,state:snapshot.state} as RemoteRoom,'wsState');
      const held=roomRef.current;
      if(held&&held.slug===slug&&held.lastSeq<=snapshot.table.lastSeq)socketSeq.current=Math.max(socketSeq.current,snapshot.table.lastSeq);
      const fromSnapshot = (current: RemoteRoom): RemoteRoom => ({ ...snapshot.table, state: snapshot.state, events: snapshot.events, mySeat: current.mySeat, isDeveloper: current.isDeveloper, recordingEnabled: current.recordingEnabled, unsureNamesEnabled: current.unsureNamesEnabled, voiceEnabled: current.voiceEnabled, voiceDiagnosticsEnabled: current.voiceDiagnosticsEnabled, spectator: current.spectator, spectatorCount: snapshot.table.spectatorCount ?? current.spectatorCount });
      // The held room moves now, so a patch that follows at once builds on this snapshot.
      const built=held&&held.slug===slug&&held.lastSeq<=snapshot.table.lastSeq?fromSnapshot(held):undefined;
      if(held&&built){
        roomRef.current=built;
        if(built.lastSeq>held.lastSeq)stampPeer(built,"wsState",held.lastSeq);
        acceptSocketWrites(built, held.lastSeq);
      }
      void mutate(current => current && current.lastSeq <= snapshot.table.lastSeq ? built ?? fromSnapshot(current) : current, { revalidate: false });
    });
    // A server that sends no patches never reaches this handler; the snapshots above and the GETs keep such a browser current.
    socket.on("remote:patch", patch => {
      if(patch.slug&&patch.slug!==slug) return;
      const held=roomRef.current;
      if(!held||held.slug!==slug){repair.ask(patch.seq,PEER_REPAIR_MS);return;}
      const kind=classifyPatch(held.lastSeq,patch);
      if(kind==='stale') return; // our own action reply or a snapshot already gave this sequence
      if(kind==='repair'){repair.ask(patch.seq,PEER_REPAIR_MS);return;}
      let next:RemoteRoom;
      try{next=applyRoomPatch(held,patch);}catch{repair.ask(patch.seq,PEER_REPAIR_MS);return;}
      roomRef.current=next;lastSeq.current=Math.max(lastSeq.current,next.lastSeq);socketSeq.current=Math.max(socketSeq.current,next.lastSeq);
      markFieldState(next,'wsState');
      stampPeer(next,"wsState",held.lastSeq);
      acceptSocketWrites(next, held.lastSeq);
      void mutate(current => current && current.lastSeq > next.lastSeq ? current : next, { revalidate: false });
    });
    socket.connect(); const timer = setInterval(() => void join(), 4 * 60_000);
    return () => { disposed = true; clearInterval(timer); socket.emit("remote:leave"); socket.disconnect(); socketRef.current = null; };
  }, [slug, mySeat, status, mutate, repair, stampPeer, acceptSocketWrites]);

  useEffect(()=>{
    if(!room)return;
    const frame=requestAnimationFrame(()=>{
      markFieldState(room,'render');
      stampPeer(room,"render");
    });
    return()=>cancelAnimationFrame(frame);
  },[room,stampPeer]);
  useEffect(()=>{peerPreviews.clear();return()=>peerPreviews.clear();},[slug]);
  useEffect(()=>{peerPreviews.setMySeat(mySeat);},[mySeat]);
  useEffect(()=>{
    if(room?.slug===slug)peerPreviews.confirmRoom(room);
  },[room,slug]);

  const operation = useCallback(async (path: string, body: unknown = {}) => {
    setBusy(true); setError("");
    try {
      await remoteApi(`/${slug}/${path}`, body);
      if (path === "leave") router.push("/duels"); else await mutate();
      return true;
    } catch (e) { setError(isTransientError(e) ? "Could not reach the table. Try again in a moment." : (e as Error).message); void mutate(); return false; } finally { setBusy(false); }
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
  const refreshAfterWrite = useMemo(() => {
    let pending: Promise<void> | undefined;
    return () => pending ??= refresh().finally(() => { pending = undefined; });
  }, [refresh]);

  /** Posts one action; resolves to the updated room, or null when the foundation refused it. */
  const postAction = useCallback(async (payload: RemoteActionProposal, idempotencyKey = crypto.randomUUID()): Promise<RemoteRoom | null> => {
    // The page is gone: a refusal (not a lost write), so no retry loop goes on for a table nobody looks at.
    if (!mounted.current) return null;
    const current = roomRef.current; if (tableKey.current!==slug||!current||current.slug!==slug) return null;
    const input = { baseSeq: Math.max(current.lastSeq, lastSeq.current), action: { ...stampedProposal(payload, idempotencyKey, !!current.seats?.find(seat => seat.seat === payload.actorSeat)?.bot), idempotencyKey } as RemoteAction };
    let attemptedSeq = input.baseSeq;
    const listenForAck = socketRef.current?.connected && !awaitingWrites.has(idempotencyKey);
    const stop = listenForAck ? new AbortController() : undefined;
    const socketAck = listenForAck && new Promise<RemoteRoom>(accept => {
      awaitingWrites.set(idempotencyKey, {slug, actorSeat: payload.actorSeat, baseSeq: input.baseSeq, accept});
    });
    setError("");
    try {
      const path = `/${slug}/actions`;
      const http = remoteApi<RemoteRoom>(path, input, stop?.signal).catch(async error => {
        if (error?.code !== "STALE_SEQUENCE" || (payload.type !== "log.note" && payload.type !== "chain.respond" && payload.type !== "chain.thinking" && payload.type !== "chain.ok" && payload.type !== "match.first") || tableKey.current !== slug || !mounted.current) throw error;
        if ((roomRef.current?.lastSeq ?? 0) <= input.baseSeq) {
          try { await refreshAfterWrite(); } catch { throw error; }
        }
        const held = roomRef.current;
        if (stop?.signal.aborted || !mounted.current || !held || held.slug !== slug || held.status !== "active" || held.lastSeq <= input.baseSeq ||
          held.state.gameId !== current.state.gameId || hasPendingTwinConfirmation(current) || hasPendingTwinConfirmation(held)) throw error;
        // Retry a log note, a response or a first-player choice with its original stamp. Camera retries revalidate physical evidence in the watcher.
        attemptedSeq = held.lastSeq;
        return remoteApi<RemoteRoom>(path, { ...input, baseSeq: attemptedSeq }, stop?.signal);
      });
      // The action is committed as soon as its exact key appears in the room.
      // Keep ordered writes moving even when the HTTP reply is delayed.
      const result = socketAck ? await Promise.race([
        http.then(view => ({ view, socket: false })),
        socketAck.then(view => ({ view, socket: true })),
      ]) : {view: await http, socket: false};
      if (result.socket) { stop?.abort(); noteReachable(); return result.view; }
      const updated = result.view;
      markFieldState(updated,'httpState');
      stampPeer(updated,"httpState",undefined,idempotencyKey);
      if(tableKey.current!==slug)return updated;
      lastSeq.current = Math.max(lastSeq.current, updated.lastSeq);
      if(!roomRef.current||roomRef.current.slug!==slug||updated.lastSeq>=roomRef.current.lastSeq)roomRef.current = updated; // a patch may have moved the room past this reply
      void mutate(old => old && old.lastSeq > updated.lastSeq ? old : updated, { revalidate: false });
      return updated;
    } catch (e) {
      if(tableKey.current!==slug)return null;
      // A lost connection is not a refusal: no error text. The queue retries with the same key; the shared "Reconnecting…" notice shows.
      if(isTransientError(e)){noteWriteLost();console.warn('[remote] action not sent, connection lost',e);return null;}
      noteRemoteActionError(e);setError((e as Error).message);
      if (e && (e as {code?: string}).code === "STALE_SEQUENCE" && (roomRef.current?.lastSeq ?? 0) > attemptedSeq) return null;
      try{await refreshAfterWrite();}catch{/* Keep the failed action recoverable during a network outage. */}
      return null;
    } finally {
      if (listenForAck) awaitingWrites.delete(idempotencyKey);
    }
  }, [slug, mutate, refreshAfterWrite, stampPeer, awaitingWrites]);

  const {action,transaction}=useMemo(()=>createRoomMutationQueue(
    ()=>tableKey.current===slug&&roomRef.current?.slug===slug?roomRef.current:undefined,
    postAction,
    e=>{noteRemoteActionError(e);setError(e.message);void refreshAfterWrite().catch(()=>undefined);},
    ()=>mounted.current&&tableKey.current===slug&&roomRef.current?.slug===slug,
    (proposal,key,current)=>{publishPeerPreview(current,proposal,key);},
  ),[postAction,refreshAfterWrite,slug]);
  const reconnecting = useSyncExternalStore(subscribeReconnecting, isReconnecting, () => false);

  const sendData = useCallback((message: Parameters<RemoteClientEvents["remote:data"]>[0]) => { socketRef.current?.emit("remote:data", message); }, []);
  const onData = useCallback((handler: (payload: Parameters<RemoteServerEvents["remote:data"]>[0]) => void) => {
    dataHandlers.current.add(handler); return () => { dataHandlers.current.delete(handler); };
  }, []);

  return { slug, room, loadError, busy, error, setError, reconnecting, realtime, operation, setBestOf, action, transaction, mutate, sendData, onData };
}
