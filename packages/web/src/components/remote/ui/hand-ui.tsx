"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cardArt } from "./catalog";
import { Icon } from "./icons";
import { sourceText, type HandBy, type HandCandidate, type HandSource, type HandSuggestion, type KnownHandCard } from "./reveal-model";
import s from "./remote-ui.module.css";

const FRESH_MS = 2600;

export type HandProps = {
  cards: KnownHandCard[]; count?: number;
  /** Only the owner seat changes the count. */
  onCount?: (count: number) => void;
  onInspect: (card: KnownHandCard) => void;
  /** Own seat only: the open search (one-tap chip). */
  search?: { by: HandBy; candidates: HandCandidate[]; onPick: (card: HandCandidate) => void; onOther: () => void; onDismiss: () => void };
  /** Own seat only: a camera read without a search (local suggestion). */
  suggest?: { card: HandSuggestion; onAdd: (source: HandSource) => void; onReveal: () => void; onDismiss: () => void };
  /** Webcam only: the strip is an overlay at the bottom of the feed. */
  overlay?: boolean;
};

/** Ids that arrived after the first render stay "fresh" for a short time (a pop and a highlight). */
function useFresh(cards: readonly KnownHandCard[]) {
  const seen = useRef<Set<string> | null>(null);
  const [fresh, setFresh] = useState<ReadonlySet<string>>(new Set());
  const key = cards.map(card => card.id).join("|");
  useEffect(() => {
    const now = new Set(cards.map(card => card.id));
    if (seen.current === null) { seen.current = now; return; }
    const added = [...now].filter(id => !seen.current!.has(id)); seen.current = now;
    if (!added.length) return;
    setFresh(old => new Set([...old, ...added]));
    const timer = setTimeout(() => setFresh(old => new Set([...old].filter(id => !added.includes(id)))), FRESH_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return fresh;
}

/** One tap adds the searched card. "Other…" opens the card search. Esc or the close button dismisses it. */
export function HandChip({ search }: { search: NonNullable<HandProps["search"]> }) {
  const shown = search.candidates.slice(0, 3);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape" && !event.defaultPrevented && !document.querySelector('[role="dialog"]')) search.onDismiss(); };
    window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey);
  }, [search]);
  return <div className={s.hchip} role="group" aria-live="polite" aria-label={`Add to hand, from ${search.by.name}`} data-testid="hand-chip">
    <span className={s.hchipl}>Add to hand</span>
    {shown.map(card => <button type="button" key={card.cardId} className={s.hchipb} onClick={() => search.onPick(card)} data-testid="hand-chip-card">{card.name}</button>)}
    <button type="button" className={`${s.hchipb} ${s.hchipo}`} onClick={search.onOther} data-testid="hand-chip-other">Other{"…"}</button>
    <button type="button" className={s.hchipx} onClick={search.onDismiss} aria-label="Dismiss add to hand" title="Dismiss (Esc)"><Icon name="x" /></button>
  </div>;
}

const SUGGEST_SOURCES: { source: HandSource; label: string }[] = [{ source: "deck", label: "Deck" }, { source: "gy", label: "Graveyard" }, { source: "banish", label: "Banished" }];

/** The camera saw a card in the hand and no effect explains it: the owner picks the source, shows it, or dismisses it. Nothing is sent before a choice. */
export function HandSuggestChip({ suggest }: { suggest: NonNullable<HandProps["suggest"]> }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape" && !event.defaultPrevented && !document.querySelector('[role="dialog"]')) suggest.onDismiss(); };
    window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey);
  }, [suggest]);
  return <div className={s.hchip} role="group" aria-live="polite" aria-label={`Add ${suggest.card.name} to hand?`} data-testid="hand-suggest">
    <span className={s.hchipl}>Add {suggest.card.name} to hand?</span>
    {SUGGEST_SOURCES.map(item => <button type="button" key={item.source} className={s.hchipb} onClick={() => suggest.onAdd(item.source)} data-testid={`hand-suggest-${item.source}`}>{item.label}</button>)}
    <button type="button" className={`${s.hchipb} ${s.hchipo}`} onClick={suggest.onReveal} data-testid="hand-suggest-reveal">Reveal</button>
    <button type="button" className={`${s.hchipb} ${s.hchipo}`} onClick={suggest.onDismiss} data-testid="hand-suggest-known">Already in hand</button>
    <button type="button" className={s.hchipx} onClick={suggest.onDismiss} aria-label="Dismiss suggestion" title="Dismiss (Esc)"><Icon name="x" /></button>
  </div>;
}

