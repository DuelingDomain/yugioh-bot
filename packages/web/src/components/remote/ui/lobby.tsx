"use client";

import { useState } from "react";
import useSWR from "swr";
import { DUEL_BANLIST_OPTIONS } from "@yugidraft/shared/duels";
import { REMOTE_FORMATS, normalizeRemoteFormat, type RemoteRoom, type RemoteTable } from "@yugidraft/shared/remote";
import { duelFontClasses } from "@/components/duel/fonts";
import { COLORS } from "./model";
import { remoteApi, type RoomController } from "./use-remote-room";
import l from "./remote-lobby.module.css";

/** The table page is cross-origin isolated (COOP/COEP), so we reach it with a full document load. */
const go = (slug: string) => `/duels/remote/${slug}`;
const formatName = (id: string | undefined) => REMOTE_FORMATS.find(item => item.value === id)?.label ?? "Advanced";

function TableLinks({ title, tables, error }: { title: string; tables?: RemoteTable[]; error?: string }) {
  return <section className={l.card} aria-label={title}>
    <h2>{title}</h2>
    {error ? <p className={l.err} role="alert">{error}</p> : !tables ? <p className={l.note}>Loading tables…</p> : tables.length === 0 ? <p className={l.note}>No tables yet.</p> :
      <ul className={l.tables}>{tables.map(table => <li key={table.slug}>
        <a href={go(table.slug)} data-testid={`table-link-${table.slug}`}>
          <span>{table.slug}</span>
          <span className={l.tag}>{formatName(table.format?.id)}</span>
          {table.solo ? <span className={l.tag}>Solo test</span> : null}
          <span className={l.note}>{table.seats.length}/{table.seatCount} seats</span>
          <span className={`${l.tag} ${table.status === "active" ? l.tagLive : ""}`}>{table.status}</span>
        </a></li>)}</ul>}
  </section>;
}

