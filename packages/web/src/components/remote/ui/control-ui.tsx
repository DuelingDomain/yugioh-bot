"use client";

import { useCallback, useState, type ReactNode } from "react";
import type { RemoteActionProposal, RemoteRoom } from "@yugidraft/shared/remote";
import type { ControlOffer } from "@/lib/remote/card-logic";
import type { CardInfo } from "./catalog";
import { cardCode, cardName, type TwinCard } from "./model";
import { PopupFrame } from "./popup";
import type { useLayers } from "./use-layers";
import s from "./remote-ui.module.css";
import t from "./stats-tokens.module.css";

type Act = (action: RemoteActionProposal) => Promise<RemoteRoom | null>;
const CENTER = { anchor: null, feed: null };
const MAIN = [1, 2, 3, 4, 5];
type Position = "attack" | "defense";
/** One dialog, three questions. `card` and `equip` pick a card; `place` asks the Monster Zone (and the position of a revived card). The table never guesses any of them. */
type View =
  | { step: "card"; seat: number; offer: ControlOffer }
  | { step: "place"; taker: number; from: number; card: TwinCard; revive: boolean; give?: boolean; position?: Position }
  | { step: "equip"; seat: number; card: TwinCard };

/** A card that is known not to be a monster (a Spell or Trap in a Graveyard). An unread card is not excluded. */
const knownNonMonster = (info: CardInfo | undefined) => !!info?.type && !/monster/i.test(info.type);

/**
 * Control change and equip links on a Remote Duels table. A card that is revived from a Graveyard, or taken from the opponent's field,
 * moves to my side with one twin.control action; "Return control" sends it back. The player always picks the card, the Monster Zone
 * and (for a revived card) the position: the table never guesses which one was meant. An activated card that takes control
 * (card logic) opens the picker by itself. A monster that equips itself asks which monster it equips.
 */
