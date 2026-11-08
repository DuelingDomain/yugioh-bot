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

/**
 * Control change on a Remote Duels table. A card that is revived from the opponent's Graveyard, or taken from their field,
 * moves to my side with one twin.control action; "Return control" sends it back. The player always picks the card: the table
 * never guesses which one was meant. An activated card that takes control (card logic) opens the picker by itself.
 */
export function useControlChange({ act, room, live, layers, info, name, toast }: {
  act: Act; room: RemoteRoom; live: boolean; layers: ReturnType<typeof useLayers>; info: (id: number | undefined) => CardInfo | undefined;
  name: (seat: number) => string; toast: (text: string) => void;
}) {
  const { solo, mySeat, state } = room;
  const [view, setView] = useState<{ seat: number; offer: ControlOffer } | null>(null);
  const may = useCallback((seat: number) => live && (solo || seat === mySeat), [live, solo, mySeat]);

  /** The taker's first free Main Monster Zone. The Extra Monster Zones belong to the engine's own rules, so a taken card never lands there. */
  const freeMonsterSlot = useCallback((seat: number) => MAIN.find(n => !state.seats[seat]?.twin.some(c => (c.zone === "monster") && c.slot === n)), [state.seats]);

  const take = useCallback((taker: number, fromSeat: number, card: TwinCard) => {
    const pile = card.zone === "graveyard" || card.zone === "banished";
    const slot = freeMonsterSlot(taker);
    if (!slot) { toast("Every Main Monster Zone is taken."); return false; }
    void act({ type: "twin.control", actorSeat: solo ? taker : mySeat, seat: fromSeat, toSeat: taker, cardRef: card.ref, zone: "monster", slot, faceUp: true,
      ...(pile ? { position: "attack" as const } : {}) });
    return true;
  }, [act, freeMonsterSlot, mySeat, solo, toast]);

  /** "Return control": a taken card goes back to its owner, to the same kind of place it holds now. */
  const giveBack = useCallback((holder: number, card: TwinCard) => {
    const owner = card.ownerSeat; if (owner === undefined) return;
    const slot = [1, 2, 3, 4, 5].find(n => !state.seats[owner]?.twin.some(c => c.zone === "monster" && c.slot === n));
    if (!slot) { toast("Every Main Monster Zone of the owner is taken."); return; }
    void act({ type: "twin.control", actorSeat: solo ? holder : mySeat, seat: holder, toSeat: owner, cardRef: card.ref, zone: "monster", slot, faceUp: true });
  }, [act, mySeat, solo, state.seats, toast]);

  const offer = useCallback((seat: number, wanted: ControlOffer | undefined) => {
    if (!wanted || !may(seat)) return;
    setView({ seat, offer: wanted }); layers.open("control");
  }, [may, layers]);
  const close = () => { layers.close("control"); setView(null); };

  const candidates = view ? state.seats.flatMap(other => {
    if (other.seat === view.seat || other.eliminated) return [];
    return other.twin.filter(c => view.offer.kind === "revive" ? c.zone === "graveyard" : c.zone === "monster" || c.zone === "extra-monster")
      .filter(c => c.faceUp || c.publicIdentity || view.offer.kind === "revive")
      .map(c => ({ card: c, seat: other.seat }));
  }) : [];
  const label = (card: TwinCard, seat: number) => {
    const known = card.faceUp || card.publicIdentity || card.zone === "graveyard";
    const place = card.zone === "graveyard" ? "Graveyard" : card.zone === "monster" ? `M${card.slot ?? ""}` : `EMZ${card.slot ?? ""}`;
    return `${known ? cardName(card, info(cardCode(card))) : "Face-down monster"} · ${name(seat)} · ${place}`;
  };

  const node: ReactNode = layers.layer === "control" && view ? <PopupFrame at={CENTER} layer="control" label={view.offer.title} testid="control-dialog">
    <div className={t.dialog}>
      <h3>{view.offer.title}</h3>
      <div className={t.pick} style={{ maxHeight: 240 }}>
        {candidates.map(({ card, seat }) => <button key={`${seat}:${card.ref}`} type="button" className={`${s.btn} ${s.sm} ${s.q}`} data-testid="control-pick"
          onClick={() => { if (take(view.seat, seat, card)) close(); }}>{label(card, seat)}</button>)}
        {!candidates.length ? <p className={t.note} role="status">{view.offer.kind === "revive" ? "No card in an opponent's Graveyard." : "No opponent monster on the field."} Use the card menu when the table does not show it yet.</p> : null}
      </div>
      <div className={t.row}><button type="button" className={`${s.btn} ${s.q}`} onClick={close} data-testid="control-dismiss">Not now</button></div>
    </div>
  </PopupFrame> : null;
  return { offer, take, giveBack, node, may };
}
