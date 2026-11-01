"use client";

import { useState } from "react";
import { DUEL_BANLIST_OPTIONS } from "@yugidraft/shared/duels";
import { instanceLocation, normalizeRemoteFormat, REMOTE_FORMATS, type RemoteRoom } from "@yugidraft/shared/remote";
import { remoteButton as button, type RemoteDispatch } from "./remote-seat-panel";

export function RemoteSetupControls({ room, decks, busy, onOperation }: {
  room: RemoteRoom; decks: { id: number; name: string }[]; busy: boolean;
  onOperation: (path: string, body: unknown) => void;
}) {
  const current = room.format ?? normalizeRemoteFormat();
  const [format, setFormat] = useState<string>(current.id);
  const [banlist, setBanlist] = useState(current.settings.banlist);
  const [points, setPoints] = useState(current.settings.genesys?.pointCap ?? 100);
  const [lp, setLp] = useState(current.settings.startingLP);
  const host = room.seats.find(s => s.seat === room.mySeat)?.userId === room.createdBy;
  return <section aria-label="Deck and format setup" className="space-y-4 border-y border-current/20 py-4">
    <h2 className="text-lg font-semibold">Decks & rules</h2>
    <form onSubmit={e => {
      e.preventDefault();
      onOperation("format", { format, rules: { banlist, startingLP: lp, ...(format.includes("genesys") ? { genesys: { pointCap: points } } : {}) } });
    }}><fieldset disabled={busy || !host} className="flex flex-wrap items-end gap-3">
      <label className="grid gap-1 text-sm">Duel format<select className={button} value={format} onChange={e => {
        setFormat(e.target.value); setBanlist(normalizeRemoteFormat(e.target.value).settings.banlist);
      }}>{REMOTE_FORMATS.map(f => <option value={f.value} key={f.value}>{f.label}</option>)}</select></label>
      {format.includes("genesys") ? <label className="grid gap-1 text-sm">Genesys point cap<input className={button} type="number" min={0} max={1000} value={points} onChange={e => setPoints(Number(e.target.value))} /></label> :
        <label className="grid gap-1 text-sm">Banlist<select className={button} value={banlist} onChange={e => setBanlist(e.target.value)}>
          {DUEL_BANLIST_OPTIONS.map(list => <option key={list.id} value={list.id}>{list.label}</option>)}
        </select></label>}
      <label className="grid gap-1 text-sm">Starting LP<input className={button} type="number" min={1} max={100000} value={lp} onChange={e => setLp(Number(e.target.value))} /></label>
      {host ? <button className={button}>Apply rules</button> : null}
    </fieldset></form>
    <p className="text-xs opacity-70">Changing rules clears ready status. Genesys uses points instead of a banlist. Decks use the deck editor’s format checks.</p>
    {room.seats.map(seat => {
      const editable = room.solo || seat.seat === room.mySeat;
      const choices = decks.some(deck => deck.id === seat.deck?.savedDeckId) || !seat.deck ? decks : [...decks, { id: seat.deck.savedDeckId, name: seat.deck.name }];
      return <div className="space-y-2" key={seat.seat}>
        <label className="grid gap-1 text-sm">Deck for {seat.displayName}<select className={button} disabled={busy || !editable}
          value={seat.deck?.savedDeckId ?? ""} onChange={e => onOperation("deck", { savedDeckId: e.target.value ? Number(e.target.value) : null, seat: seat.seat })}>
          <option value="">{room.solo ? "No deck (optional)" : "Choose a saved deck"}</option>
          {choices.map(deck => <option key={deck.id} value={deck.id}>{deck.name}</option>)}
        </select></label>
        {seat.deck?.validation.issues.length ? <ul role="alert" className="space-y-1 text-sm">
          {seat.deck.validation.issues.map((issue, i) => <li key={i}>{issue.message}</li>)}
        </ul> : seat.deck ? <p className="text-sm">Valid for this table.</p> : null}
      </div>;
    })}
    <p className="text-xs opacity-70">The table keeps a copy of your selected deck. Live additions are shared with the table; your saved original stays available in Decks.</p>
  </section>;
}