export function useControlChange({ act, room, live, layers, info, name, toast }: {
  act: Act; room: RemoteRoom; live: boolean; layers: ReturnType<typeof useLayers>; info: (id: number | undefined) => CardInfo | undefined;
  name: (seat: number) => string; toast: (text: string) => void;
}) {
  const { solo, mySeat, state } = room;
  const [view, setView] = useState<View | null>(null);
  const may = useCallback((seat: number) => live && (solo || seat === mySeat), [live, solo, mySeat]);
  const open = (next: View) => { setView(next); layers.open("control"); };
  const close = () => { layers.close("control"); setView(null); };
  const freeZones = (seat: number) => MAIN.filter(n => !state.seats[seat]?.twin.some(c => c.zone === "monster" && c.slot === n));

  /** "Take control" from the card menu: asks the zone first. A card in a Graveyard also asks its position. */
  const take = (taker: number, fromSeat: number, card: TwinCard) => {
    if (!freeZones(taker).length) { toast("Every Main Monster Zone is taken."); return false; }
    open({ step: "place", taker, from: fromSeat, card, revive: card.zone === "graveyard" || card.zone === "banished" });
    return true;
  };

  /** "Return control": a taken card goes back to its owner; the player picks the owner's zone. */
  const giveBack = (holder: number, card: TwinCard) => {
    const owner = card.ownerSeat; if (owner === undefined) return;
    if (!freeZones(owner).length) { toast("Every Main Monster Zone of the owner is taken."); return; }
    open({ step: "place", taker: owner, from: holder, card, revive: false, give: true });
  };

  const offer = (seat: number, wanted: ControlOffer | undefined) => {
    if (!wanted || !may(seat)) return;
    open({ step: "card", seat, offer: wanted });
  };

  /** A self-equipping monster in my Spell & Trap Zone: which monster does it equip? No link is made until the player clicks. */
  const askEquip = (seat: number, card: TwinCard) => {
    if (!may(seat) || layers.layer === "control") return false;
    open({ step: "equip", seat, card });
    return true;
  };

  const place = (v: Extract<View, { step: "place" }>, slot: number) => {
    const actorSeat = solo ? (v.give ? v.from : v.taker) : mySeat;
    const done = (updated: RemoteRoom | null) => { if (updated) close(); };
    // The player's own Graveyard: no control change, a plain move.
    if (v.from === v.taker) void act({ type: "twin.move", actorSeat, seat: v.taker, cardRef: v.card.ref, zone: "monster", slot, faceUp: true, position: v.position ?? "attack" }).then(done);
    else void act({ type: "twin.control", actorSeat, seat: v.from, toSeat: v.taker, cardRef: v.card.ref, zone: "monster", slot, faceUp: true,
      ...(v.revive && v.position ? { position: v.position } : {}) }).then(done);
  };

  const label = (card: TwinCard, seat: number, mine = false) => {
    const where = card.zone === "graveyard" ? "Graveyard" : card.zone === "monster" ? `M${card.slot ?? ""}` : card.zone === "extra-monster" ? `EMZ${card.slot ?? ""}` : card.zone;
    const known = card.faceUp || card.publicIdentity || card.zone === "graveyard";
    return `${known ? cardName(card, info(cardCode(card))) : "Face-down monster"} · ${mine ? "yours" : name(seat)} · ${where}`;
  };
  const btn = `${s.btn} ${s.sm} ${s.q}`;

  let body: ReactNode = null, heading = "";
  if (view?.step === "card") {
    heading = view.offer.title;
    const revive = view.offer.kind === "revive";
    // A revive may use either Graveyard (own first); a take-control effect only reaches an opponent's face-up monster.
    const candidates = state.seats.flatMap(other => {
      if (other.eliminated || (!revive && other.seat === view.seat)) return [];
      return other.twin.filter(c => revive ? c.zone === "graveyard" && !knownNonMonster(info(cardCode(c))) : c.zone === "monster" || c.zone === "extra-monster")
        .filter(c => revive || c.faceUp || c.publicIdentity).map(c => ({ card: c, seat: other.seat }));
    }).sort((a, b) => Number(b.seat === view.seat) - Number(a.seat === view.seat));
    body = <>
      <div className={t.pick} style={{ maxHeight: 240 }}>
        {candidates.map(({ card, seat }) => <button key={`${seat}:${card.ref}`} type="button" className={btn} data-testid="control-pick"
          onClick={() => { if (!freeZones(view.seat).length) { toast("Every Main Monster Zone is taken."); return; } setView({ step: "place", taker: view.seat, from: seat, card, revive }); }}>{label(card, seat, seat === view.seat)}</button>)}
        {!candidates.length ? <p className={t.note} role="status">{revive ? "No monster in a Graveyard." : "No opponent monster on the field."} Use the card menu when the table does not show it yet.</p> : null}
      </div>
      <div className={t.row}><button type="button" className={`${s.btn} ${s.q}`} onClick={close} data-testid="control-dismiss">Not now</button></div>
    </>;
  } else if (view?.step === "place") {
    const shown = view.card.faceUp || view.card.publicIdentity || view.card.zone === "graveyard" ? cardName(view.card, info(cardCode(view.card))) : "The card";
    heading = view.give ? `Return ${shown} to ${name(view.taker)}: which Monster Zone?` : `${shown}: which Monster Zone?`;
    // A revived card has no battle position yet: ask. A card taken from the field keeps the position it has.
    const needsPosition = view.revive || view.from === view.taker;
    body = <>
      {needsPosition ? <div className={s.seg} role="group" aria-label="Position">
        {(["attack", "defense"] as const).map(position => <button key={position} type="button" aria-pressed={view.position === position}
          data-testid={`control-position-${position}`} onClick={() => setView({ ...view, position })}>{position === "attack" ? "Attack (ATK)" : "Defense (DEF)"}</button>)}
      </div> : null}
      <div className={t.row} role="group" aria-label="Monster Zone">
        {freeZones(view.taker).map(n => <button key={n} type="button" className={btn} data-testid={`control-zone-M${n}`} disabled={needsPosition && !view.position}
          aria-label={`Monster Zone ${n}`} onClick={() => place(view, n)}>M{n}</button>)}
      </div>
      {needsPosition && !view.position ? <p className={t.chosen} role="status">Choose the position first.</p> : null}
      <div className={t.row}><button type="button" className={`${s.btn} ${s.q}`} onClick={close} data-testid="control-dismiss">Not now</button></div>
    </>;
  } else if (view?.step === "equip") {
    const card = view.card;
    heading = `${cardName(card, info(cardCode(card)))}: equipped to which monster?`;
    // Own monsters first, then the opponents'.
    const candidates = state.seats.flatMap(other => other.eliminated ? [] : other.twin.filter(c => (c.zone === "monster" || c.zone === "extra-monster") && c.ref !== card.ref).map(c => ({ card: c, seat: other.seat })))
      .sort((a, b) => Number(b.seat === view.seat) - Number(a.seat === view.seat));
    body = <>
      <div className={t.pick} style={{ maxHeight: 240 }}>
        {candidates.map(({ card: target, seat }) => <button key={`${seat}:${target.ref}`} type="button" className={btn} data-testid="equip-pick"
          onClick={() => { void act({ type: "twin.equip", actorSeat: solo ? view.seat : mySeat, seat: view.seat, cardRef: card.ref, target: { seat, ref: target.ref } }).then(done => { if (done) close(); }); }}>{label(target, seat, seat === view.seat)}</button>)}
        {!candidates.length ? <p className={t.note} role="status">No monster on the table yet. Use "Equipped to" in the card menu once it is placed.</p> : null}
      </div>
      <div className={t.row}><button type="button" className={`${s.btn} ${s.q}`} onClick={close} data-testid="control-dismiss">Not equipped</button></div>
    </>;
  }

  const node: ReactNode = layers.layer === "control" && view ? <PopupFrame at={CENTER} layer="control" label={heading} testid="control-dialog">
    <div className={t.dialog}><h3>{heading}</h3>{body}</div>
  </PopupFrame> : null;
  return { offer, take, giveBack, askEquip, node, may };
}
