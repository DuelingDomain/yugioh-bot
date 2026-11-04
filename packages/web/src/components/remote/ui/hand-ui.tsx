"use client";

import { useEffect, useRef, useState } from "react";
import { cardArt } from "./catalog";
import { Icon } from "./icons";
import { sourceText, type HandCandidate, type KnownHandCard } from "./reveal-model";
import s from "./remote-ui.module.css";

const FRESH_MS = 2600;

export type HandProps = {
  cards: KnownHandCard[]; count?: number;
  /** Only the owner seat changes the count. */
  onCount?: (count: number) => void;
  onInspect: (card: KnownHandCard) => void;
  /** Own seat only: the open search (one-tap chip). */
  search?: { by: string; candidates: HandCandidate[]; onPick: (card: HandCandidate) => void; onOther: () => void; onDismiss: () => void };
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
  return <div className={s.hchip} role="group" aria-label={`Add to hand, from ${search.by}`} data-testid="hand-chip">
    <span className={s.hchipl}>Add to hand</span>
    {shown.map(card => <button type="button" key={card.cardId} className={s.hchipb} onClick={() => search.onPick(card)} data-testid="hand-chip-card">{card.name}</button>)}
    <button type="button" className={`${s.hchipb} ${s.hchipo}`} onClick={search.onOther} data-testid="hand-chip-other">Other{"…"}</button>
    <button type="button" className={s.hchipx} onClick={search.onDismiss} aria-label="Dismiss add to hand" title="Dismiss (Esc)"><Icon name="x" /></button>
  </div>;
}

/** "Revealed in hand": mini arts of the cards everybody knows are in this hand, and the hand count. */
export function HandStrip({ seat, name, hand }: { seat: number; name: string; hand: HandProps }) {
  const fresh = useFresh(hand.cards);
  const { count, onCount } = hand;
  if (!hand.cards.length && count === undefined && !hand.search) return null;
  return <div className={`${s.hstrip} ${hand.overlay ? s.hover : ""}`} aria-label={`${name}: revealed in hand`} data-testid={`hand-strip-${seat}`}>
    {hand.search ? <HandChip search={hand.search} /> : null}
    <div className={s.hrow}>
      <span className={s.hlab}>Revealed in hand</span>
      <ul className={s.hcards}>
        {hand.cards.map(card => <li key={card.id} className={fresh.has(card.id) ? s.hfresh : undefined}>
          <button type="button" className={s.hcard} onClick={() => hand.onInspect(card)} title={`${card.name} · ${sourceText(card)}`} data-testid="hand-card">
            <img src={cardArt(card.cardId, "small")} alt="" draggable={false} />
            <span><b>{card.name}</b><small>{sourceText(card)}</small></span>
          </button>
        </li>)}
        {!hand.cards.length ? <li className={s.hnone}>None</li> : null}
      </ul>
      {count !== undefined || onCount ? <span className={s.hcount} data-testid={`hand-count-${seat}`}>
        {onCount ? <button type="button" onClick={() => onCount(Math.max(0, (count ?? 0) - 1))} aria-label="Hand minus one" disabled={!count}>{"−"}</button> : null}
        <span>Hand: <b className={s.num}>{count ?? "?"}</b></span>
        {onCount ? <button type="button" onClick={() => onCount((count ?? 0) + 1)} aria-label="Hand plus one">+</button> : null}
      </span> : null}
    </div>
  </div>;
}
