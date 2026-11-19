"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyEvent, type ReactNode } from "react";
import type { RemoteActionProposal, RemoteEvent, RemoteRoom } from "@yugidraft/shared/remote";
import { cardArt, cardInfo, loadCards, searchCards, type CardInfo } from "./catalog";
import { DEFAULT_TOKEN_ART, TOKEN_ART, TOKEN_MAKERS, type TokenMaker } from "./token-makers";
import { TOKEN_CARDS } from "./token-cards";
import { serverNow } from "./api";
import { cardCode, cardName, cellsFor, type TwinCard, type ZoneKey } from "./model";
import { BigArt, PopupFrame } from "./popup";
import type { Verdict } from "./placement";
import type { useLayers } from "./use-layers";
import s from "./remote-ui.module.css";
import t from "./stats-tokens.module.css";
import { playerStamp } from "@/lib/remote/field-timing";

type Act = (action: RemoteActionProposal) => Promise<RemoteRoom | null>;
type Position = "attack" | "defense";
const CENTER = { anchor: null, feed: null };
const MAIN = ["m1", "m2", "m3", "m4", "m5"] as const;
const MAX = 999_999;

/** Only Main Monster Zones 1-5 hold a token, never an Extra Monster Zone. */
const isMainCell = (key: ZoneKey) => (MAIN as readonly string[]).includes(key);
const zoneLabel = (key: ZoneKey) => `Monster Zone ${key[1]}`;
const points = (text: string) => { const n = Number(text); return text.trim() !== "" && Number.isInteger(n) && n >= 0 && n <= MAX ? n : null; };

type View = { kind: "new"; seat: number; key: ZoneKey | null } | { kind: "template"; from?: TokenTemplate } | { kind: "nibiru"; actorSeat: number; makerRef?: string; template: TokenTemplate } | { kind: "picked"; seat: number; key: ZoneKey; template: TokenTemplate } | { kind: "card"; seat: number; ref: string; };
/** What the next click on a free Monster Zone puts there. `left` is how many are still to place; `ask` means ATK/DEF are not fixed and the player types them. */
export type TokenTemplate = { name: string; atk: number; def: number; artId?: number; position: Position; left: number; ask?: boolean; /** ATK/DEF were suggested from the Tributed monsters and may be edited. */ prefilled?: boolean; /** The tokens go to the opponent's field. */ opponent?: boolean; /** Only this seat's field takes the token (the one opponent a Nibiru summons was made by). */ onlySeat?: number; /** The zone is chosen first; the dialog with the ATK/DEF follows. Always for `ask`, and for any token on another player's field. */ confirm?: boolean; /** Face-up Tributed monsters whose ATK/DEF are not known, so the suggestion leaves them out. */ unknown?: number };
const GENERIC: TokenTemplate = { name: "Token", atk: 0, def: 0, position: "attack", left: 1, confirm: true };
const templateOf = (maker: TokenMaker): TokenTemplate => ({ name: maker.token, atk: maker.atk, def: maker.def, artId: maker.id, position: maker.position, left: maker.count, ...(maker.ask ? { ask: true, confirm: true } : {}), ...(maker.opponent ? { opponent: true } : {}) });
/** An activation or placement older than this is history (a reconnect or a page load), not news. */
const FRESH_MS = 8000;
/** The same card does not give its tokens twice in this time (an activation and its placement are one event to the player). */
const REPEAT_MS = 30_000;
/** The token art of a name that is not in the curated list: the catalog entry with exactly that name. A miss is remembered. */
const foundArt = new Map<string, number | null>();
async function artFor(name: string): Promise<number | undefined> {
  const key = name.trim().toLowerCase();
  if (TOKEN_ART[key]) return TOKEN_ART[key];
  if (key === "token" || key.length < 2) return undefined;
  if (!foundArt.has(key)) {
    const hit = await Promise.race([searchCards(name.trim(), false).catch(() => []), new Promise<CardInfo[]>(resolve => setTimeout(() => resolve([]), 800))])
      .then(list => list.find(card => card.name.toLowerCase() === key && /token/i.test(card.type)));
    if (hit) foundArt.set(key, hit.id);
  }
  return foundArt.get(key) ?? undefined;
}
const OFF_FIELD = ["hand", "deck", "extra"];
/** The zones of a card in play (a card in the hand, a pile or under another card is not played). */
const onFieldZone = (zone: string) => ["monster", "spell-trap", "extra-monster", "field", "pendulum"].includes(zone);
const ON_FIELD = ["monster", "extra-monster"];

/**
 * Tokens on a Remote Duels table: a token is table state with no physical card. The owner creates it from the "Token" button
 * or from an empty Main Monster Zone's menu, and moves, turns or removes it from its popup. The camera never reads it.
 */
