"use client";

import { useState } from "react";
import useSWR from "swr";
import { DUEL_BANLIST_OPTIONS } from "@yugidraft/shared/duels";
import { REMOTE_FORMATS, normalizeRemoteFormat, type RemoteRoom, type RemoteTable } from "@yugidraft/shared/remote";
import { duelFontClasses } from "@/components/duel/fonts";
import { COLORS } from "./model";
import { remoteApi, type RoomController } from "./use-remote-room";
import { remoteFormatName, remoteTableHref, useSavedDecks } from "./create";
import l from "./remote-lobby.module.css";

const go = remoteTableHref;
const formatName = remoteFormatName;

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

/** /duels/remote: the open and your own tables. Creating a table happens on the normal create screen. */
export function RemoteLobby() {
  const mine = useSWR("remote:mine", () => remoteApi<{ tables: RemoteTable[] }>("?scope=mine"), { refreshInterval: 5000 });
  const open = useSWR("remote:open", () => remoteApi<{ tables: RemoteTable[] }>("?scope=open"), { refreshInterval: 5000 });
  return <div className={`${duelFontClasses} ${l.lobby}`} data-testid="remote-lobby">
    <div className={l.head}><h1>Remote Duels</h1><p className={l.sub}>Play with real cards on your webcam. The table keeps score.</p></div>
    <div className={l.actions}>
      <a className={`${l.btn} ${l.go}`} href="/duels/new?type=remote" data-testid="new-remote-duel">New Remote Duel</a>
      <a className={l.back} href="/duels">Back to duels</a>
    </div>
    <div className={l.lists}>
      <TableLinks title="Your tables" tables={mine.data?.tables} error={mine.error?.message} />
      <TableLinks title="Open tables" tables={open.data?.tables} error={open.error?.message} />
    </div>
  </div>;
}

/** The setup room of a table that has not started: seats, decks, rules, ready, start. */
export function RemoteLobbyRoom({ ctl, room }: { ctl: RoomController; room: RemoteRoom }) {
  const { operation, busy, error } = ctl;
  const saved = useSavedDecks();
  const current = room.format ?? normalizeRemoteFormat();
  const [format, setFormat] = useState<string>(current.id);
  const [banlist, setBanlist] = useState(current.settings.banlist);
  const [points, setPoints] = useState(current.settings.genesys?.pointCap ?? 100);
  const [lp, setLp] = useState(current.settings.startingLP);
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
      void operation("format", { format, rules: { banlist, startingLP: lp, ...(format.includes("genesys") ? { genesys: { pointCap: points } } : {}) } }); }}>
      <h2>Rules</h2>
      <fieldset disabled={busy || !host} className={l.row} style={{ border: 0, padding: 0, margin: 0 }}>
        <label className={l.field}>Duel format<select value={format} data-testid="room-format" onChange={e => { setFormat(e.target.value); setBanlist(normalizeRemoteFormat(e.target.value).settings.banlist); }}>
          {REMOTE_FORMATS.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
        {format.includes("genesys")
          ? <label className={l.field}>Genesys point cap<input type="number" min={0} max={1000} value={points} onChange={e => setPoints(Number(e.target.value))} /></label>
          : <label className={l.field}>Banlist<select value={banlist} onChange={e => setBanlist(e.target.value)}>
            {DUEL_BANLIST_OPTIONS.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>}
        <label className={l.field}>Starting LP<input type="number" min={1} max={100000} value={lp} onChange={e => setLp(Number(e.target.value))} /></label>
        {host ? <button className={l.btn} data-testid="apply-rules">Apply rules</button> : null}
      </fieldset>
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
              <option value="">{room.solo ? "No deck (optional)" : "Choose a saved deck"}</option>
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
