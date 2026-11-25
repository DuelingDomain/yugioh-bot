"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { RemoteActionProposal, RemoteRoom } from "@yugidraft/shared/remote";
import type { ControlOffer } from "@/lib/remote/card-logic";
import { searchCards, type CardInfo } from "./catalog";
import { cardCode, cardName, cellsFor, type TwinCard, type ZoneKey } from "./model";
import { PopupFrame } from "./popup";
import type { useLayers } from "./use-layers";
import s from "./remote-ui.module.css";
import t from "./stats-tokens.module.css";

type Act = (action: RemoteActionProposal) => Promise<RemoteRoom | null>;
const CENTER = { anchor: null, feed: null };
const MAIN = [1, 2, 3, 4, 5];
const ROWS = { monster: ["m1", "m2", "m3", "m4", "m5"], "spell-trap": ["s1", "s2", "s3", "s4", "s5"] } as const;
type Row = keyof typeof ROWS;
/** A card the player gives away: what it is and how it lands. A card on the field keeps its own state (`card`); a card from the hand is made from this draft. */
type Give = { seat: number; row: Row; name: string; card?: TwinCard; draft?: { cardId: number; position: "attack" | "defense"; faceUp: boolean } };
type Position = "attack" | "defense";
/** One dialog, three questions. `card` and `equip` pick a card; `place` asks the Monster Zone (and the position of a revived card). The table never guesses any of them. */
type View =
  | { step: "card"; seat: number; offer: ControlOffer }
  | { step: "place"; taker: number; from: number; card: TwinCard; revive: boolean; give?: boolean; position?: Position; row?: Row }
  | { step: "hand"; seat: number; /** An empty zone of an opponent's field that was clicked: the chosen card goes straight there. */ target?: { seat: number; key: ZoneKey } }
  | { step: "equip"; seat: number; card: TwinCard };

/** A card that is known not to be a monster (a Spell or Trap in a Graveyard). An unread card is not excluded. */
const knownNonMonster = (info: CardInfo | undefined) => !!info?.type && !/monster/i.test(info.type);

/**
 * Control change and equip links on a Remote Duels table. A card that is revived from a Graveyard, or taken from the opponent's field,
 * moves to my side with one twin.control action; "Return control" sends it back. The player always picks the card, the Monster Zone
 * and (for a revived card) the position: the table never guesses which one was meant. An activated card that takes control
 * (card logic) opens the picker by itself. A monster that equips itself asks which monster it equips.
 */