export function useTokens({ act, room, live, extraZones, layers, info, toast }: {
  act: Act; room: RemoteRoom; live: boolean; extraZones: boolean; layers: ReturnType<typeof useLayers>; info: (id: number | undefined) => CardInfo | undefined; toast?: (text: ReactNode, ms?: number) => void;
}) {
  const [view, setView] = useState<View | null>(null);
  const roomRef = useRef(room); roomRef.current = room;
  const [placing, setPlacing] = useState<TokenTemplate | null>(null);
  /** Zones ("seat:key") with a token request that the server has not answered yet. They leave the glow and count as taken. */
  const [pending, setPendingState] = useState<string[]>([]);
  const pendingRef = useRef<string[]>([]);
  const setPending = (next: string[]) => { pendingRef.current = next; setPendingState(next); };
  const triggerRef = useRef<HTMLButtonElement>(null);
  const wasPlacing = useRef(false);
  const { solo, mySeat } = room;
  const owns = useCallback((seat: number) => live && (solo || seat === mySeat), [live, solo, mySeat]);
  /** Any seated player (not a spectator) may put a token on any field. */
  const canPlace = live && (solo || (mySeat >= 0 && !room.spectator));
  const actor = (seat: number) => solo ? seat : mySeat;
  const names = room.state.seats.flatMap(item => item.twin.filter(card => card.faceUp && !card.token && !OFF_FIELD.includes(card.zone)).map(card => cardName(card, info(cardCode(card))).toLowerCase()));
  const suggestions: TokenTemplate[] = [...new Set(names.filter(name => TOKEN_MAKERS[name]))].map(name => templateOf(TOKEN_MAKERS[name]));
  useEffect(() => { if (placing && !canPlace) setPlacing(null); }, [placing, canPlace]);
  // Placing mode over: no zone stays marked as waiting for an answer.
  useEffect(() => { if (!placing) setPending([]); }, [placing]);
  // When the mode ends, focus goes back to the Token button, unless a dialog took it.
  useEffect(() => {
    const on = !!placing;
    if (wasPlacing.current && !on && !layers.layer) triggerRef.current?.focus({ preventScroll: true });
    wasPlacing.current = on;
  }, [placing, layers.layer]);
  useEffect(() => {
    if (!placing) return;
    const stop = (event: KeyboardEvent) => { if (event.key === "Escape" && !layers.layer) { event.preventDefault(); event.stopPropagation(); setPlacing(null); } };
    window.addEventListener("keydown", stop, true);
    return () => window.removeEventListener("keydown", stop, true);
  }, [placing, layers.layer]);
  const freeIn = useCallback((state: RemoteRoom["state"], seat: number, keys: readonly ZoneKey[]) => {
    const cells = cellsFor(state.seats[seat]?.twin ?? [], extraZones);
    return keys.filter(key => !cells[key]?.card);
  }, [extraZones]);
  const freeKeys = useCallback((seat: number, keys: readonly ZoneKey[]) => freeIn(room.state, seat, keys), [room.state, freeIn]);

  /** The Main Monster Zones that glow on a seat: free ones that no unanswered request is already filling. */
  const openSlots = (seat: number): ZoneKey[] => placing?.onlySeat !== undefined && seat !== placing.onlySeat || placing?.opponent && !solo && seat === mySeat ? [] : freeKeys(seat, MAIN).filter(key => !pending.includes(`${seat}:${key}`));
  /** The create dialog. An empty Main Monster Zone passes its cell, the button leaves it open. */
  const create = useCallback((seat: number, key?: ZoneKey) => {
    if (!canPlace || room.state.seats[seat]?.eliminated || key && !isMainCell(key)) return false;
    setView({ kind: "new", seat, key: key ?? null }); layers.open("token"); return true;
  }, [canPlace, room.state.seats, layers]);
  /** The "Token" control: starts placing a generic token, or cancels when already placing. */
  const toggle = () => { if (placing) setPlacing(null); else if (canPlace) setPlacing(GENERIC); };
  /** A click on a zone while placing. A free Main Monster Zone on a living seat gets the token; anything else keeps its usual click. */
  const placeAt = (seat: number, key: ZoneKey, card: TwinCard | undefined): boolean => {
    if (!placing || !canPlace) return false;
    const target = room.state.seats[seat];
    if (!target || target.eliminated || card || !isMainCell(key)) return false;
    // Tokens meant for the opponent do not go on my own field: the click does nothing.
    if (placing.onlySeat !== undefined && seat !== placing.onlySeat || placing.opponent && !solo && seat === mySeat) return true;
    // Zone first: on another player's field (or for open stats) the click picks the zone and the dialog with ATK/DEF follows.
    if (placing.confirm && (placing.ask || !solo && seat !== mySeat)) {
      setPlacing(null); setView({ kind: "picked", seat, key, template: placing }); layers.open("token"); return true;
    }
    const id = `${seat}:${key}`;
    // A zone with a request in flight, or more requests than tokens left, takes the click and does nothing.
    if (pendingRef.current.includes(id) || pendingRef.current.length >= placing.left) return true;
    const sent = placing;
    setPending([...pendingRef.current, id]);
    // The count drops only when the server accepted the token. A refused request (taken zone) leaves it as it was.
    void send(seat, { name: sent.name, atk: sent.atk, def: sent.def, artId: sent.artId, position: sent.position, key }).then(updated => {
      setPending(pendingRef.current.filter(item => item !== id));
      if (!updated) return;
      // The mode ends when the whole set is placed, or when no zone is left on any field (zones still being filled count as taken).
      const zonesLeft = updated.state.seats.reduce((sum, item, index) => sum + (item.eliminated ? 0 : freeIn(updated.state, index, MAIN).length), 0) - pendingRef.current.length;
      setPlacing(now => !now ? null : now.name !== sent.name || now.atk !== sent.atk || now.def !== sent.def ? now : now.left > 1 && zonesLeft > 0 ? { ...now, left: now.left - 1 } : null);
    }).catch(() => setPending(pendingRef.current.filter(item => item !== id)));
    return true;
  };
  /** A chip with open stats (Primal Being Token) first asks for the zone, then for the stats; the others switch the template at once. */
  const pick = (template: TokenTemplate) => setPlacing(template.ask ? suggestStats(template) : template);
  /** The Primal Being Token stats: the combined original ATK/DEF of the given monsters. A token counts with its own ATK/DEF. A card that is not known counts nothing. */
  const statsOf = (template: TokenTemplate, monsters: readonly TwinCard[]): TokenTemplate => {
    const stats = monsters.map(card => { if (card.token) return { atk: card.token.atk, def: card.token.def }; const found = info(cardCode(card)); return found && found.atk !== undefined && found.atk !== null && found.atk >= 0 ? { atk: found.atk, def: Math.max(0, found.def ?? 0) } : null; });
    const known = stats.filter((item): item is { atk: number; def: number } => !!item);
    const unknown = stats.length - known.length;
    if (!known.length) return unknown ? { ...template, unknown } : template;
    return { ...template, atk: known.reduce((sum, item) => sum + item.atk, 0), def: known.reduce((sum, item) => sum + item.def, 0), prefilled: true, ...(unknown ? { unknown } : {}) };
  };
  const nibiru = (card: TwinCard) => cardName(card, info(cardCode(card))).toLowerCase().startsWith("nibiru");
  /** The face-up monsters on every field, not Nibiru itself: the ones a Nibiru Tribute sends to the Graveyard. */
  const tributable = (state: RemoteRoom["state"], exceptRef?: string, only?: readonly number[]) => state.seats.filter(item => !item.eliminated && (!only || only.includes(item.seat))).flatMap(item => item.twin.filter(card => card.faceUp && ON_FIELD.includes(card.zone) && card.ref !== exceptRef && !nibiru(card)));
  /** The living opponents of a seat. */
  const opponentsOf = (state: RemoteRoom["state"], seat: number) => state.seats.filter(item => item.seat !== seat && !item.eliminated).map(item => item.seat);
  /** A chip with open stats suggests from the two fields only when there is exactly one opponent; with several the opponent is not known yet. */
  const suggestStats = (template: TokenTemplate): TokenTemplate => {
    const me = solo ? 0 : mySeat, opponents = opponentsOf(room.state, me);
    return opponents.length === 1 ? { ...statsOf(template, tributable(room.state, undefined, [me, opponents[0]])), onlySeat: opponents[0] } : template;
  };
  /**
   * The seat that played a token maker gets its tokens at once, in free Monster Zones, with the real token art. Players remove them if the effect did not happen.
   * The free zones are read again before each token, so a refused zone does not stop the rest. A maker with open stats (Nibiru) never places by itself.
   */
  const give = async (maker: TokenMaker, actorSeat: number, makerRef?: string) => {
    const state = roomRef.current.state;
    const targets = maker.opponent ? state.seats.map((_, index) => index).filter(index => index !== actorSeat && !state.seats[index]?.eliminated) : [actorSeat];
    const template = templateOf(maker);
    // Nibiru: the player confirms first (which opponent made the summons, and the Tribute itself). Nothing is sent without that click.
    if (maker.ask) { if (opponentsOf(state, actorSeat).length) { setView({ kind: "nibiru", actorSeat, makerRef, template }); layers.open("token"); } return; }
    // Several opponents: the player decides with the usual placing mode.
    if (targets.length !== 1) { setPlacing(template); return; }
    const refused = new Set<ZoneKey>();
    let latest = state, placed = 0;
    while (placed < maker.count) {
      const key = freeIn(latest, targets[0], MAIN).find(item => !refused.has(item));
      if (!key) break;
      const updated = await send(targets[0], { name: template.name, atk: template.atk, def: template.def, artId: template.artId, position: template.position, key }).catch(() => null);
      if (updated) { placed++; latest = updated.state; } else { refused.add(key); latest = roomRef.current.state; }
    }
    if (placed < maker.count) toast?.(`${placed} of ${maker.count} ${maker.token}s placed. No free Monster Zone is left.`, 4200);
  };
  const giveRef = useRef(give); giveRef.current = give;
  const seenSeq = useRef<number | null>(null);
  /** Token makers that gave their tokens, by card ref: a maker gives once for as long as it stays on the field (a grace time covers the step from the hand to the field). */
  const given = useRef(new Map<string, number>());
  /** Makers with no card ref (a card held up from the hand) are told apart by seat and name for a short time. */
  const madeAt = useRef(new Map<string, number>());
  /** Where each card stood before the newest events: tells a card played from the hand from one that came back from the Graveyard or was only turned. */
  const before = useRef(new Map<string, { zone: string; faceUp: boolean }>());
  useEffect(() => {
    const cards = room.state.seats.flatMap(item => item.twin);
    const was = before.current;
    before.current = new Map(cards.map(card => [card.ref, { zone: card.zone, faceUp: card.faceUp }]));
    for (const [ref, at] of given.current) if (!onFieldZone(before.current.get(ref)?.zone ?? "") && Date.now() - at > REPEAT_MS) given.current.delete(ref);
    const top = room.events.reduce((max, event) => Math.max(max, event.seq), 0);
    // The first render only learns where the log stands. Makers already face up on a field have given their tokens long ago.
    if (seenSeq.current === null) {
      seenSeq.current = top;
      for (const card of cards) if (card.faceUp && onFieldZone(card.zone) && TOKEN_MAKERS[cardName(card, info(cardCode(card))).toLowerCase()]?.auto) given.current.set(card.ref, Date.now());
      return;
    }
    const fresh = room.events.filter(event => event.seq > seenSeq.current!).sort((a, b) => a.seq - b.seq);
    seenSeq.current = Math.max(seenSeq.current, top);
    if (!canPlace) return;
    for (const event of fresh) {
      const action = event.action;
      // Only the client of the player who played the card makes the tokens, so they are made once.
      if (event.actorSeat === null || !solo && event.actorSeat !== mySeat || serverNow() - event.at > FRESH_MS) continue;
      const held = (ref: string | undefined) => ref ? cards.find(card => card.ref === ref) : undefined;
      let ref: string | undefined, id: number | undefined, label: string | undefined;
      if (action.type === "effect.activated") { ref = action.source.cardRef; id = action.source.cardId; label = action.source.name; }
      else if (action.type === "twin.place") {
        // A card shown during its activation is counted by that activation. One that returned from the Graveyard, banishment, Deck or Extra Deck, or only moved on the field, is not played from the hand.
        if (!action.card.faceUp || action.card.token || !onFieldZone(action.zone) || action.give) continue;
        // The activation already gave the tokens (it may have had no card ref): this ref is done, too.
        if (action.fromActivation) { given.current.set(action.fromRef ?? action.card.ref, Date.now()); continue; }
        ref = action.fromRef ?? action.card.ref;
        const from = was.get(ref)?.zone;
        if (action.fromRef ? from !== "hand" : from !== undefined && from !== "hand") continue;
        id = action.card.cardId ?? action.card.passcode; label = action.card.name;
      }
      // A Set card turned face up, or a face-up field card the camera or the player named: the effect is played now.
      else if (action.type === "twin.flip" || action.type === "card.identified") {
        if (action.type === "twin.flip" && (!action.faceUp || was.get(action.cardRef)?.faceUp !== false)) continue;
        ref = action.cardRef;
        const card = held(ref);
        // Only a monster, Spell or Trap that the actor controls counts.
        if (!card || card.token || !card.faceUp || !onFieldZone(card.zone) || !solo && !room.state.seats[event.actorSeat]?.twin.some(item => item.ref === card.ref)) continue;
        id = action.cardId ?? (action.type === "card.identified" ? action.passcode : undefined) ?? cardCode(card); label = action.name;
      }
      else continue;
      const seat = event.actorSeat;
      void (async () => {
        if (id && !cardInfo(id)) await loadCards([id]);
        const card = held(ref);
        const name = (label ?? cardInfo(id)?.name ?? (card ? cardName(card, cardInfo(cardCode(card))) : "")).toLowerCase();
        const maker = TOKEN_MAKERS[name];
        if (!maker?.auto) return;
        // An activation read from the hand has no card ref, so the seat and name window covers it for every source.
        const key = `${seat}:${name}`;
        if (ref && given.current.has(ref) || Date.now() - (madeAt.current.get(key) ?? 0) < REPEAT_MS) return;
        if (ref) given.current.set(ref, Date.now());
        madeAt.current.set(key, Date.now());
        await giveRef.current(maker, seat, ref);
      })();
    }
  }, [room.events]);
  /**
   * The Nibiru confirm was answered. Tribute: the face-up monsters of the activator and of the ONE chosen opponent (not Nibiru) go to their
   * owners' Graveyards (a token just leaves) as one Undo step. Skip sends nothing. Either way the Primal Being Token then starts from those
   * monsters' original ATK/DEF, and the zone is picked on the chosen opponent's field before the dialog with the stats.
   */
  const settleNibiru = async (ask: Extract<View, { kind: "nibiru" }>, opponent: number, tribute: boolean) => {
    close();
    const state = roomRef.current.state, pool = tributable(state, ask.makerRef, [ask.actorSeat, opponent]);
    const ready = { ...statsOf(ask.template, pool), onlySeat: opponent };
    if (tribute && pool.length) {
      const seat = actor(ask.actorSeat);
      const done = await act({ type: "monsters.tribute", actorSeat: seat, seat, targets: pool.map(card => ({ seat: state.seats.findIndex(item => item.twin.some(other => other.ref === card.ref)), cardRef: card.ref })) }).catch(() => null);
      if (!done) toast?.("The Tribute could not be sent. Send the monsters to the Graveyard by hand.", 4200);
    }
    setPlacing(ready);
  };
  const customize = (from?: TokenTemplate) => { setView({ kind: "template", ...(from ? { from } : {}) }); layers.open("token"); };
  const open = useCallback((seat: number, card: TwinCard) => { setView({ kind: "card", seat, ref: card.ref }); layers.open("token"); }, [layers]);
  const close = () => { layers.close("token"); setView(null); };

  const send = async (seat: number, draft: { name: string; atk: number; def: number; artId?: number; position: Position; key: ZoneKey }) => {
    // A generic token with a known name (Sheep Token) gets that token's art, too; with no match it gets the default token card.
    const artId = draft.artId ?? await artFor(draft.name) ?? DEFAULT_TOKEN_ART;
    return act({ type: "twin.place", actorSeat: actor(seat), seat, zone: "monster", card: { ref: crypto.randomUUID(), name: draft.name, slot: Number(draft.key[1]), faceUp: true, position: draft.position,
      token: { atk: draft.atk, def: draft.def, ...(artId ? { artId } : {}) } } });
  };
  /** The create dialog places one token and ends. */
  const place = (seat: number, draft: { name: string; atk: number; def: number; artId?: number; position: Position; key: ZoneKey }) => { void send(seat, draft); setPlacing(null); close(); };
  /** The zone was picked first: the dialog places the token there. A refused zone sends the player back to choosing one. */
  const placePicked = async (seat: number, template: TokenTemplate, draft: { name: string; atk: number; def: number; artId?: number; position: Position; key: ZoneKey }) => {
    close();
    const updated = await send(seat, draft).catch(() => null);
    if (!updated) { toast?.("The token was not placed. Choose a zone again.", 4200); setPlacing({ ...template, name: draft.name, atk: draft.atk, def: draft.def, artId: draft.artId, position: draft.position, prefilled: true }); }
  };
  const moveTo = (seat: number, card: TwinCard, key: ZoneKey) => {
    void act({ type: "twin.move", actorSeat: actor(seat), seat, zone: "monster", slot: Number(key[1]), cardRef: card.ref });
  };
  const setStats = (seat: number, card: TwinCard, atk: number, def: number) => void act({ type: "twin.flip", actorSeat: actor(seat), seat, cardRef: card.ref, faceUp: true, position: card.position, tokenStats: { atk, def } });
  const turn = (seat: number, card: TwinCard) => void act({ type: "twin.flip", actorSeat: actor(seat), seat, cardRef: card.ref, faceUp: true, position: card.position === "defense" ? "attack" : "defense" });
  const remove = (seat: number, card: TwinCard) => { void act({ type: "twin.remove", actorSeat: actor(seat), seat, cardRef: card.ref, cam: playerStamp("token-remove") }); close(); };

  /** Drag and drop: a token only lands on a free Main Monster Zone cell. Leaving the field is Remove, so a drop elsewhere says so. */
  const judge = (seat: number, card: TwinCard, key: ZoneKey | "hand"): Verdict => {
    if (key === "hand" || !isMainCell(key)) return { kind: "refuse", message: "A token stays in the Main Monster Zones. Use Remove to take it off the field." };
    const cells = cellsFor(room.state.seats[seat]?.twin ?? [], extraZones);
    if (cells[key]?.card?.ref === card.ref) return { kind: "same" };
    return cells[key]?.card ? { kind: "refuse", message: "That zone is taken." } : { kind: "ok" };
  };
  const drop = (seat: number, card: TwinCard, key: ZoneKey | "hand") => { if (key !== "hand" && judge(seat, card, key).kind === "ok") moveTo(seat, card, key); };

  const trigger = (seat: number): ReactNode => canPlace && seat === (solo ? 0 : mySeat)
    ? <button ref={triggerRef} type="button" className={`${s.btn} ${s.sm} ${placing ? s.go : ""}`} aria-pressed={!!placing} onClick={toggle} data-testid={`token-open-${seat}`}
      title="Put a token on any free Monster Zone, yours or an opponent's. The camera does not read it.">Token</button> : null;

  const card = view?.kind === "card" ? room.state.seats[view.seat]?.twin.find(item => item.ref === view.ref) : undefined;
  const isCreator = (card: TwinCard) => mySeat >= 0 && card.token?.by === mySeat;
  const dialog = layers.layer === "token" && view ? view.kind === "new"
    ? <TokenDialog free={freeKeys(view.seat, MAIN)} start={view.key} onCreate={draft => place(view.seat, { ...draft, key: draft.key! })} onClose={close} />
    : view.kind === "nibiru" ? <NibiruConfirm opponents={opponentsOf(room.state, view.actorSeat).map(seat => ({ seat, label: room.seats.find(item => item.seat === seat)?.displayName ?? `Seat ${seat + 1}` }))}
      count={opponent => tributable(room.state, view.makerRef, [view.actorSeat, opponent]).length} onAnswer={(opponent, tribute) => void settleNibiru(view, opponent, tribute)} />
    : view.kind === "picked" ? <TokenDialog free={[view.key]} start={view.key} modal initial={view.template}
      zone={{ label: `${room.seats.find(item => item.seat === view.seat)?.displayName ?? `Seat ${view.seat + 1}`}, ${zoneLabel(view.key)}`,
        change: current => { setPlacing({ ...view.template, ...current, prefilled: true }); close(); } }}
      onCreate={draft => void placePicked(view.seat, view.template, { ...draft, key: view.key })} onClose={close} />
    : view.kind === "template" ? <TokenDialog free={[]} start={null} zoneless initial={view.from} onCreate={draft => { setPlacing({ name: draft.name, atk: draft.atk, def: draft.def, artId: draft.artId ?? view.from?.artId, position: draft.position, left: view.from?.left ?? 1 }); close(); }} onClose={close} />
    : card?.token ? <TokenPopover card={card} editable={owns(view.seat) || (live && isCreator(card))} free={freeKeys(view.seat, MAIN)} art={info(card.token.artId)}
      onTurn={() => turn(view.seat, card)} onStats={(atk, def) => setStats(view.seat, card, atk, def)} onMove={key => moveTo(view.seat, card, key)} onRemove={() => remove(view.seat, card)} onClose={close} /> : null : null;
  const node = <>
    {placing && canPlace ? <TokenBar template={placing} suggestions={suggestions} onPick={pick} onCustom={() => customize()} onCancel={() => setPlacing(null)} /> : null}
    {dialog}
  </>;
  return { create, open, judge, drop, trigger, node, owns, placing: !!placing && canPlace, placeAt, openSlots };
}