export function RemoteDeckAssistant({ room, busy, onAction }: { room: RemoteRoom; busy: boolean; onAction: RemoteDispatch }) {
  const identified = room.state.identified;
  const code = identified?.cardId ?? identified?.passcode;
  const mayAdd = identified && (room.solo || identified.seat === room.mySeat) && !room.state.seats[identified.seat].eliminated;
  const flags = room.state.deckChecks?.flags ?? [];
  const dismissActor = room.solo ? room.seats.find(s => !room.state.seats[s.seat].eliminated)?.seat ?? room.mySeat : room.mySeat;
  return <section aria-label="Live deck checks" className="space-y-3">
    {identified ? <div className="space-y-2 border-l-2 border-current/30 pl-3">
      <p role="status">Identified {identified.name ?? "card " + code} · seat {identified.seat + 1} {identified.notInDecklist ? <span className="rounded border px-2 py-1 text-xs">Not in decklist</span> : null}</p>
      {identified.notInDecklist ? <>
        <button className={button} disabled={busy || room.status !== "active" || !mayAdd || !!identified.addErrors?.length || !code}
          onClick={() => onAction({ type: "deck.add", actorSeat: identified.seat, seat: identified.seat, cardId: code! })}>Add to decklist</button>
        {identified.addErrors?.length ? <ul className="space-y-1 text-sm">{identified.addErrors.map((error, i) => <li key={i}>{error}</li>)}</ul> : null}
      </> : null}
    </div> : null}
    {flags.length ? <div className="space-y-2">
      <h2 className="text-lg font-semibold">Live deck checks</h2>
      <p className="text-sm opacity-70">Assistive flags do not stop the duel.</p>
      {flags.map(flag => <div key={flag.id} className="space-y-2 rounded border border-current/30 p-3">
        <p>{room.seats.find(s => s.seat === flag.seat)?.displayName}: {flag.message}</p>
        {flag.dismissed ? <p className="text-sm opacity-60">Dismissed: {flag.reason}</p> : <button className={button} disabled={busy || room.status !== "active" || room.state.seats[dismissActor].eliminated}
          onClick={() => onAction({ type: "deck.flag.dismiss", actorSeat: dismissActor, flagId: flag.id, reason: "Player marked this flag as wrong" })}>Dismiss as wrong</button>}
      </div>)}
    </div> : null}
  </section>;
}

export function RemoteInstanceMerge({ room, seat, busy, onAction }: { room: RemoteRoom; seat: number; busy: boolean; onAction: RemoteDispatch }) {
  const instances = room.state.deckChecks?.instances.filter(i => i.seat === seat) ?? [];
  const [keep, setKeep] = useState(""); const [remove, setRemove] = useState("");
  if (instances.length < 2) return null;
  const kept = instances.find(i => i.id === keep);
  const choices = instances.filter(i => i.id !== keep && i.copyKey === kept?.copyKey);
  return <details className="border-t border-current/20 pt-3 text-sm">
    <summary className="cursor-pointer">Correct split card instances</summary>
    <form className="mt-3 space-y-2" onSubmit={e => { e.preventDefault(); onAction({ type: "twin.merge", actorSeat: seat, seat,
      keepInstanceId: keep, removeInstanceId: remove, reason: "Same physical card; system split the instance" }); setRemove(""); }}>
      <label className="grid gap-1">Keep instance<select className={button} value={keep} onChange={e => { setKeep(e.target.value); setRemove(""); }}>
        <option value="">Choose instance</option>{instances.map(i => <option key={i.id} value={i.id}>{i.name} · {instanceLocation(i)} · {i.public ? "public" : "hidden"} · {i.refs[0] ?? i.id}</option>)}
      </select></label>
      <label className="grid gap-1">Merge duplicate instance<select className={button} value={remove} onChange={e => setRemove(e.target.value)}>
        <option value="">Choose duplicate</option>{choices.map(i => <option key={i.id} value={i.id}>{i.name} · {instanceLocation(i)} · {i.refs[0] ?? i.id}</option>)}
      </select></label>
      <button className={button} disabled={busy || !kept || !choices.some(i => i.id === remove)}>Merge same physical card</button>
    </form>
  </details>;
}