export function useControlChange({ act, room, live, extraZones, layers, info, name, toast }: {
  act: Act; room: RemoteRoom; live: boolean; extraZones: boolean; layers: ReturnType<typeof useLayers>; info: (id: number | undefined) => CardInfo | undefined;
  name: (seat: number) => string; toast: (text: string) => void;
}) {
  const { solo, mySeat, state } = room;
  const [view, setView] = useState<View | null>(null);
  const may = useCallback((seat: number) => live && (solo || seat === mySeat), [live, solo, mySeat]);
  const open = (next: View) => { setView(next); layers.open("control"); };
  const close = () => { layers.close("control"); setView(null); };
  const freeZones = (seat: number, row: Row = "monster") => MAIN.filter(n => !state.seats[seat]?.twin.some(c => row === "monster" ? c.zone === "monster" && c.slot === n : c.zone === "spell-trap" && c.slot === n || c.trapZone === n));

  /** "Take control" from the card menu: asks the zone first. A card in a Graveyard also asks its position. */
  const take = (taker: number, fromSeat: number, card: TwinCard) => {
    if (!freeZones(taker).length) { toast("Every Main Monster Zone is taken."); return false; }
    open({ step: "place", taker, from: fromSeat, card, revive: card.zone === "graveyard" || card.zone === "banished" });
    return true;
  };

  /** "Return control": a taken card goes back to its owner; the player picks the owner's zone. */
  const giveBack = (holder: number, card: TwinCard) => {
    const owner = card.ownerSeat; if (owner === undefined) return;
    const row: Row = card.zone === "spell-trap" ? "spell-trap" : "monster";
    if (!freeZones(owner, row).length) { toast(`Every ${row === "monster" ? "Main Monster" : "Spell & Trap"} Zone of the owner is taken.`); return; }
    open({ step: "place", taker: owner, from: holder, card, revive: false, give: true, ...(row === "spell-trap" ? { row } : {}) });
  };

  /** Give: my card on the field, or one made from the hand, goes to an opponent's free zone of its row. The next click on such a zone does it. */
  const [giving, setGiving] = useState<Give | null>(null);
  const canGive = live && !solo && mySeat >= 0 && !room.spectator;
  useEffect(() => { if (giving && !canGive) setGiving(null); }, [giving, canGive]);
  useEffect(() => {
    if (!giving) return;
    const stop = (event: KeyboardEvent) => { if (event.key === "Escape" && !layers.layer) { event.preventDefault(); event.stopPropagation(); setGiving(null); } };
    window.addEventListener("keydown", stop, true);
    return () => window.removeEventListener("keydown", stop, true);
  }, [giving, layers.layer]);
  // One give at a time: a second click while the first is still on its way does nothing, so no second proxy is made.
  const givingNow = useRef(false);
  // When the mode ends, focus goes back to the Give button, unless a dialog took it.
  const giveButton = useRef<HTMLButtonElement>(null);
  const wasGiving = useRef(false);
  useEffect(() => {
    const on = !!giving;
    if (wasGiving.current && !on && !layers.layer) giveButton.current?.focus({ preventScroll: true });
    wasGiving.current = on;
  }, [giving, layers.layer]);
  const rowOf = (card: TwinCard): Row | undefined => card.zone === "monster" || card.zone === "extra-monster" ? "monster" : card.zone === "spell-trap" ? "spell-trap" : undefined;
  /** "Give to opponent" from the card menu. An Extra Monster Zone card goes into a Main Monster Zone. */
  const give = (card: TwinCard) => {
    const row = rowOf(card);
    if (!canGive || !row || card.token) return false;
    setGiving({ seat: mySeat, row, name: card.faceUp || card.publicIdentity ? cardName(card, info(cardCode(card))) : "the face-down card", card });
    return true;
  };
  /** The free zones of the card's row on a seat that can take it: an opponent's, alive. */
  const giveSlots = (seat: number): ZoneKey[] | undefined => {
    const target = state.seats[seat];
    if (!giving || !target || target.eliminated || seat === giving.seat) return undefined;
    const cells = cellsFor(target.twin, extraZones);
    return ROWS[giving.row].filter(key => !cells[key]?.card);
  };
  /** Sends the given card (or the card from the hand) into slot `slot` of an opponent's field. One give at a time. */
  const sendGiven = (sent: Give, seat: number, slot: number) => {
    givingNow.current = true;
    const done = (updated: RemoteRoom | null) => { givingNow.current = false; if (updated) setGiving(now => now === sent ? null : now); };
    const failed = () => { givingNow.current = false; };
    if (sent.card) void act({ type: "twin.control", actorSeat: sent.seat, seat: sent.seat, toSeat: seat, cardRef: sent.card.ref, zone: sent.row, slot, faceUp: sent.card.faceUp }).then(done).catch(failed);
    else if (sent.draft) void act({ type: "twin.place", actorSeat: sent.seat, seat, zone: sent.row, give: true, card: { ref: crypto.randomUUID(), cardId: sent.draft.cardId, name: sent.name, slot, faceUp: sent.draft.faceUp,
      position: sent.row === "monster" && !sent.draft.faceUp ? "defense" : sent.draft.position } }).then(done).catch(failed);
    else givingNow.current = false;
  };
  const giveAt = (seat: number, key: ZoneKey, card: TwinCard | undefined): boolean => {
    if (!giving || card || !giveSlots(seat)?.includes(key)) return false;
    if (givingNow.current) return true;
    sendGiven(giving, seat, Number(key[1]));
    return true;
  };
  /** A free zone on a living opponent's field. */
  const giveFreeZone = (seat: number, key: ZoneKey) => { const target = state.seats[seat]; return !!target && !target.eliminated && seat !== mySeat && !cellsFor(target.twin, extraZones)[key]?.card; };
  /** "Give a card from my hand here": opens the hand search with the clicked empty zone as the target. */
  const giveHere = (seat: number, key: ZoneKey) => { if (canGive && giveFreeZone(seat, key)) open({ step: "hand", seat: mySeat, target: { seat, key } }); };
  /** A suggestion chip: my card on the field goes to the opponent (control change), or one from the hand (a Kaiju) is given by its catalog id. Both then wait for the zone click. */
  const giveCard = (id: number, name: string, card?: TwinCard, row: Row = "monster") => {
    if (card) return give(card);
    if (!canGive) return false;
    setGiving({ seat: mySeat, row, name, draft: { cardId: id, position: "attack", faceUp: true } });
    return true;
  };
  const giveTrigger = (seat: number): ReactNode => canGive && seat === mySeat
    ? <button ref={giveButton} type="button" className={`${s.btn} ${s.sm} ${giving ? s.go : ""}`} aria-pressed={!!giving} data-testid={`give-open-${seat}`}
      onClick={() => { if (giving) setGiving(null); else open({ step: "hand", seat: mySeat }); }}
      title="Give a card from your hand to an opponent's field (a Kaiju, Lava Golem). It shows there as your proxy.">Give card</button> : null;

  const offer = (seat: number, wanted: ControlOffer | undefined) => {
    if (!wanted || !may(seat)) return;
    open({ step: "card", seat, offer: wanted });
  };

  /** A self-equipping monster in my Spell & Trap Zone: which monster does it equip? No link is made until the player clicks. */
  const askEquip = (seat: number, card: TwinCard) => {
    // Another popup or the inspector is open: wait. The caller asks again once the layer closes, so nothing is replaced.
    if (!may(seat) || layers.layer !== null) return false;
    open({ step: "equip", seat, card });
    return true;
  };

  const place = (v: Extract<View, { step: "place" }>, slot: number) => {
    const actorSeat = solo ? (v.give ? v.from : v.taker) : mySeat;
    const zone = v.row ?? "monster";
    const done = (updated: RemoteRoom | null) => { if (updated) close(); };
    // The player's own Graveyard: no control change, a plain move.
    if (v.from === v.taker) void act({ type: "twin.move", actorSeat, seat: v.taker, cardRef: v.card.ref, zone, slot, faceUp: true, position: v.position ?? "attack" }).then(done);
    else void act({ type: "twin.control", actorSeat, seat: v.from, toSeat: v.taker, cardRef: v.card.ref, zone, slot, faceUp: v.revive ? true : v.card.faceUp,
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
    const spell = view.row === "spell-trap", zoneName = spell ? "Spell & Trap Zone" : "Monster Zone";
    heading = view.give ? `Return ${shown} to ${name(view.taker)}: which ${zoneName}?` : `${shown}: which ${zoneName}?`;
    // A revived card has no battle position yet: ask. A card taken from the field keeps the position it has.
    const needsPosition = view.revive || view.from === view.taker;
    body = <>
      {needsPosition ? <div className={s.seg} role="group" aria-label="Position">
        {(["attack", "defense"] as const).map(position => <button key={position} type="button" aria-pressed={view.position === position}
          data-testid={`control-position-${position}`} onClick={() => setView({ ...view, position })}>{position === "attack" ? "Attack (ATK)" : "Defense (DEF)"}</button>)}
      </div> : null}
      <div className={t.row} role="group" aria-label={zoneName}>
        {freeZones(view.taker, view.row).map(n => <button key={n} type="button" className={btn} data-testid={`control-zone-${spell ? "S" : "M"}${n}`} disabled={needsPosition && !view.position}
          aria-label={`${zoneName} ${n}`} onClick={() => place(view, n)}>{spell ? "S" : "M"}{n}</button>)}
      </div>
      {needsPosition && !view.position ? <p className={t.chosen} role="status">Choose the position first.</p> : null}
      <div className={t.row}><button type="button" className={`${s.btn} ${s.q}`} onClick={close} data-testid="control-dismiss">Not now</button></div>
    </>;
  } else if (view?.step === "hand") {
    heading = "Give a card to an opponent";
    body = <GiveHand here={!!view.target} onClose={close} onChoose={(card, draft) => {
      const row: Row = /spell|trap/i.test(card.type) ? "spell-trap" : "monster";
      const sent: Give = { seat: view.seat, row, name: card.name, draft: { cardId: card.id, ...draft } };
      close();
      // Pre-targeted from an empty zone: the card goes there at once when its row fits and the zone is still free. Otherwise the usual "click a zone" step starts.
      const target = view.target;
      if (target && ROWS[row].includes(target.key as never) && !givingNow.current && giveFreeZone(target.seat, target.key)) { sendGiven(sent, target.seat, Number(target.key[1])); return; }
      if (target) toast(ROWS[row].includes(target.key as never) ? "That zone is taken now. Click another free zone." : `${card.name} goes in a ${row === "monster" ? "Monster" : "Spell & Trap"} Zone. Click one.`);
      setGiving(sent);
    }} />;
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
  const bar = giving && canGive ? <div className={t.bar} role="toolbar" aria-label="Give a card" data-testid="give-bar">
    <span className={t.barText} role="status">Click a free {giving.row === "monster" ? "Monster" : "Spell & Trap"} Zone on an opponent's field for <b>{giving.name}</b>. It stays yours there. Move its paper card off your zones.</span>
    <button type="button" className={`${s.btn} ${s.sm} ${s.q}`} onClick={() => setGiving(null)} data-testid="give-cancel">Cancel <kbd>Esc</kbd></button>
  </div> : null;
  return { offer, take, giveBack, askEquip, node: <>{node}{bar}</>, may, give, giveSlots, giveAt, giveHere, giveCard, giveTrigger, giving: !!giving && canGive, canGive };
}

/** Search the catalog for the card in the hand, then ask how it lands. The zone is the next click. */
function GiveHand({ here, onChoose, onClose }: { here?: boolean; onChoose: (card: CardInfo, draft: { position: Position; faceUp: boolean }) => void; onClose: () => void }) {
  const [query, setQuery] = useState(""); const [found, setFound] = useState<CardInfo[] | null>(null); const [chosen, setChosen] = useState<CardInfo | null>(null);
  const [position, setPosition] = useState<Position>("attack"); const [faceUp, setFaceUp] = useState(true);
  useEffect(() => {
    const text = query.trim(); if (text.length < 2) { setFound(null); return; }
    let on = true; const timer = setTimeout(() => { void searchCards(text, false).then(list => { if (on) setFound(list.slice(0, 30)); }); }, 200);
    return () => { on = false; clearTimeout(timer); };
  }, [query]);
  const monster = !!chosen && !/spell|trap/i.test(chosen.type);
  const typing = { onKeyDown: (event: React.KeyboardEvent) => { if (event.key !== "Escape") event.stopPropagation(); } };
  return <>
    <label className={t.field}>Search the card by name
      <input className={t.num} style={{ width: "100%" }} type="text" autoComplete="off" placeholder="Gameciel, the Sea Turtle Kaiju" value={query} data-autofocus data-testid="give-search" {...typing}
        onChange={event => { setQuery(event.target.value); setChosen(null); }} /></label>
    <div className={t.pick}>
      {found?.map(card => <button key={card.id} type="button" className={`${s.btn} ${s.sm} ${s.q}`} data-testid="give-pick" onClick={() => { setChosen(card); setQuery(card.name); setFound(null); }}>{card.name}</button>)}
      {found && !found.length ? <p className={t.note} role="status">No card with that name.</p> : null}
    </div>
    {chosen ? <>
      <p className={t.chosen} data-testid="give-chosen">{chosen.name}</p>
      <div className={t.row}>
        <div className={s.seg} role="group" aria-label="Face">
          {([true, false] as const).map(up => <button key={String(up)} type="button" aria-pressed={faceUp === up} data-testid={up ? "give-face-up" : "give-face-down"} onClick={() => setFaceUp(up)}>{up ? "Face-up" : "Face-down"}</button>)}
        </div>
        {monster && faceUp ? <div className={s.seg} role="group" aria-label="Position">
          {(["attack", "defense"] as const).map(item => <button key={item} type="button" aria-pressed={position === item} data-testid={`give-position-${item}`} onClick={() => setPosition(item)}>{item === "attack" ? "Attack (ATK)" : "Defense (DEF)"}</button>)}
        </div> : null}
      </div>
      {!faceUp ? <p className={t.note}>A face-down card stays hidden from the other players. Only you can see what it is.</p> : null}
    </> : null}
    <div className={t.row}>
      <button type="button" className={`${s.btn} ${s.go}`} disabled={!chosen} data-testid="give-choose-zone" onClick={() => { if (chosen) onChoose(chosen, { position, faceUp }); }}>{here ? "Give here" : "Choose a zone"}</button>
      <button type="button" className={`${s.btn} ${s.q}`} onClick={onClose} data-testid="control-dismiss">Not now</button>
    </div>
  </>;
}