/** A quick look at a card of the strip: big art, name, where it came from. Hover or keyboard focus opens it; it never takes a click. */
function HandPreview({ card, box }: { card: KnownHandCard; box: DOMRect }) {
  const host = typeof document === "undefined" ? null : document.querySelector('[data-testid="remote-table"]');
  if (!host) return null;
  const width = 170; const left = Math.min(Math.max(8, box.left + box.width / 2 - width / 2), window.innerWidth - width - 8);
  const above = box.top > 300;
  return createPortal(<div className={s.hprev} style={{ left, width, ...(above ? { bottom: window.innerHeight - box.top + 8 } : { top: box.bottom + 8 }) }} data-testid="hand-preview" aria-hidden="true">
    <img src={cardArt(card.cardId, "full")} alt="" draggable={false} />
    <b>{card.name}</b><small>{sourceText(card)}</small>
  </div>, host);
}

/** "Revealed in hand": mini arts of the cards everybody knows are in this hand, and the hand count. */
export function HandStrip({ seat, name, hand }: { seat: number; name: string; hand: HandProps }) {
  const fresh = useFresh(hand.cards);
  const [look, setLook] = useState<{ card: KnownHandCard; box: DOMRect } | null>(null);
  const { count, onCount } = hand;
  // The webcam overlay stays out of the feed until there is something to show. Under the board the row is always there, so a card arriving does not move the camera.
  if (hand.overlay && !hand.cards.length && !hand.search && !hand.suggest) return null;
  return <div className={`${s.hstrip} ${hand.overlay ? s.hover : ""}`} role="region" aria-label={`${name}: revealed in hand`} data-testid={`hand-strip-${seat}`}>
    {hand.search ? <HandChip search={hand.search} /> : hand.suggest ? <HandSuggestChip suggest={hand.suggest} /> : null}
    <div className={s.handrow}>
      <span className={s.hlab}>Revealed in hand</span>
      <ul className={s.hcards} onWheel={event => { event.currentTarget.scrollLeft += event.deltaY; }}>
        {hand.cards.map(card => <li key={card.id} className={fresh.has(card.id) ? s.hfresh : undefined}>
          <button type="button" className={s.hcard} onClick={() => { setLook(null); hand.onInspect(card); }} onMouseEnter={event => setLook({ card, box: event.currentTarget.getBoundingClientRect() })} onMouseLeave={() => setLook(null)} onFocus={event => setLook({ card, box: event.currentTarget.getBoundingClientRect() })} onBlur={() => setLook(null)} data-testid="hand-card">
            <img src={cardArt(card.cardId, "small")} alt="" draggable={false} />
            <span><b>{card.name}</b><small>{sourceText(card)}</small></span>
          </button>
        </li>)}
        {!hand.cards.length ? <li className={s.hnone}>None</li> : null}
      </ul>
      {count !== undefined || onCount ? <span className={s.hcount} data-testid={`hand-count-${seat}`}>
        {onCount ? <button type="button" onClick={() => onCount(-1)} aria-label="Hand minus one" disabled={count === 0}>{"−"}</button> : null}
        <span>Hand: <b className={s.num}>{count ?? "?"}</b></span>
        {onCount ? <button type="button" onClick={() => onCount(1)} aria-label="Hand plus one">+</button> : null}
      </span> : null}
    </div>
    {look ? <HandPreview card={look.card} box={look.box} /> : null}
  </div>;
}
