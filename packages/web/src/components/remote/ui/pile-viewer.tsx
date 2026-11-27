"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import type { RemoteActionProposal } from "@yugidraft/shared/remote";
import { cardArt, searchCards, useCardInfo, type CardInfo } from "./catalog";
import { DragGhost, VERDICT_CLASS, type FieldDrag } from "./holo-field";
import { Icon } from "./icons";
import { cardCode, cardName, type TwinCard, type ZoneKey } from "./model";
import type { Verdict } from "./placement";
import { BigArt, CardText, type Rect } from "./popup";
import s from "./remote-ui.module.css";

/** Graveyard and Banished are public. Deck and Extra Deck are private: only the owner opens them (the cards the table holds there). */
export type PileZone = "graveyard" | "banished" | "deck" | "extra";
export type PublicPile = Extract<PileZone, "graveyard" | "banished">;
export type PileEntry = Extract<RemoteActionProposal, { type: "pile.set" }>["entries"][number];
export type PileRead = Omit<PileEntry, "ref"> & { faceUp: boolean; uncertain?: boolean };
export type PileScan = (zone: PublicPile, signal: AbortSignal) => Promise<PileRead[] | null>;
export const PILE_LABEL: Record<PileZone, string> = { graveyard: "Graveyard", banished: "Banished", deck: "Deck", extra: "Extra Deck" };

/** The cards of one pile, newest first. The twin list keeps GY and banished cards oldest to newest, so the newest is the last. */
export const pileCards = (twin: readonly TwinCard[], zone: PileZone): TwinCard[] => twin.filter(card => card.zone === zone).reverse();

/**
 * The Graveyard and Banished pile of one seat as a fanned list, newest first. Both are public, so every seat can open it.
 * The owner sees the name of a face-down banished card; the others get a card back (the server never sends them the name).
 * The owner can drag a card from the pile to a zone of the field, or to the hand chip, with the same rules as the field.
 */
