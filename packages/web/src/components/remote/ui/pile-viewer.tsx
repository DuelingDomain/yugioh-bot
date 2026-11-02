"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { cardArt, type CardInfo } from "./catalog";
import { DragGhost, VERDICT_CLASS, type FieldDrag } from "./holo-field";
import { Icon } from "./icons";
import { cardCode, cardName, type TwinCard, type ZoneKey } from "./model";
import type { Verdict } from "./placement";
import { BigArt, CardText, type Rect } from "./popup";
import s from "./remote-ui.module.css";

export type PileZone = "graveyard" | "banished";
export const PILE_LABEL: Record<PileZone, string> = { graveyard: "Graveyard", banished: "Banished" };

/** The cards of one pile, newest first. The twin list keeps GY and banished cards oldest to newest, so the newest is the last. */
export const pileCards = (twin: readonly TwinCard[], zone: PileZone): TwinCard[] => twin.filter(card => card.zone === zone).reverse();

/**
 * The Graveyard and Banished pile of one seat as a fanned list, newest first. Both are public, so every seat can open it.
 * The owner sees the name of a face-down banished card; the others get a card back (the server never sends them the name).
 * The owner can drag a card from the pile to a zone of the field, or to the hand chip, with the same rules as the field.
 */
export function PileViewer({ seat, name, mine, twin, zone, onZone, info, drag: dnd, onOpenCard, onClose }: {
  seat: number; name: string; mine: boolean; twin: readonly TwinCard[]; zone: PileZone; onZone: (zone: PileZone) => void;
  info: (id: number | undefined) => CardInfo | undefined; drag?: FieldDrag;
  /** Opens the card popup (text, stats and the move buttons) beside the tile. */
  onOpenCard: (card: TwinCard, anchor: Rect) => void; onClose: () => void;
}) {
  const cards = pileCards(twin, zone);
  const counts: Record<PileZone, number> = { graveyard: pileCards(twin, "graveyard").length, banished: pileCards(twin, "banished").length };
  const list = useRef<HTMLUListElement>(null);
  const [active, setActive] = useState(0);
  const [hot, setHot] = useState<string | null>(null);
  const [dragging, setDragging] = useState<{ ref: string; x: number; y: number; verdict: Verdict["kind"] | null } | null>(null);
  const swallow = useRef(false);
  const stop = useRef<(() => void) | null>(null);
  useEffect(() => () => stop.current?.(), []);
  const at = Math.min(active, Math.max(0, cards.length - 1));
  const previewCard = cards.find(card => card.ref === hot) ?? cards[at];
  const shown = (card: TwinCard) => card.faceUp || mine;
  const previewCode = previewCard && shown(previewCard) ? cardCode(previewCard) : undefined;

  /** Pointer drag (mouse and pen). A press that moves less than 6 px stays a click. */
  function begin(event: ReactPointerEvent<HTMLElement>, card: TwinCard) {
    if (!dnd?.can(card) || event.pointerType === "touch" || (event.pointerType === "mouse" && event.button !== 0)) return;
    const start = { x: event.clientX, y: event.clientY }; const id = event.pointerId; let started = false; let marked: Element | null = null; let markClass = "";
    const hit = (x: number, y: number): { key: ZoneKey | "hand"; el: Element } | null => {
      const at = document.elementFromPoint(x, y);
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
          {(["graveyard", "banished"] as const).map(id => <button type="button" key={id} aria-pressed={zone === id} data-testid={`pile-tab-${id}`} onClick={() => { setActive(0); setHot(null); onZone(id); }}>{PILE_LABEL[id]} <b>{counts[id]}</b></button>)}
        </div>
        <button type="button" className={s.ibtn} aria-label="Close pile" onClick={onClose} data-testid="pile-close"><Icon name="x" /></button>
      </div>
      <div className={s.pileBody}>
        {cards.length ? <ul className={s.pileList} ref={list} role="list" aria-label={`${PILE_LABEL[zone]}, newest first, ${cards.length} card${cards.length === 1 ? "" : "s"}`} onKeyDown={keys}
          onClickCapture={event => { if (swallow.current) { event.stopPropagation(); event.preventDefault(); } }}>
          {cards.map((card, index) => {
            const code = cardCode(card); const open = shown(card); const known = open && !!code; const title = open ? cardName(card, info(code)) : "Face-down card";
            const down = !card.faceUp;
            return <li key={card.ref} className={s.pileItem}>
              <button type="button" data-tile data-testid="pile-card" data-ref={card.ref} data-down={down ? "on" : undefined} className={`${s.pileTile} ${dnd?.can(card) ? s.drg : ""} ${dragging?.ref === card.ref ? s.dragSrc : ""}`}
                tabIndex={index === at ? 0 : -1} data-autofocus={index === at ? "" : undefined} aria-label={`${index + 1}. ${title}${down && open ? ", face-down" : ""}${index === 0 ? ", top of the pile" : ""}`}
                onFocus={() => { setActive(index); setHot(card.ref); }} onMouseEnter={() => setHot(card.ref)} onMouseLeave={() => setHot(null)} onBlur={() => setHot(null)}
                onPointerDown={event => begin(event, card)}
                onClick={event => { const box = event.currentTarget.getBoundingClientRect(); onOpenCard(card, { left: box.left, top: box.top, right: box.right, bottom: box.bottom }); }}>
                <span className={s.pileArt}>
                  {known ? <img src={cardArt(code!, "small")} alt="" draggable={false} loading="lazy" /> : open && card.faceUp ? <span className={s.pileUnk}>?</span> : <span className={`${s.cd} ${s.back} ${s.pileBack}`} />}
                  {down ? <i className={s.pileDown}>{open ? "Face-down" : ""}</i> : null}
                </span>
                <span className={s.pileNo}>{index === 0 ? "TOP" : index + 1}</span>
                <span className={s.pileName}>{title}</span>
              </button>
            </li>;
          })}
        </ul> : <p className={s.pileEmpty} data-testid="pile-empty">No cards in the {PILE_LABEL[zone]} yet.</p>}
        <aside className={s.pilePrev} aria-hidden={previewCard ? undefined : true} data-testid="pile-preview">
          {previewCard ? <>
            <BigArt id={previewCode ?? null} label={shown(previewCard) ? cardName(previewCard, info(previewCode)) : "Face-down card"} />
            {previewCode ? <CardText id={previewCode} info={info(previewCode)} name={previewCard.name} fallbackName={`Card ${previewCode}`} />
              : <h2 className={s.bname}>{shown(previewCard) ? cardName(previewCard, undefined) : "Face-down card"}</h2>}
          </> : null}
        </aside>
      </div>
      <p className={s.pileHint}>{cards.length ? <>Newest first. <kbd>Arrows</kbd> move, <kbd>Enter</kbd> opens a card{dnd ? ", drag a card to the field or hand to bring it back" : ""}. <kbd>Esc</kbd> closes.</> : <><kbd>Esc</kbd> closes.</>}</p>
    </div>
    {dnd ? <div className={s.pileHand} data-hand-drop data-testid="pile-hand-drop" aria-hidden="true"><Icon name="hand" />Drop here: to hand</div> : null}
    {dragging && typeof document !== "undefined" ? createPortal(<DragGhost card={twin.find(card => card.ref === dragging.ref)} info={info} x={dragging.x} y={dragging.y} verdict={dragging.verdict} />, document.body) : null}
  </div>;
}
