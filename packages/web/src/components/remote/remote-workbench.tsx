"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { io, type Socket } from "socket.io-client";
import { ygoModule, type RemoteAction, type RemoteRoom, type RemoteTable, type RemoteClientEvents, type RemoteServerEvents } from "@yugidraft/shared/remote";

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
  const mine = useSWR("remote:mine", () => api<{ tables: RemoteTable[] }>("?scope=mine"), { refreshInterval: 5000 });
  const open = useSWR("remote:open", () => api<{ tables: RemoteTable[] }>("?scope=open"), { refreshInterval: 5000 });
  async function create() {
    setBusy(true); setError("");
    try { const room = await api<RemoteRoom>("", { gameId: "ygo", seatCount }); router.push(`/duels/remote/${room.slug}`); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <div className="mx-auto max-w-4xl space-y-6">
    <h1 className="text-2xl font-semibold">Remote Duels</h1>
    <form className="flex flex-wrap items-end gap-4" onSubmit={event => { event.preventDefault(); void create(); }}>
      <label className="grid gap-1">Game<select className={button} disabled><option>Yu-Gi-Oh!</option></select></label>
      <label className="grid gap-1">Seats<select className={button} value={seatCount} onChange={event => setSeatCount(Number(event.target.value))}>
        {[2, 3, 4].map(n => <option key={n} value={n}>{n}</option>)}
      </select></label>
      <button className={button} disabled={busy}>Create table</button>
    </form>
    {error || mine.error || open.error ? <p role="alert">{error || mine.error?.message || open.error?.message}</p> : null}
    {([["Your tables", mine], ["Open tables", open]] as const).map(([label, result]) => <section className="space-y-2" key={label}>
      <h2 className="text-lg font-semibold">{label}</h2>
      {!result.data ? <p>Loading tables…</p> : result.data.tables.length === 0 ? <p>No tables yet.</p> : <ul className="space-y-2">
        {result.data.tables.map(table => <li key={table.slug}><Link className="underline" href={`/duels/remote/${table.slug}`}>
          {table.slug} · {table.gameId} · {table.seats.length}/{table.seatCount} seats · {table.status}
        </Link></li>)}
      </ul>}
    </section>)}
  </div>;
}

/** Disposable proof UI. The API, reducer and shared event types are the integration boundary. */
export function RemoteTableRoom({ slug }: { slug: string }) {
  const router = useRouter();
  const { data: room, error: loadError, mutate } = useSWR(`remote:${slug}`, () => api<RemoteRoom>(`/${slug}`), { refreshInterval: 5000 });
  const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [realtime, setRealtime] = useState("Connecting…");
  const [pending, setPending] = useState<{ baseSeq: number; action: RemoteAction } | null>(null);
  const [now, setNow] = useState(0);
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
    await run(async () => { await api(`/${slug}/actions`, input); setPending(null); await mutate(); });
  }
  function action(payload: Record<string, unknown>) {
    if (!room) return;
    const input = { baseSeq: room.lastSeq, action: { ...payload, actorSeat: room.mySeat, idempotencyKey: crypto.randomUUID() } as RemoteAction };
    setPending(input); void postAction(input);
  }
  const undo = room?.state.undo;
  const canUndo = undo && now - undo.at <= 5000 && room?.endReason !== "idle";
  return <div className="mx-auto max-w-5xl space-y-5">
    <h1 className="text-2xl font-semibold">Remote table {slug}</h1>
    <p role="status">{room?.status === "ended" ? "Table ended" : realtime}</p>
    {error ? <p role="alert">{error}</p> : null}
    {!room ? <div className="space-y-3"><p>{loadError ? `${loadError.message}. Join an open seat to enter.` : "Loading table…"}</p>
      <button className={button} disabled={busy} onClick={() => void operation("seat")}>Join available seat</button>
    </div> : <>
      <p>{room.seats.map(s => `${s.displayName} (seat ${s.seat + 1}${s.ready ? ", ready" : ""})`).join(" · ")}</p>
      {room.idleWarningAt && room.status !== "ended" ? <p role="alert">This table will close after 10 minutes without an action.</p> : null}
      <div className="flex flex-wrap gap-3">
        {room.status === "lobby" ? <>
          <button className={button} disabled={busy} onClick={() => void operation("ready", { ready: !room.seats.find(s => s.seat === room.mySeat)?.ready })}>Toggle ready</button>
          <button className={button} disabled={busy} onClick={() => void operation("start")}>Start table</button>
          <button className={button} disabled={busy} onClick={() => void operation("leave")}>Leave table</button>
        </> : room.status === "active" ? <>
          <button className={button} disabled={busy} onClick={() => action({ type: "phase.advance" })}>Next phase</button>
          <button className={button} disabled={busy} onClick={() => action({ type: "turn.end" })}>End turn</button>
          <button className={button} disabled={busy} onClick={() => action({ type: "lp.change", seat: room.mySeat, delta: -500, reason: "Manual adjustment" })}>My LP −500</button>
          <button className={button} disabled={busy} onClick={() => action({ type: "lp.change", seat: room.mySeat, delta: 500, reason: "Manual adjustment" })}>My LP +500</button>
          <button className={button} disabled={busy} onClick={() => action({ type: "log.note", text: "Still playing" })}>Still playing</button>
          <button className={button} disabled={busy} onClick={() => action({ type: "player.concede" })}>Concede</button>
        </> : null}
        {canUndo ? <button className={button} disabled={busy} onClick={() => action({ type: "undo", targetActionId: undo.actionId })}>Undo last action</button> : null}
        {pending && error ? <button className={button} disabled={busy} onClick={() => void postAction(pending)}>Retry last action</button> : null}
      </div>
      <p>Turn {room.state.turn} · seat {room.state.turnSeat + 1} · {ygoModule.phases.find(p => p.id === room.state.phase)?.name}</p>
      <pre className="max-h-[65vh] overflow-auto rounded border border-current p-4 text-xs" aria-label="Remote table state">{JSON.stringify(room, null, 2)}</pre>
    </>}
    <Link className="underline" href="/duels/remote">Back to remote tables</Link>
  </div>;
}