export function PileViewer({ fieldHidden = false, seat, name, mine, twin, zone, onZone, info, drag: dragProp, onOpenCard, onOrder, onLift, onName, onRemove, onClose, deck = [], onAdd, onScan, onReview, onApply }: {
  /** The virtual field of this seat is hidden: only the hand is a drop target. */ fieldHidden?: boolean;
  seat: number; name: string; mine: boolean; twin: readonly TwinCard[]; zone: PileZone; onZone: (zone: PileZone) => void;
  info: (id: number | undefined) => CardInfo | undefined; drag?: FieldDrag;
  /** Opens the card popup (text, stats and the move buttons) beside the tile. */
  onOpenCard: (card: TwinCard, anchor: Rect) => void; onClose: () => void;
  /** Owner only. Sets the whole pile order, oldest first (one `pile.order`). The promise settles when the write is done. */
  onOrder?: (zone: PublicPile, refsOldestFirst: string[]) => void | Promise<unknown>;
  onLift?: (zone: PublicPile, refsOldestFirst: string[], destination: "hand" | "deck") => void | Promise<unknown>;
  /** Owner only. Names an unnamed face-up card (`card.identified` with its ref), and removes a card (`twin.remove`). */
  onName?: (card: TwinCard, cardId: number, name: string) => void; onRemove?: (card: TwinCard) => void;
  deck?: readonly number[];
  onAdd?: (zone: PublicPile, card: CardInfo) => Promise<unknown>;
  onScan?: PileScan;
  onReview?: (zone: PublicPile | null) => void;
  onApply?: (zone: PublicPile, entries: PileEntry[], expectedRefs: string[]) => Promise<unknown>;
}) {
  // Only Graveyard and Banished are ordered piles (newest first, a top card, drag back to play). Deck and Extra list what the table holds, nothing more.
  const ordered = zone === "graveyard" || zone === "banished";
  const dnd = ordered ? dragProp : undefined;
  // An opponent's Deck and Extra Deck stay private, even if the viewer is pointed at them.
  const cards = !mine && (zone === "deck" || zone === "extra") ? [] : pileCards(twin, zone);
  const counts: Record<PileZone, number> = { graveyard: pileCards(twin, "graveyard").length, banished: pileCards(twin, "banished").length, deck: pileCards(twin, "deck").length, extra: pileCards(twin, "extra").length };
  const canOrder = !!onOrder && ordered;
  const list = useRef<HTMLUListElement>(null);
  const [active, setActive] = useState(0);
  const [hot, setHot] = useState<string | null>(null);
  const [dragging, setDragging] = useState<{ ref: string; x: number; y: number; verdict: Verdict["kind"] | null } | null>(null);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<{ zone: PublicPile; mode: "add" | "review" } | null>(null);
  const editingHere = mine && editing?.zone === zone ? editing.mode : null;
  const narrow = useNarrow();
  const swallow = useRef(false);
  const stop = useRef<(() => void) | null>(null);
  useEffect(() => () => stop.current?.(), []);
  const at = Math.min(active, Math.max(0, cards.length - 1));
  const previewCard = cards.find(card => card.ref === hot) ?? cards[at];
  const shown = (card: TwinCard) => card.faceUp || mine;
  /** An unnamed face-up card the owner can name or remove. */
  const nameable = !!onName && ordered && !!previewCard && previewCard.faceUp && !cardCode(previewCard) && !previewCard.name;
  const previewCode = previewCard && shown(previewCard) ? cardCode(previewCard) : undefined;
  const previewArt = previewCard ? <BigArt id={previewCode ?? null} label={shown(previewCard) ? cardName(previewCard, info(previewCode)) : "Face-down card"} /> : null;

  /** Pointer drag (mouse and pen). A press that moves less than 6 px stays a click. */
  function begin(event: ReactPointerEvent<HTMLElement>, card: TwinCard) {
    if (saving || !dnd?.can(card) || event.pointerType === "touch" || (event.pointerType === "mouse" && event.button !== 0)) return;
    const start = { x: event.clientX, y: event.clientY }; const id = event.pointerId; let started = false; let marked: Element | null = null; let markClass = "";
    const hit = (x: number, y: number): { key: ZoneKey | "hand"; el: Element } | null => {
      // A toast over the target never blocks a drop.
      const at = document.elementsFromPoint(x, y).find(el => !el.closest('[data-testid="toasts"]')) ?? null;
      const chip = at?.closest("[data-hand-drop]"); if (chip) return { key: "hand", el: chip };
      const cell = at?.closest<HTMLElement>("[data-zone][data-seat]");
      return cell && Number(cell.dataset.seat) === seat ? { key: cell.dataset.zone as ZoneKey, el: cell } : null;
    };
    const unmark = () => { if (marked && markClass) marked.classList.remove(markClass); marked = null; markClass = ""; };
    const onMove = (e: PointerEvent) => {
      if (e.pointerId !== id) return;
      if (!started) { if (Math.hypot(e.clientX - start.x, e.clientY - start.y) < 6) return; started = true; }
      const over = hit(e.clientX, e.clientY); const kind = over ? dnd.judge(card, over.key).kind : null;
      unmark();
      if (over && kind && VERDICT_CLASS[kind]) { marked = over.el; markClass = VERDICT_CLASS[kind]; over.el.classList.add(markClass); }
      setDragging({ ref: card.ref, x: e.clientX, y: e.clientY, verdict: kind });
    };
    const finish = (e: PointerEvent, cancelled: boolean) => {
      if (e.pointerId !== id) return;
      cleanup(); unmark();
      if (!started) return;
      swallow.current = true; setTimeout(() => { swallow.current = false; }, 60);
      setDragging(null);
      const over = cancelled ? null : hit(e.clientX, e.clientY);
      if (over) dnd.drop(card, over.key as ZoneKey, dnd.judge(card, over.key));
    };
    const up = (e: PointerEvent) => finish(e, false); const cancel = (e: PointerEvent) => finish(e, true);
    const cleanup = () => { window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", up); window.removeEventListener("pointercancel", cancel); stop.current = null; };
    window.addEventListener("pointermove", onMove); window.addEventListener("pointerup", up); window.addEventListener("pointercancel", cancel);
    stop.current = () => { cleanup(); unmark(); };
  }

  /** Swaps a tile with its newer (-1) or older (+1) neighbour. The viewer lists newest first; the action wants oldest first. */
  function shift(index: number, by: -1 | 1) {
    const next = [...cards]; const to = index + by; if (!ordered || !onOrder || saving || to < 0 || to >= next.length) return;
    [next[index], next[to]] = [next[to], next[index]];
    setSaving(true);
    void Promise.resolve(onOrder(zone, next.map(card => card.ref).reverse())).finally(() => setSaving(false));
  }

  async function lift(destination: "hand" | "deck") {
    if (!mine || !ordered || !cards.length || !onLift || saving) return;
    setSaving(true);
    try {
      await onLift(zone, cards.map(card => card.ref).reverse(), destination);
    } finally {
      setSaving(false);
    }
  }

  /** Arrow keys move focus over the tiles, Home and End jump to the newest and the oldest. */
  function keys(event: KeyboardEvent<HTMLUListElement>) {
    const items = [...(list.current?.querySelectorAll<HTMLElement>("button[data-tile]") ?? [])];
    const i = items.indexOf(document.activeElement as HTMLElement); if (i < 0) return;
    const columns = Math.max(1, items.filter(el => el.offsetTop === items[0].offsetTop).length);
    const next = event.key === "ArrowRight" ? i + 1 : event.key === "ArrowLeft" ? i - 1 : event.key === "ArrowDown" ? Math.min(i + columns, items.length - 1) : event.key === "ArrowUp" ? Math.max(i - columns, 0)
      : event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : i;
    if (next === i || next < 0 || next >= items.length) return;
    event.preventDefault(); setActive(next); setHot(null); items[next].focus();
  }
  const label = `${name}'s ${PILE_LABEL[zone]}`;
  return <div className={s.pileRoot} data-layer-opener data-dragging={dragging ? "on" : undefined} data-testid="pile-root">
    <div className={s.pile} role="dialog" aria-label={label} data-layer="pile" data-testid="pile-viewer" data-zone={zone} data-seat={seat}>
      <div className={s.pileHead}>
        <h2 className={s.pileTitle}>{name}<small>{mine ? "your pile" : "public pile"}</small></h2>
        <div className={s.seg} role="group" aria-label="Pile">
          {((mine ? ["graveyard", "banished", "deck", "extra"] : ["graveyard", "banished"]) as PileZone[]).map(id => <button type="button" key={id} aria-pressed={zone === id} data-testid={`pile-tab-${id}`} onClick={() => { setActive(0); setHot(null); setEditing(null); onZone(id); }}>{PILE_LABEL[id]} <b>{counts[id]}</b></button>)}
        </div>
        <button type="button" className={s.ibtn} aria-label="Close pile" onClick={onClose} data-testid="pile-close"><Icon name="x" /></button>
      </div>
      {mine && ordered && !editingHere ? <div className={s.pileActions}>
        {onAdd ? <button type="button" className={PILE_BUTTON} disabled={saving} onClick={() => setEditing({zone, mode:"add"})}>Add card</button> : null}
        {onApply ? <button type="button" className={PILE_BUTTON} disabled={saving} title="Fan or spread the pile in its camera zone" onClick={() => setEditing({zone, mode:"review"})}>Re-check pile</button> : null}
        {onLift && cards.length ? <>
          <button type="button" className={PILE_BUTTON} disabled={saving} onClick={() => void lift("hand")}>Take all to hand</button>
          <button type="button" className={PILE_BUTTON} disabled={saving} onClick={() => void lift("deck")}>Shuffle all into Deck</button>
        </> : null}
      </div> : null}
      {mine && ordered && editingHere === "review" && onApply ? <PileEditor key={zone} zone={zone} cards={cards} deck={deck} onScan={onScan} onReview={onReview} onApply={onApply} onCancel={() => setEditing(null)} /> : null}
      {mine && ordered && editingHere === "add" && onAdd ? <div className={s.pileEdit}>
        <PileCardSearch deck={deck} disabled={saving} onPick={async card => {
          setSaving(true);
          try { if (await onAdd(zone, card)) setEditing(null); } finally { setSaving(false); }
        }} />
        <button type="button" className={PILE_BUTTON} disabled={saving} onClick={() => setEditing(null)}>Cancel</button>
      </div> : null}
      {editingHere !== "review" ? <div className={s.pileBody}>
        {cards.length ? <ul className={s.pileList} ref={list} role="list" aria-label={`${PILE_LABEL[zone]}${ordered ? ", newest first" : ""}, ${cards.length} card${cards.length === 1 ? "" : "s"}`} onKeyDown={keys}
          onClickCapture={event => { if (swallow.current) { event.stopPropagation(); event.preventDefault(); } }}>
          {cards.map((card, index) => {
            const code = cardCode(card); const open = shown(card); const known = open && !!code; const title = open ? cardName(card, info(code)) : "Face-down card";
            const down = !card.faceUp;
            return <li key={card.ref} className={s.pileItem}>
              <button type="button" data-tile data-testid="pile-card" data-ref={card.ref} data-down={down ? "on" : undefined} className={`${s.pileTile} ${dnd?.can(card) ? s.drg : ""} ${dragging?.ref === card.ref ? s.dragSrc : ""}`}
                tabIndex={index === at ? 0 : -1} data-autofocus={index === at ? "" : undefined} aria-label={`${index + 1}. ${title}${down && open ? ", face-down" : ""}${ordered && index === 0 ? ", top of the pile" : ""}`}
                onFocus={() => { setActive(index); setHot(card.ref); }} onMouseEnter={() => setHot(card.ref)} onMouseLeave={() => setHot(null)} onBlur={() => setHot(null)}
                onPointerDown={event => begin(event, card)}
                onClick={event => { const box = event.currentTarget.getBoundingClientRect(); onOpenCard(card, { left: box.left, top: box.top, right: box.right, bottom: box.bottom }); }}>
                <span className={s.pileArt}>
                  {known ? <img src={cardArt(code!, "small")} alt="" draggable={false} loading="lazy" /> : open && card.faceUp ? <span className={s.pileUnk}>?</span> : <span className={`${s.cd} ${s.back} ${s.pileBack}`} />}
                  {down ? <i className={s.pileDown}>{open ? "Face-down" : ""}</i> : null}
                </span>
                <span className={s.pileNo}>{ordered && index === 0 ? "TOP" : index + 1}</span>
                <span className={s.pileName}>{title}</span>
              </button>
              {canOrder && cards.length > 1 ? <span className={s.pileOrd}>
                <button type="button" disabled={saving || index === 0} aria-label={`Move ${title} newer`} title="Move newer (toward the top)" data-testid="pile-newer" onClick={() => shift(index, -1)}>{"\u2190"}</button>
                <button type="button" disabled={saving || index === cards.length - 1} aria-label={`Move ${title} older`} title="Move older (toward the bottom)" data-testid="pile-older" onClick={() => shift(index, 1)}>{"\u2192"}</button>
              </span> : null}
              {mine && ordered && onRemove ? <button type="button" className={s.pileRm} disabled={saving} aria-label={`Remove ${title}`} title="Remove from pile" data-testid="pile-tile-remove" onClick={() => onRemove(card)}>{"\u00d7"}</button> : null}
            </li>;
          })}
        </ul> : <p className={s.pileEmpty} data-testid="pile-empty">No cards in the {PILE_LABEL[zone]} yet.</p>}
        <aside className={s.pilePrev} aria-hidden={previewCard ? undefined : true} data-testid="pile-preview">
          {previewCard ? <>
            {previewCode ? <CardText id={previewCode} info={info(previewCode)} name={previewCard.name} fallbackName={`Card ${previewCode}`} art={previewArt} />
              : <div className={s.bhead}>{previewArt}<div className={s.bheadText}><h2 className={s.bname}>{shown(previewCard) ? cardName(previewCard, undefined) : "Face-down card"}</h2></div></div>}
            {!narrow && nameable ? <NameIt key={previewCard.ref} onName={(id, nm) => onName!(previewCard, id, nm)} onRemove={onRemove ? () => onRemove(previewCard) : undefined} /> : null}
          </> : null}
        </aside>
      </div> : null}
      {editingHere !== "review" && narrow && nameable ? <div className={s.pileNameBar} data-testid="pile-name-bar">
        <p className={s.dmeta}>Selected: card {at + 1} of {cards.length}</p>
        <NameIt key={previewCard!.ref} onName={(id, nm) => onName!(previewCard!, id, nm)} onRemove={onRemove ? () => onRemove(previewCard!) : undefined} />
      </div> : null}
      {editingHere !== "review" ? <p className={s.pileHint}>{cards.length ? <>{ordered ? "Newest first. " : ""}<kbd>Arrows</kbd> move, <kbd>Enter</kbd> opens a card{canOrder ? ", the arrow buttons on a card change the order" : ""}{dnd ? `, drag a card to ${fieldHidden ? "the hand" : "the field or hand"} to bring it back` : ""}. <kbd>Esc</kbd> closes.</> : <><kbd>Esc</kbd> closes.</>}</p> : null}
    </div>
    {dnd ? <div className={s.pileHand} data-hand-drop data-testid="pile-hand-drop" aria-hidden="true"><Icon name="hand" />Drop here: to hand</div> : null}
    {dragging && typeof document !== "undefined" ? createPortal(<DragGhost card={twin.find(card => card.ref === dragging.ref)} info={info} x={dragging.x} y={dragging.y} verdict={dragging.verdict} />, document.body) : null}
  </div>;
}

const PILE_BUTTON = `${s.btn} ${s.sm} ${s.q}`;

/** Use the same catalog search as Identify, with registered cards before other results. */
export function PileCardSearch({ deck, disabled, onPick }: {deck: readonly number[]; disabled?: boolean; onPick: (card: CardInfo) => void}) {
  const [query, setQuery] = useState(""), [found, setFound] = useState<{ text: string; cards: CardInfo[] }>({ text: "", cards: [] });
  const info = useCardInfo(deck);
  const text = query.trim().toLowerCase();
  useEffect(() => {
    if (text.length < 2) return;
    let alive = true;
    const timer = setTimeout(() => { void searchCards(text).then(cards => { if (alive) setFound({ text, cards }); }); }, 200);
    return () => { alive = false; clearTimeout(timer); };
  }, [text]);
  const deckMatches = [...new Set(deck)].flatMap(id => {
    const card = info(id);
    return card?.name.toLowerCase().includes(text) ? [card] : [];
  });
  const catalog = found.text === text ? found.cards.filter(card => !deckMatches.some(match => match.id === card.id)) : [];
  const results = [...deckMatches, ...catalog.filter(card => deck.includes(card.id)), ...catalog.filter(card => !deck.includes(card.id))].slice(0, 8);
  return <div className={s.pileSearch}>
    <div className={s.srch}><Icon name="search" /><input autoFocus aria-label="Search cards" placeholder="Search cards" value={query} disabled={disabled} onChange={event => setQuery(event.target.value)}
      onKeyDown={event => { if (event.key === "Escape") return; event.stopPropagation(); if (event.key === "Enter" && results[0] && !disabled) { event.preventDefault(); onPick(results[0]); } }} /></div>
    <div className={s.pileSearchResults}>{results.map(card => <button type="button" className={PILE_BUTTON} disabled={disabled} key={card.id} onClick={() => onPick(card)}><img className={s.pileThumb} src={cardArt(card.id, "small")} alt="" loading="lazy" draggable={false} />{card.name}</button>)}</div>
  </div>;
}

type EditRow = { entry: PileEntry; label: string; checked: boolean; uncertain?: boolean };
function PileEditor({ zone, cards, deck, onScan, onReview, onApply, onCancel }: {
  zone: PublicPile; cards: TwinCard[]; deck: readonly number[]; onScan?: PileScan; onReview?: (zone: PublicPile | null) => void;
  onApply: (zone: PublicPile, entries: PileEntry[], expectedRefs: string[]) => Promise<unknown>; onCancel: () => void;
}) {
  const [initial] = useState(() => cards), [rows, setRows] = useState<EditRow[]>(() => cards.map(card => ({ entry: { ref: card.ref }, label: cardName(card, undefined), checked: true })));
  const [reading, setReading] = useState(false), [camera, setCamera] = useState(false), [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false), [error, setError] = useState("");
  const job = useRef<AbortController | null>(null);
  async function read(scan: PileScan) {
    job.current?.abort();
    const controller = new AbortController(); job.current = controller;
    setReading(true); setError("");
    try {
      const result = await scan(zone, controller.signal);
      if (controller.signal.aborted || !result) return;
      const unmatched = [...initial].reverse();
      const list = result.map(({ uncertain, ...card }) => {
        const match = unmatched.findIndex(existing => existing.faceUp === card.faceUp && (!card.faceUp || cardCode(existing) === card.cardId));
        const entry = match < 0 ? { ref: crypto.randomUUID(), ...card } : { ref: unmatched.splice(match, 1)[0].ref };
        return { entry, label: card.name ?? (card.faceUp ? "Unidentified card" : "Face-down card"), checked: true, uncertain };
      });
      setRows(list.reverse()); setCamera(true);
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Could not read this pile.");
    } finally {
      if (!controller.signal.aborted) setReading(false);
    }
  }
  useEffect(() => {
    onReview?.(zone);
    return () => { job.current?.abort(); onReview?.(null); };
  }, [onReview, zone]);
  const shift = (index: number, delta: number) => setRows(list => {
    const next = [...list], to = index + delta;
    [next[index], next[to]] = [next[to], next[index]];
    return next;
  });
  async function apply() {
    setSaving(true); setError("");
    try {
      if (await onApply(zone, rows.filter(row => row.checked).map(row => row.entry).reverse(), initial.map(card => card.ref).reverse())) onCancel();
      else setError("Could not apply the pile. Close and re-check if it has changed.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not apply the pile.");
    } finally { setSaving(false); }
  }
  return <div className={s.pileEdit}>
    <div className={s.pileEditControls}>
      {onScan ? <><button type="button" className={PILE_BUTTON} disabled={saving || reading} onClick={() => void read(onScan)}>Read camera</button>
        <span className={s.pileScanHint}>Fan or spread the cards from the pile zone so each face is visible.</span></> : null}
      <button type="button" className={PILE_BUTTON} disabled={saving || reading} onClick={() => setAdding(value => !value)}>Add card</button>
    </div>
    {reading ? <p role="status">Reading pile…</p> : null}
    {adding && !reading ? <PileCardSearch deck={deck} disabled={saving} onPick={card => {
      setRows(list => [{ entry: { ref: crypto.randomUUID(), cardId: card.id, name: card.name, faceUp: true }, label: card.name, checked: true }, ...list]);
      setAdding(false);
    }} /> : null}
    {!reading ? <><strong>{camera ? "Camera sees" : "Current pile"}</strong>
      {camera && initial.length > rows.length ? <p>Applying this list will replace {initial.length} saved cards.</p> : null}
      {rows.length ? <ol className={s.pileEditList} aria-label="Pile cards, top first">
        {rows.map(({ entry, label, checked, uncertain }, index) => <li key={entry.ref}>
          <label><input type="checkbox" checked={checked} disabled={saving} onChange={event => {
            const checked = event.target.checked;
            setRows(list => list.map(row => row.entry.ref === entry.ref ? {...row, checked} : row));
          }} /> {Number(entry.cardId) > 0 ? <img className={s.pileThumb} src={cardArt(Number(entry.cardId), "small")} alt="" loading="lazy" draggable={false} /> : null}<span>{label}{uncertain ? " (check match)" : ""}{index === 0 ? " · Top" : ""}</span></label>
          <button type="button" className={PILE_BUTTON} disabled={saving || index === 0} aria-label={`Move ${label} up`} onClick={() => shift(index, -1)}>↑</button>
          <button type="button" className={PILE_BUTTON} disabled={saving || index === rows.length - 1} aria-label={`Move ${label} down`} onClick={() => shift(index, 1)}>↓</button>
        </li>)}
      </ol> : <p>No cards</p>}
    </> : null}
    {error ? <p role="alert">{error}</p> : null}
    <div className={s.pileEditControls}>
      <button type="button" className={`${s.btn} ${s.sm}`} disabled={saving || reading} onClick={() => void apply()}>Apply</button>
      <button type="button" className={PILE_BUTTON} disabled={saving} onClick={onCancel}>Cancel</button>
    </div>
  </div>;
}

const NARROW = "(max-width:1100px)";
/** True while the preview panel is hidden by CSS (same breakpoint as `.pilePrev`). */
function useNarrow() {
  return useSyncExternalStore(
    notify => { const mq = window.matchMedia(NARROW); mq.addEventListener("change", notify); return () => mq.removeEventListener("change", notify); },
    () => window.matchMedia(NARROW).matches, () => false);
}

/** Owner only: an unnamed face-up card in a pile. Search the catalog to name it, or remove it. */
function NameIt({ onName, onRemove }: { onName: (cardId: number, name: string) => void; onRemove?: () => void }) {
  const [query, setQuery] = useState(""); const [found, setFound] = useState<CardInfo[]>([]);
  useEffect(() => {
    const text = query.trim(); if (text.length < 2) { setFound([]); return; }
    let live = true; const timer = setTimeout(() => { void searchCards(text).then(list => { if (live) setFound(list.slice(0, 5)); }); }, 200);
    return () => { live = false; clearTimeout(timer); };
  }, [query]);
  return <div className={s.pileName2} data-testid="pile-name-it">
    <p className={s.dmeta}>Unknown card. Name it:</p>
    <div className={s.srch}><Icon name="search" /><input type="text" placeholder="Search any card" aria-label="Name this card" autoComplete="off" value={query} onChange={event => setQuery(event.target.value)}
      onKeyDown={event => { if (event.key === "Enter" && found[0]) { event.preventDefault(); onName(found[0].id, found[0].name); } else if (event.key !== "Escape") event.stopPropagation(); }} /></div>
    {found.map(card => <button key={card.id} type="button" className={`${s.btn} ${s.sm} ${s.q}`} onClick={() => onName(card.id, card.name)} data-testid="pile-name-pick">{card.name}</button>)}
    {onRemove ? <button type="button" className={`${s.btn} ${s.sm} ${s.q}`} onClick={onRemove} data-testid="pile-remove">Remove from pile</button> : null}
  </div>;
}
