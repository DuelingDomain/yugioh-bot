"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { io, type Socket } from "socket.io-client";
import { ygoModule, type RemoteAction, type RemoteActionProposal, type RemoteRoom, type RemoteTable, type RemoteClientEvents, type RemoteServerEvents } from "@yugidraft/shared/remote";
import { RemoteSeatPanel } from "./remote-seat-panel";
import { LocalCamera } from "./local-camera";
import { RemoteCommands, proposalLabel } from "./remote-commands";

const button = "rounded border border-current px-3 py-2 text-sm disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-4";
async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api/remote${path}`, { cache: "no-store", ...(body === undefined ? {} : {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  }) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? "Could not update the table");
  return data;
}
export function RemoteTableList() {
  const router = useRouter(); const [seatCount, setSeatCount] = useState(2); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const [solo, setSolo] = useState(false);
  const mine = useSWR("remote:mine", () => api<{ tables: RemoteTable[] }>("?scope=mine"), { refreshInterval: 5000 });
  const open = useSWR("remote:open", () => api<{ tables: RemoteTable[] }>("?scope=open"), { refreshInterval: 5000 });
  async function create() {
    setBusy(true); setError("");
    try { const room = await api<RemoteRoom>("", { gameId: "ygo", seatCount, solo }); router.push(`/duels/remote/${room.slug}`); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <div className="mx-auto max-w-4xl space-y-6">
    <h1 className="text-2xl font-semibold">Remote Duels</h1>
    <form className="flex flex-wrap items-end gap-4" onSubmit={event => { event.preventDefault(); void create(); }}>
      <label className="grid gap-1">Game<select className={button} disabled><option>Yu-Gi-Oh!</option></select></label>
      <label className="grid gap-1">Seats<select className={button} value={seatCount} onChange={event => setSeatCount(Number(event.target.value))}>
        {[2, 3, 4].map(n => <option key={n} value={n}>{n}</option>)}
      </select></label>
      <label className="flex items-center gap-2 py-2"><input type="checkbox" checked={solo} onChange={event => setSolo(event.target.checked)} />Solo test</label>
      <button className={button} disabled={busy}>Create table</button>
    </form>
    {solo ? <p className="text-sm opacity-70">One webcam player with {seatCount - 1} owner-controlled test {seatCount === 2 ? "opponent" : "opponents"}. Local camera preview; no LiveKit needed.</p> : null}
    {error || mine.error || open.error ? <p role="alert">{error || mine.error?.message || open.error?.message}</p> : null}
    {([["Your tables", mine], ["Open tables", open]] as const).map(([label, result]) => <section className="space-y-2" key={label}>
      <h2 className="text-lg font-semibold">{label}</h2>
      {!result.data ? <p>Loading tables…</p> : result.data.tables.length === 0 ? <p>No tables yet.</p> : <ul className="space-y-2">
        {result.data.tables.map(table => <li key={table.slug}><Link className="underline" href={`/duels/remote/${table.slug}`}>
          {table.slug} · {table.gameId}{table.solo ? " · Solo test" : ""} · {table.seats.length}/{table.seatCount} seats · {table.status}
        </Link></li>)}
      </ul>}
    </section>)}
  </div>;
}

/** The API, reducer and shared event types remain the integration boundary. */
export function RemoteTableRoom({ slug }: { slug: string }) {
  const router = useRouter();
  const { data: room, error: loadError, mutate } = useSWR(`remote:${slug}`, () => api<RemoteRoom>(`/${slug}`), { refreshInterval: 5000 });
  const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [realtime, setRealtime] = useState("Connecting…");
  const [pending, setPending] = useState<{ baseSeq: number; action: RemoteAction } | null>(null);
  const [now, setNow] = useState(0);
  const [selectedSeat, setSelectedSeat] = useState(0); const [note, setNote] = useState("");
  const status = room?.status; const mySeat = room?.mySeat;
  useEffect(() => { const update = () => setNow(Date.now()); update(); const timer = setInterval(update, 250); return () => clearInterval(timer); }, []);
  useEffect(() => {
    if (mySeat === undefined || status === "ended") return;
    let disposed = false; let renewing = false;
    const socket: Socket<RemoteServerEvents, RemoteClientEvents> = io(process.env.NEXT_PUBLIC_WS_URL || undefined, { autoConnect: false });
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
    socket.on("remote:changed", snapshot => {
      if (snapshot.table.slug !== slug) return;
      void mutate(current => current && current.lastSeq <= snapshot.table.lastSeq
        ? { ...snapshot.table, state: snapshot.state, events: snapshot.events, mySeat: current.mySeat } : current, { revalidate: false });
    });
    socket.connect(); const timer = setInterval(() => void join(), 4 * 60_000);
    return () => { disposed = true; clearInterval(timer); socket.emit("remote:leave"); socket.disconnect(); };
  }, [slug, mySeat, status, mutate]);
  async function run(work: () => Promise<void>) {
    setBusy(true); setError("");
    try { await work(); } catch (e) { setError((e as Error).message); void mutate(); } finally { setBusy(false); }
  }
  async function operation(path: string, body: unknown = {}) {
    await run(async () => { await api(`/${slug}/${path}`, body); if (path === "leave") router.push("/duels/remote"); else await mutate(); });
  }
  async function postAction(input: { baseSeq: number; action: RemoteAction }) {
    await run(async () => {
      const updated = await api<RemoteRoom>(`/${slug}/actions`, input); setPending(null);
      await mutate(current => current && current.lastSeq > updated.lastSeq ? current : updated, { revalidate: false });
    });
  }
  function action(payload: RemoteActionProposal) {
    if (!room) return;
    const input = { baseSeq: room.lastSeq, action: { ...payload, idempotencyKey: crypto.randomUUID() } as RemoteAction };
    setPending(input); void postAction(input);
  }
  const undo = room?.state.undo;
  const canUndo = undo && now - undo.at <= 5000 && room?.endReason !== "idle";
  const actingSeat = room?.solo ? selectedSeat : room?.mySeat ?? 0;
  const turnActor = room?.solo ? room.state.seats.find(s => s.seat === room.state.turnSeat && !s.eliminated)?.seat ?? room.state.seats.find(s => !s.eliminated)?.seat ?? 0 : room?.mySeat ?? 0;
  return <div className="mx-auto max-w-7xl space-y-5">
    <h1 className="text-2xl font-semibold">{room?.solo ? "Solo test" : "Remote table"} <span className="font-mono text-lg opacity-60">{slug}</span></h1>
    <p role="status">{room?.status === "ended" ? "Table ended" : realtime}</p>
    {error ? <p role="alert">{error}</p> : null}
    {!room ? <div className="space-y-3"><p>{loadError ? `${loadError.message}. Join an open seat to enter.` : "Loading table…"}</p>
      <button className={button} disabled={busy} onClick={() => void operation("seat")}>Join available seat</button>
    </div> : <>
      <p>{room.seats.map(s => `${s.displayName} (seat ${s.seat + 1}${s.ready ? ", ready" : ""})`).join(" · ")}</p>
      {room.solo ? <p className="text-sm opacity-70">You control every seat. Test opponents have no camera. Phase and turn buttons control the current turn; choose a seat for voice commands and attacks.</p> : null}
      {room.idleWarningAt && room.status !== "ended" ? <p role="alert">This table will close after 10 minutes without an action.</p> : null}
      <div className="flex flex-wrap gap-3">
        {room.status === "lobby" ? <>
          <button className={button} disabled={busy} onClick={() => void operation("ready", { ready: !room.seats.find(s => s.seat === room.mySeat)?.ready })}>Toggle ready</button>
          <button className={button} disabled={busy} onClick={() => void operation("start")}>Start table</button>
          <button className={button} disabled={busy} onClick={() => void operation("leave")}>Leave table</button>
        </> : room.status === "active" ? <>
          <button className={button} disabled={busy} onClick={() => action({ type: "phase.advance", actorSeat: turnActor })}>Next phase</button>
          <button className={button} disabled={busy} onClick={() => action({ type: "turn.end", actorSeat: turnActor })}>End turn</button>
          <label className="flex items-center gap-2 text-sm">Acting as<select className={button} value={actingSeat} disabled={!room.solo || busy} onChange={e => setSelectedSeat(Number(e.target.value))}>
            {room.seats.filter(s => room.solo || s.seat === room.mySeat).map(s => <option key={s.seat} value={s.seat}>{s.displayName}{room.state.seats[s.seat].eliminated ? " (eliminated)" : ""}</option>)}
          </select></label>
          <button className={button} disabled={busy} onClick={() => action({ type: "log.note", actorSeat: turnActor, text: "Still playing" })}>Still playing</button>
          <button className={button} disabled={busy || room.state.seats[actingSeat].eliminated} onClick={() => action({ type: "player.concede", actorSeat: actingSeat })}>Concede selected seat</button>
        </> : null}
        {canUndo ? <button className={button} disabled={busy} onClick={() => action({ type: "undo", actorSeat: actingSeat, targetActionId: undo.actionId })}>Undo last action</button> : null}
        {pending && error ? <button className={button} disabled={busy} onClick={() => void postAction(pending)}>Retry last action</button> : null}
      </div>
      <p className="border-y border-current/20 py-3 font-mono">Turn {room.state.turn} · {room.seats.find(s => s.seat === room.state.turnSeat)?.displayName} · {ygoModule.phases.find(p => p.id === room.state.phase)?.name}{room.state.ended ? ` · Winner: ${room.seats.find(s => s.seat === room.state.winnerSeat)?.displayName ?? "none"}` : ""}</p>
      <div className={`grid items-start gap-4 ${room.seatCount === 3 ? "lg:grid-cols-3" : "md:grid-cols-2"}`}>
        {room.seats.map(seat => <RemoteSeatPanel key={seat.seat} seat={seat} state={room.state.seats[seat.seat]} editable={room.solo || seat.seat === room.mySeat} busy={busy || room.status !== "active"} onAction={action}>
          {seat.seat === room.mySeat ? <LocalCamera disabled={busy || room.status !== "active"} onIdentify={card => action({ type: "card.identified", actorSeat: room.mySeat, seat: room.mySeat, cardId: card.id, source: "click" })} /> : <div className="flex aspect-video items-center justify-center border border-dashed border-current/20 text-sm opacity-60">Remote video provider pending</div>}
        </RemoteSeatPanel>)}
      </div>
      {room.state.identified ? <p role="status">Identified card {room.state.identified.cardId ?? room.state.identified.passcode} · seat {room.state.identified.seat + 1}</p> : null}
      {room.status === "active" ? <>
        {room.state.attack ? <section className="space-y-2 rounded border border-current p-4" aria-label="Pending attack">
          <p>Pending attack: seat {room.state.attack.attackerSeat + 1} → seat {room.state.attack.targetSeat + 1}{room.state.attack.direct ? " (direct)" : ""}</p>
          {(["resolved", "cancelled"] as const).map(outcome => <button key={outcome} className={button} disabled={busy} onClick={() => action({ type: "attack.resolve", actorSeat: room.solo ? room.state.attack!.attackerSeat : room.mySeat, attackId: room.state.attack!.id, outcome })}>{outcome === "resolved" ? "Resolve attack" : "Cancel attack"}</button>)}
        </section> : null}
        <RemoteCommands room={room} actorSeat={actingSeat} busy={busy} onAction={action} />
      </> : null}
      <section className="space-y-3 border-t border-current/20 pt-4" aria-label="Event log">
        <h2 className="text-lg font-semibold">Event log</h2>
        {room.status === "active" ? <form className="flex gap-2" onSubmit={e => { e.preventDefault(); action({ type: "log.note", actorSeat: turnActor, text: note.trim() }); setNote(""); }}>
          <label className="grid flex-1 gap-1 text-sm">Note<input className={button} maxLength={500} value={note} onChange={e => setNote(e.target.value)} /></label>
          <button className={`${button} self-end`} disabled={busy || !note.trim()}>Add note</button>
        </form> : null}
        <ol className="max-h-72 space-y-1 overflow-auto text-sm">{room.events.map(event => <li key={event.id}>
          <span className="font-mono opacity-50">#{event.seq}</span> {event.actorSeat === null ? "System" : room.seats.find(s => s.seat === event.actorSeat)?.displayName ?? `Seat ${event.actorSeat + 1}`} · {"idempotencyKey" in event.action ? proposalLabel(event.action) : event.action.type.replaceAll(".", " ")}
        </li>)}</ol>
      </section>
      <details><summary className="cursor-pointer text-sm opacity-60">Table data</summary><pre className="max-h-[65vh] overflow-auto rounded border border-current p-4 text-xs" aria-label="Remote table state">{JSON.stringify(room, null, 2)}</pre></details>
    </>}
    <Link className="underline" href="/duels/remote">Back to remote tables</Link>
  </div>;
}
