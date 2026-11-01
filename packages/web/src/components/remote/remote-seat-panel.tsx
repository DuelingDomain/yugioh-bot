"use client";

import { useState, type ReactNode } from "react";
import { ygoModule, type RemoteActionProposal, type RemoteSeat, type RemoteSeatState } from "@yugidraft/shared/remote";

export const remoteButton = "rounded border border-current px-3 py-2 text-sm disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-4";
export type RemoteDispatch = (proposal: RemoteActionProposal) => void;

export function RemoteSeatPanel({ seat, state, editable, busy, onAction, children }: {
  seat: RemoteSeat; state: RemoteSeatState; editable: boolean; busy: boolean; onAction: RemoteDispatch; children?: ReactNode;
}) {
  const [name, setName] = useState(""); const [race, setRace] = useState(""); const [cardId, setCardId] = useState("");
  const [zone, setZone] = useState("monster"); const [slot, setSlot] = useState("1"); const [faceDown, setFaceDown] = useState(false);
  const [amount, setAmount] = useState(500);
  const actorSeat = seat.seat;
  const blocked = busy || !editable || state.eliminated;
  return <section aria-label={seat.displayName} className="min-w-0 space-y-4 rounded border border-current/25 p-4">
    <header className="flex items-start justify-between gap-3">
      <div><h2 className="text-lg font-semibold">{seat.displayName}</h2><p className="text-sm opacity-70">Seat {seat.seat + 1}{seat.bot ? " · Test opponent" : ""}{state.eliminated ? " · Eliminated" : ""}</p></div>
      <p className="font-mono text-2xl tabular-nums" aria-label={`${seat.displayName} LP`}>{state.resources.lp} <span className="text-xs">LP</span></p>
    </header>
    {seat.deck ? <p className="text-xs opacity-70">{seat.deck.name} · {seat.deck.deck.main.length} Main · {seat.deck.deck.extra.length} Extra · {seat.deck.deck.side.length} Side</p> : null}
    {seat.bot ? <div className="flex aspect-video items-center justify-center border border-dashed border-current/30 bg-current/5 text-center">
      <div><p className="text-2xl opacity-40" aria-hidden="true">◇</p><p className="text-sm">No camera · owner controlled</p></div>
    </div> : children}
    {editable ? <fieldset disabled={blocked} className="flex flex-wrap items-end gap-2">
      <label className="grid gap-1 text-xs">LP amount<input className={`${remoteButton} w-24`} type="number" min={1} max={999999} value={amount} onChange={e => setAmount(Number(e.target.value))} /></label>
      <button className={remoteButton} disabled={!Number.isInteger(amount) || amount <= 0 || amount > 999999} onClick={() => onAction({ type: "lp.change", actorSeat, seat: seat.seat, delta: -amount, reason: "Manual adjustment" })}>Subtract LP</button>
      <button className={remoteButton} disabled={!Number.isInteger(amount) || amount <= 0 || amount > 999999} onClick={() => onAction({ type: "lp.change", actorSeat, seat: seat.seat, delta: amount, reason: "Manual adjustment" })}>Add LP</button>
    </fieldset> : null}
    <div className="space-y-2">
      <h3 className="text-sm font-semibold uppercase tracking-wider">Board twin</h3>
      {state.twin.length === 0 ? <p className="text-sm opacity-60">Empty field</p> : <ul className="space-y-2">
        {state.twin.map(card => <li key={card.ref} className="space-y-2 border-l-2 border-current/30 pl-3 text-sm">
          <p>{card.faceUp ? card.name ?? `Card ${card.cardId ?? card.passcode ?? card.ref}` : "Face-down card"} · {card.position} · {card.zone}{card.slot ? ` · slot ${card.slot}` : ""}</p>
          {editable ? <fieldset disabled={blocked} className="flex flex-wrap gap-2">
            <button className={remoteButton} onClick={() => onAction({ type: "twin.flip", actorSeat, seat: seat.seat, cardRef: card.ref, faceUp: !card.faceUp })}>Flip {card.faceUp ? "down" : "up"}</button>
            <label className="sr-only" htmlFor={`move-${seat.seat}-${card.ref}`}>Move {card.ref}</label>
            <select id={`move-${seat.seat}-${card.ref}`} className={remoteButton} value={card.zone} onChange={e => onAction({ type: "twin.move", actorSeat, seat: seat.seat, cardRef: card.ref, zone: e.target.value })}>
              {ygoModule.zones.map(z => <option key={z.id} value={z.id}>{z.name}</option>)}
            </select>
            <label className="sr-only" htmlFor={`slot-${seat.seat}-${card.ref}`}>Slot for {card.ref}</label>
            <select id={`slot-${seat.seat}-${card.ref}`} className={remoteButton} value={card.slot ?? ""} onChange={e => onAction({ type: "twin.move", actorSeat, seat: seat.seat, cardRef: card.ref, zone: card.zone, slot: Number(e.target.value) })}>
              <option value="" disabled>No slot</option>{[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>Slot {n}</option>)}
            </select>
            <button className={remoteButton} onClick={() => onAction({ type: "twin.remove", actorSeat, seat: seat.seat, cardRef: card.ref })}>Remove</button>
          </fieldset> : null}
        </li>)}
      </ul>}
    </div>
    {editable ? <form onSubmit={e => {
      e.preventDefault();
      onAction({ type: "twin.place", actorSeat, seat: seat.seat, zone, card: {
        ref: crypto.randomUUID(), faceUp: !faceDown, position: "attack", slot: Number(slot),
        ...(!faceDown ? { ...(name.trim() ? { name: name.trim() } : {}), ...(race.trim() ? { race: race.trim() } : {}), ...(cardId ? { cardId: Number(cardId) } : {}) } : {}),
      } });
    }}><fieldset disabled={blocked} className="grid grid-cols-2 gap-2 border-t border-current/20 pt-3 text-xs">
      <label className="col-span-2 grid gap-1">Public card name<input className={remoteButton} value={name} maxLength={200} onChange={e => setName(e.target.value)} disabled={faceDown} /></label>
      <label className="grid gap-1">Race<input className={`${remoteButton} min-w-0`} value={race} maxLength={40} onChange={e => setRace(e.target.value)} disabled={faceDown} /></label>
      <label className="grid gap-1">Card ID<input className={`${remoteButton} min-w-0`} value={cardId} type="number" min={1} max={4294967295} onChange={e => setCardId(e.target.value)} disabled={faceDown} /></label>
      <label className="grid gap-1">Zone<select className={`${remoteButton} min-w-0`} value={zone} onChange={e => setZone(e.target.value)}>{ygoModule.zones.map(z => <option key={z.id} value={z.id}>{z.name}</option>)}</select></label>
      <label className="grid gap-1">Slot<select className={remoteButton} value={slot} onChange={e => setSlot(e.target.value)}>{[1, 2, 3, 4, 5].map(n => <option key={n}>{n}</option>)}</select></label>
      <label className="flex items-center gap-2"><input type="checkbox" checked={faceDown} onChange={e => setFaceDown(e.target.checked)} />Face down</label>
      <button className={remoteButton}>Place card</button>
    </fieldset></form> : null}
  </section>;
}