/** The strip shown while placing: what goes down, how many are left, and how to stop. The zones themselves glow on the fields. */
function TokenBar({ template, suggestions, onPick, onCustom, onCancel }: {
  template: TokenTemplate; suggestions: TokenTemplate[]; onPick: (template: TokenTemplate) => void; onCustom: () => void; onCancel: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  // The mode starts from a click or a key on the Token button; focus moves here so the keyboard and a screen reader land on the choices.
  useEffect(() => { box.current?.focus({ preventScroll: true }); }, []);
  const same = (item: TokenTemplate) => template.name === item.name && (item.ask || template.atk === item.atk && template.def === item.def);
  const chip = (item: TokenTemplate, label: string) => <button key={label} type="button" className={`${s.btn} ${s.sm} ${same(item) ? s.go : s.q}`}
    aria-pressed={same(item)} onClick={() => onPick(item)} data-testid="token-chip">{label}</button>;
  const stats = template.atk || template.def ? ` (${template.atk}/${template.def})` : "";
  // Tab from the last button goes to the first glowing zone (the zones use a roving tabindex, so the natural order would skip them).
  const leave = (event: ReactKeyEvent<HTMLDivElement>) => {
    if (event.key !== "Tab" || event.shiftKey) return;
    const buttons = box.current?.querySelectorAll("button");
    if (!buttons?.length || event.target !== buttons[buttons.length - 1]) return;
    const zone = document.querySelector<HTMLElement>("[data-token-slot]");
    if (zone) { event.preventDefault(); zone.focus(); }
  };
  return <div ref={box} className={t.bar} role="toolbar" aria-label="Place a token" tabIndex={-1} data-testid="token-bar" onKeyDown={leave}>
    <span className={t.barText} role="status" data-testid="token-bar-text">Click a free Monster Zone {template.opponent ? "of your opponent " : ""}for the <b>{template.name}</b>{stats}.{template.ask ? " You set ATK/DEF next." : ""}{template.left > 1 ? ` ${template.left} left.` : ""}</span>
    <span className={t.barChips}>
      {suggestions.map(item => chip(item, item.name))}
      {suggestions.length ? chip(GENERIC, "Generic") : null}
      <button type="button" className={`${s.btn} ${s.sm} ${s.q}`} onClick={onCustom} data-testid="token-custom">Custom…</button>
      <button type="button" className={`${s.btn} ${s.sm} ${s.q}`} onClick={onCancel} data-testid="token-cancel">Cancel <kbd>Esc</kbd></button>
    </span>
  </div>;
}

/** Nibiru was played: which opponent made the summons, and whether the monsters of the two fields go to the Graveyard. Only its buttons close it. */
function NibiruConfirm({ opponents, count, onAnswer }: { opponents: { seat: number; label: string }[]; count: (opponent: number) => number; onAnswer: (opponent: number, tribute: boolean) => void }) {
  const [chosen, setChosen] = useState<number | null>(opponents.length === 1 ? opponents[0].seat : null);
  const n = chosen === null ? null : count(chosen);
  return <PopupFrame at={CENTER} layer="token" label="Nibiru, the Primal Being" testid="nibiru-confirm" modal>
    <div className={t.dialog}>
      <h3>Nibiru, the Primal Being</h3>
      {opponents.length > 1 ? <div className={t.seg} role="group" aria-label="Opponent who made the summons">
        {opponents.map(item => <button key={item.seat} type="button" className={`${s.btn} ${s.sm} ${chosen === item.seat ? s.go : s.q}`} aria-pressed={chosen === item.seat} onClick={() => setChosen(item.seat)} data-testid={`nibiru-opponent-${item.seat}`}>{item.label}</button>)}
      </div> : null}
      <p className={t.chosen} role="status" data-testid="nibiru-count">{n === null ? "Choose the opponent who made the summons." : `Send ${n} monster${n === 1 ? "" : "s"} to the Graveyard?`}</p>
      <div className={t.row}>
        <button type="button" className={`${s.btn} ${s.go}`} disabled={chosen === null} onClick={() => { if (chosen !== null) onAnswer(chosen, true); }} data-testid="nibiru-tribute" data-autofocus>Tribute</button>
        <button type="button" className={`${s.btn} ${s.q}`} disabled={chosen === null} onClick={() => { if (chosen !== null) onAnswer(chosen, false); }} data-testid="nibiru-skip">Skip</button>
      </div>
    </div>
  </PopupFrame>;
}

function TokenDialog({ free, start, zoneless, modal, zone, initial, onCreate, onClose }: {
  free: ZoneKey[]; start: ZoneKey | null;
  /** Only Cancel closes the dialog: Esc and a click outside do nothing. */
  modal?: boolean;
  /** The zone was picked before the dialog. `change` takes the values typed so far back to the zone picking. */
  zone?: { label: string; change: (current: { name: string; atk: number; def: number; artId?: number; position: Position }) => void };
  /** No zone is chosen here: the token is placed by the next click on a zone. */
  zoneless?: boolean;
  /** A suggested token whose name and position are filled in. Its ATK/DEF stay empty and must be typed. */
  initial?: TokenTemplate;
  onCreate: (draft: { name: string; atk: number; def: number; artId?: number; position: Position; key?: ZoneKey }) => void; onClose: () => void;
}) {
  const [mode, setMode] = useState<"common" | "generic">(initial ? "generic" : "common");
  const [query, setQuery] = useState(""); const [found, setFound] = useState<CardInfo[] | null>(null); const [chosen, setChosen] = useState<CardInfo | null>(null);
  const [name, setName] = useState(initial?.name ?? "Token"); const [atk, setAtk] = useState(initial?.ask && !initial.prefilled ? "" : String(initial?.atk ?? 0)); const [def, setDef] = useState(initial?.ask && !initial.prefilled ? "" : String(initial?.def ?? 0));
  const [position, setPosition] = useState<Position>(initial?.position ?? "attack");
  /** The token card whose art the generic token shows; none picked means the default token card. */
  const [art, setArt] = useState<number | undefined>(initial?.artId); const [artQuery, setArtQuery] = useState("");
  const artHits = useMemo(() => {
    const text = artQuery.trim().toLowerCase(); if (text.length < 1) return [];
    return TOKEN_CARDS.filter(([, label]) => label.toLowerCase().includes(text)).slice(0, 8);
  }, [artQuery]);
  const [key, setKey] = useState<ZoneKey | "">(start && free.includes(start) ? start : free[0] ?? "");
  useEffect(() => {
    const text = query.trim(); if (text.length < 2) { setFound(null); return; }
    let on = true; const timer = setTimeout(() => { void searchCards(text, false).then(list => { if (on) setFound(list.filter(card => /token/i.test(card.type))); }); }, 200);
    return () => { on = false; clearTimeout(timer); };
  }, [query]);
  const draft = useMemo(() => {
    if (!key && !zoneless) return null;
    const at = key ? { key } : {};
    if (mode === "common") return chosen ? { name: chosen.name, atk: chosen.atk ?? 0, def: chosen.def ?? 0, artId: chosen.id, position, ...at } : null;
    const a = points(atk), d = points(def), label = name.trim().slice(0, 200);
    return label && a !== null && d !== null ? { name: label, atk: a, def: d, ...(art ? { artId: art } : {}), position, ...at } : null;
  }, [mode, chosen, atk, def, name, art, position, key, zoneless]);
  const typing = { onKeyDown: (event: React.KeyboardEvent) => { if (event.key !== "Escape") event.stopPropagation(); } };
  return <PopupFrame at={CENTER} layer="token" label="Create a token" testid="token-dialog" modal={modal}>
    <form className={t.dialog} onSubmit={event => { event.preventDefault(); if (draft) onCreate(draft); }}>
      <h3>{zoneless ? "Custom token" : "Create a token"}</h3>
      {zone ? <p className={t.chosen} data-testid="token-picked-zone">Zone: <b>{zone.label}</b>
        <button type="button" className={`${s.btn} ${s.sm} ${s.q}`} style={{ marginLeft: 8 }} data-testid="token-change-zone"
          onClick={() => { const a = points(atk), d = points(def); zone.change({ name: name.trim() || "Token", atk: a ?? 0, def: d ?? 0, artId: art, position }); }}>Change zone</button></p> : null}
      <div className={t.seg} role="group" aria-label="Kind of token">
        <button type="button" className={`${s.btn} ${s.sm} ${mode === "common" ? s.go : s.q}`} aria-pressed={mode === "common"} onClick={() => setMode("common")} data-testid="token-mode-common">Common token</button>
        <button type="button" className={`${s.btn} ${s.sm} ${mode === "generic" ? s.go : s.q}`} aria-pressed={mode === "generic"} onClick={() => setMode("generic")} data-testid="token-mode-generic">Generic token</button>
      </div>
      {mode === "common" ? <>
        <label className={t.field}>Search the token by name
          <input className={t.num} style={{ width: "100%" }} type="text" autoComplete="off" placeholder="Sheep Token" value={query} data-autofocus data-testid="token-search" {...typing} onChange={event => { setQuery(event.target.value); setChosen(null); }} /></label>
        <div className={t.pick}>
          {found?.map(card => <button key={card.id} type="button" className={`${s.btn} ${s.sm} ${s.q}`} onClick={() => { setChosen(card); setQuery(card.name); setFound(null); }} data-testid="token-pick">{card.name} · ATK {card.atk ?? 0} / DEF {card.def ?? 0}</button>)}
          {found && !found.length ? <p className={t.note} role="status">No token with that name. Use a generic token.</p> : null}
        </div>
        {chosen ? <p className={t.chosen} data-testid="token-chosen">{chosen.name} · ATK {chosen.atk ?? 0} / DEF {chosen.def ?? 0}</p> : null}
      </> : <div className={t.row}>
        <label className={t.field}>Name<input className={t.num} style={{ width: 150 }} type="text" maxLength={200} value={name} data-autofocus data-testid="token-name" {...typing} onChange={event => setName(event.target.value)} /></label>
        <label className={t.field}>ATK<input className={t.num} inputMode="numeric" value={atk} aria-invalid={points(atk) === null} data-testid="token-atk" {...typing} onChange={event => setAtk(event.target.value)} /></label>
        <label className={t.field}>DEF<input className={t.num} inputMode="numeric" value={def} aria-invalid={points(def) === null} data-testid="token-def" {...typing} onChange={event => setDef(event.target.value)} /></label>
        <div className={t.artPick} data-testid="token-art">
          <img className={t.artThumb} src={cardArt(art ?? DEFAULT_TOKEN_ART, "small")} alt="" width={40} height={58} draggable={false} data-testid="token-art-preview" />
          <label className={t.field}>Token art
            <input className={t.num} style={{ width: 150 }} type="text" autoComplete="off" placeholder="Search token cards" value={artQuery} data-testid="token-art-search" {...typing} onChange={event => setArtQuery(event.target.value)} /></label>
          {art ? <button type="button" className={`${s.btn} ${s.sm} ${s.q}`} onClick={() => setArt(undefined)} data-testid="token-art-reset">Default art</button> : null}
        </div>
        {artHits.length ? <div className={t.pick} style={{ flexBasis: "100%" }} data-testid="token-art-hits">
          {artHits.map(([id, label]) => <button key={id} type="button" className={`${s.btn} ${s.sm} ${s.q} ${t.artHit}`} onClick={() => { setArt(id); setName(label); setArtQuery(""); }} data-testid="token-art-pick">
            <img src={cardArt(id, "small")} alt="" width={20} height={29} loading="lazy" draggable={false} />{label}</button>)}
        </div> : null}
        {initial?.prefilled ? <p className={t.note} data-testid="token-suggested">Suggested from the Tributed monsters (original ATK/DEF).{initial.unknown ? ` ${initial.unknown} ${initial.unknown === 1 ? "monster is" : "monsters are"} unknown and not counted.` : ""} Change it if it is wrong.</p> : initial?.unknown ? <p className={t.note} data-testid="token-suggested">{initial.unknown} {initial.unknown === 1 ? "monster is" : "monsters are"} unknown. Type the ATK and DEF.</p> : null}
      </div>}
      <div className={t.row}>
        <div className={t.seg} role="group" aria-label="Position">
          <button type="button" className={`${s.btn} ${s.sm} ${position === "attack" ? s.go : s.q}`} aria-pressed={position === "attack"} onClick={() => setPosition("attack")} data-testid="token-attack">Attack</button>
          <button type="button" className={`${s.btn} ${s.sm} ${position === "defense" ? s.go : s.q}`} aria-pressed={position === "defense"} onClick={() => setPosition("defense")} data-testid="token-defense">Defense</button>
        </div>
        {zoneless || zone ? null : free.length ? <label className={t.field}>Zone
          <select className={t.num} style={{ width: 150 }} value={key} data-testid="token-zone" onChange={event => setKey(event.target.value as ZoneKey)}>
            {free.map(item => <option key={item} value={item}>{zoneLabel(item)}</option>)}</select></label>
          : <p className={t.note} role="status">Every Main Monster Zone is taken.</p>}
      </div>
      <div className={t.row}>
        <button type="submit" className={`${s.btn} ${s.go}`} disabled={!draft} data-testid="token-create">{zoneless ? "Choose a zone" : "Create token"}</button>
        <button type="button" className={`${s.btn} ${s.q}`} onClick={onClose}>Cancel</button>
      </div>
    </form>
  </PopupFrame>;
}

function TokenPopover({ card, editable, free, art, onTurn, onStats, onMove, onRemove, onClose }: {
  card: TwinCard; editable: boolean; free: ZoneKey[]; art: CardInfo | undefined;
  onTurn: () => void; onStats: (atk: number, def: number) => void; onMove: (key: ZoneKey) => void; onRemove: () => void; onClose: () => void;
}) {
  const [target, setTarget] = useState<ZoneKey | "">("");
  const token = card.token!; const defense = card.position === "defense";
  const [atk, setAtk] = useState(String(token.atk)); const [def, setDef] = useState(String(token.def));
  const next = { atk: points(atk), def: points(def) };
  const changed = next.atk !== null && next.def !== null && (next.atk !== token.atk || next.def !== token.def);
  return <PopupFrame at={CENTER} layer="token" label={`${cardName(card, art)} token`} testid="token-popover">
    <div className={t.dialog}>
      <BigArt id={token.artId ?? DEFAULT_TOKEN_ART} label={card.name} />
      <h3 data-testid="token-title">{cardName(card, art)}</h3>
      <p className={t.chosen}>Token · {defense ? "Defense" : "Attack"} position · ATK {token.atk} / DEF {token.def}</p>
      {editable ? <>
        <div className={t.row}>
          <button type="button" className={`${s.btn} ${s.sm}`} onClick={onTurn} data-testid="token-turn">{defense ? "Switch to Attack" : "Switch to Defense"}</button>
          <button type="button" className={`${s.btn} ${s.sm}`} onClick={() => { onRemove(); }} data-testid="token-remove">Remove token</button>
        </div>
        <div className={t.row}>
          <label className={t.field}>ATK<input className={t.num} inputMode="numeric" value={atk} aria-invalid={next.atk === null} data-testid="token-edit-atk" onKeyDown={event => { if (event.key !== "Escape") event.stopPropagation(); }} onChange={event => setAtk(event.target.value)} /></label>
          <label className={t.field}>DEF<input className={t.num} inputMode="numeric" value={def} aria-invalid={next.def === null} data-testid="token-edit-def" onKeyDown={event => { if (event.key !== "Escape") event.stopPropagation(); }} onChange={event => setDef(event.target.value)} /></label>
          <button type="button" className={`${s.btn} ${s.sm}`} disabled={!changed} onClick={() => { if (next.atk !== null && next.def !== null) onStats(next.atk, next.def); }} data-testid="token-stats">Set ATK/DEF</button>
        </div>
        {free.length ? <div className={t.row}>
          <label className={t.field}>Move to
            <select className={t.num} style={{ width: 170 }} value={target} data-testid="token-move-zone" onChange={event => setTarget(event.target.value as ZoneKey)}>
              <option value="">Choose a zone</option>{free.map(item => <option key={item} value={item}>{zoneLabel(item)}</option>)}</select></label>
          <button type="button" className={`${s.btn} ${s.sm}`} disabled={!target} onClick={() => { if (target) { onMove(target); setTarget(""); } }} data-testid="token-move">Move</button>
        </div> : null}
      </> : null}
      <div className={t.row}><button type="button" className={`${s.btn} ${s.q}`} onClick={onClose}>Close</button></div>
    </div>
  </PopupFrame>;
}