/** /duels/remote: create a table and list yours and the open ones. */
export function RemoteLobby() {
  const [seatCount, setSeatCount] = useState(2); const [solo, setSolo] = useState(false); const [format, setFormat] = useState<string>("normal");
  const [showCardsSetFromDeck,setShowCardsSetFromDeck]=useState(true);
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const mine = useSWR("remote:mine", () => remoteApi<{ tables: RemoteTable[] }>("?scope=mine"), { refreshInterval: 5000 });
  const open = useSWR("remote:open", () => remoteApi<{ tables: RemoteTable[] }>("?scope=open"), { refreshInterval: 5000 });
  async function create() {
    setBusy(true); setError("");
    try { const room = await remoteApi<RemoteRoom>("", { gameId: "ygo", seatCount, solo, format, showCardsSetFromDeck }); window.location.assign(go(room.slug)); }
    catch (e) { setError((e as Error).message); setBusy(false); }
  }
  return <div className={`${duelFontClasses} ${l.lobby}`} data-testid="remote-lobby">
    <div className={l.head}><h1>Remote Duels</h1><p className={l.sub}>Play with real cards on your webcam. The table keeps score.</p></div>
    <form className={l.card} onSubmit={event => { event.preventDefault(); void create(); }} aria-label="Create a table">
      <h2>New table</h2>
      <div className={l.row}>
        <label className={l.field}>Game<select disabled><option>Yu-Gi-Oh!</option></select></label>
        <label className={l.field}>Duel format<select value={format} onChange={e => setFormat(e.target.value)} data-testid="create-format">
          {REMOTE_FORMATS.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
        <label className={l.field}>Seats<select value={seatCount} onChange={e => setSeatCount(Number(e.target.value))} data-testid="create-seats">
          {[2, 3, 4].map(n => <option key={n} value={n}>{n === 2 ? "2 (1 v 1)" : n === 3 ? "3 (free for all)" : "4 (free for all)"}</option>)}</select></label>
        <label className={l.check}><input type="checkbox" checked={solo} onChange={e => setSolo(e.target.checked)} data-testid="create-solo" />Solo test with bots</label>
        <label className={l.check}><input type="checkbox" checked={showCardsSetFromDeck} onChange={e=>setShowCardsSetFromDeck(e.target.checked)} />Cards Set from Deck are shown to all</label>
        <button className={`${l.btn} ${l.go}`} disabled={busy} data-testid="create-table">{busy ? "Creating…" : "Create table"}</button>
      </div>
      <p className={l.note}>Also applies to cards searched from Deck to hand. Candidate lists are visible only to the controller.</p>
      {solo ? <p className={l.note}>One webcam player with {seatCount - 1} test {seatCount === 2 ? "opponent" : "opponents"} you control. The camera stays on this device. No video server needed.</p> : null}
      {error ? <p className={l.err} role="alert">{error}</p> : null}
    </form>
    <div className={l.lists}>
      <TableLinks title="Your tables" tables={mine.data?.tables} error={mine.error?.message} />
      <TableLinks title="Open tables" tables={open.data?.tables} error={open.error?.message} />
    </div>
  </div>;
}

/** The setup room of a table that has not started: seats, decks, rules, ready, start. */
export function RemoteLobbyRoom({ ctl, room }: { ctl: RoomController; room: RemoteRoom }) {
  const { operation, busy, error } = ctl;
  const saved = useSWR("remote:saved-decks", async () => {
    const response = await fetch("/api/decks", { cache: "no-store" }); const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? "Could not load saved decks");
    return data as { decks: { id: number; name: string }[] };
  });
  const current = room.format ?? normalizeRemoteFormat();
  const [format, setFormat] = useState<string>(current.id);
  const [banlist, setBanlist] = useState(current.settings.banlist);
  const [points, setPoints] = useState(current.settings.genesys?.pointCap ?? 100);
  const [lp, setLp] = useState(current.settings.startingLP);
  const [publicityDraft,setPublicityDraft]=useState<boolean|null>(null);
  const showCardsSetFromDeck=publicityDraft ?? room.showCardsSetFromDeck ?? true;
  const me = room.seats.find(seat => seat.seat === room.mySeat);
  const host = me?.userId === room.createdBy;
  const decks = saved.data?.decks ?? [];
  const blocked = !me?.ready && ((!room.solo && !me?.deck) || !!me?.deck?.validation.issues.length);
  return <div className={`${duelFontClasses} ${l.lobby}`} data-testid="remote-lobby-room">
    <div className={l.head}><h1>{room.solo ? "Solo test" : "Remote table"}</h1><span className={l.slug}>{room.slug}</span>
      <span className={l.tag}>{formatName(current.id)}</span><span className={l.tag}>{room.seatCount} seats</span></div>
    <p className={l.status} role="status">{ctl.realtime}</p>
    {error ? <p className={l.err} role="alert">{error}</p> : saved.error ? <p className={l.err} role="alert">{saved.error.message}</p> : null}

    <form className={l.card} aria-label="Rules" onSubmit={e => { e.preventDefault();
      void operation("format", { format, showCardsSetFromDeck, rules: { banlist, startingLP: lp, ...(format.includes("genesys") ? { genesys: { pointCap: points } } : {}) } }).then(()=>setPublicityDraft(null)); }}>
      <h2>Rules</h2>
      <fieldset disabled={busy || !host} className={l.row} style={{ border: 0, padding: 0, margin: 0 }}>
        <label className={l.field}>Duel format<select value={format} data-testid="room-format" onChange={e => { setFormat(e.target.value); setBanlist(normalizeRemoteFormat(e.target.value).settings.banlist); }}>
          {REMOTE_FORMATS.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
        {format.includes("genesys")
          ? <label className={l.field}>Genesys point cap<input type="number" min={0} max={1000} value={points} onChange={e => setPoints(Number(e.target.value))} /></label>
          : <label className={l.field}>Banlist<select value={banlist} onChange={e => setBanlist(e.target.value)}>
            {DUEL_BANLIST_OPTIONS.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>}
        <label className={l.field}>Starting LP<input type="number" min={1} max={100000} value={lp} onChange={e => setLp(Number(e.target.value))} /></label>
        <label className={l.check}><input type="checkbox" checked={showCardsSetFromDeck} onChange={e=>setPublicityDraft(e.target.checked)} />Cards Set from Deck are shown to all</label>
        {host ? <button className={l.btn} data-testid="apply-rules">Apply rules</button> : null}
      </fieldset>
      <p className={l.note}>Also applies to cards searched from Deck to hand. Candidate lists are visible only to the controller.</p>
      <p className={l.note}>{host ? "Changing the rules clears every ready mark." : "Only the host changes the rules."}</p>
    </form>

    <section className={l.card} aria-label="Seats and decks">
      <h2>Seats and decks</h2>
      <div className={l.seats}>{room.seats.map(seat => {
        const editable = room.solo || seat.seat === room.mySeat;
        const choices = decks.some(deck => deck.id === seat.deck?.savedDeckId) || !seat.deck ? decks : [...decks, { id: seat.deck.savedDeckId, name: seat.deck.name }];
        return <div key={seat.seat} className={`${l.seat} ${seat.seat === room.mySeat ? l.me : ""}`} data-testid={`lobby-seat-${seat.seat}`}>
          <span className={l.dot} style={{ background: `rgb(${COLORS[seat.seat]})` }} aria-hidden="true" />
          <div className={l.who}>{seat.displayName}{seat.bot ? <span className={l.tag}>Test opponent</span> : null}
            {seat.seat === room.mySeat ? <span className={l.tag}>You</span> : null}
            {seat.ready ? <span className={l.ready}>Ready</span> : <span className={l.wait}>Not ready</span>}</div>
          <div className={l.deckrow}>
            <label className={l.field}>Deck<select disabled={busy || !editable} value={seat.deck?.savedDeckId ?? ""} data-testid={`deck-${seat.seat}`}
              onChange={e => void operation("deck", { savedDeckId: e.target.value ? Number(e.target.value) : null, seat: seat.seat })}>
              <option value="">{!editable ? seat.deckRegistered ? "Deck registered (private)" : "No deck selected" : room.solo ? "No deck (optional)" : "Choose a saved deck"}</option>
              {choices.map(deck => <option key={deck.id} value={deck.id}>{deck.name}</option>)}</select></label>
            {seat.deck?.validation.issues.length ? <ul className={l.issues} role="alert">{seat.deck.validation.issues.map((issue, i) => <li key={i}>{issue.message}</li>)}</ul>
              : seat.deck ? <p className={l.valid}>Valid for this table.</p> : null}
          </div>
        </div>;
      })}
        {room.seats.length < room.seatCount ? <p className={l.note}>{room.seatCount - room.seats.length} open seat{room.seatCount - room.seats.length === 1 ? "" : "s"}. Share the link of this page.</p> : null}
      </div>
      <p className={l.note}>The table keeps a copy of the deck you pick. Live additions are shared with the table. Your saved deck stays unchanged.</p>
    </section>

    <div className={l.actions}>
      <button className={l.btn} disabled={busy || blocked} data-testid="ready" onClick={() => void operation("ready", { ready: !me?.ready })}>{me?.ready ? "Not ready" : "Ready"}</button>
      <button className={`${l.btn} ${l.go}`} disabled={busy} data-testid="start" onClick={() => void operation("start")}>Start table</button>
      <button className={`${l.btn} ${l.quiet}`} disabled={busy} onClick={() => void operation("leave")}>Leave table</button>
      <a className={l.back} href="/duels/remote">Back to remote tables</a>
    </div>
  </div>;
}
