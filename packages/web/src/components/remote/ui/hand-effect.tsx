"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { REMOTE_CHAIN_GAP_MS, type RemoteEvent } from "@yugidraft/shared/remote";
import { serverNow } from "./api";
import { cardArt, searchCards, type CardInfo } from "./catalog";
import s from "./hand-effect.module.css";

export type HandEffectCard = { cardId: number; name: string };
/** The top candidates get the keys 1 to 9. */
export const HAND_EFFECT_KEYS = 9;

/**
 * The hand effect row above the bottom bar: my likely hand traps as small cards with a key each, and a field for any other card.
 * A key or a click picks; Escape closes (the table handles the keys, the field handles its own Enter and Escape).
 */
export function HandEffectPicker({ candidates, onPick, onClose, style }: { candidates: readonly HandEffectCard[]; onPick: (card: HandEffectCard) => void; onClose: () => void; style?: CSSProperties }) {
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<{ query: string; list: CardInfo[] } | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const text = query.trim();
  // The field has the focus at once, so a number or a word works without a click. A phone keeps its keyboard closed until a tap.
  useEffect(() => { try { if (!window.matchMedia("(pointer: coarse)").matches) input.current?.focus(); } catch { input.current?.focus(); } }, []);
  useEffect(() => {
    if (text.length < 2) { setFound(null); return; }
    let live = true;
    const timer = setTimeout(() => { void searchCards(text).then(list => { if (live) setFound({ query: text, list: list.slice(0, 8) }); }).catch(() => { if (live) setFound({ query: text, list: [] }); }); }, 220);
    return () => { live = false; clearTimeout(timer); };
  }, [text]);
  const results = found && found.query === text ? found.list : null;
  const buttons = () => [...(list.current?.querySelectorAll<HTMLButtonElement>("button") ?? [])];
  return <div className={s.row} style={style} role="group" aria-label="Hand effect. Press a number to pick a card, or Escape to close" data-testid="hand-effect-picker">
    <div className={s.top}>
      <span className={s.head}>Hand effect</span>
      <input ref={input} className={s.search} type="text" inputMode="search" autoComplete="off" spellCheck={false} placeholder="Search any card…" aria-label="Search any card" value={query}
        onChange={event => setQuery(event.target.value)}
        onKeyDown={event => {
          if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(); }
          else if (event.key === "Enter" && results?.[0]) { event.preventDefault(); onPick({ cardId: results[0].id, name: results[0].name }); }
          // With an empty field the number keys pick, as they do outside it.
          else if (!query && /^[1-9]$/.test(event.key) && candidates[Number(event.key) - 1] && Number(event.key) <= HAND_EFFECT_KEYS) { event.preventDefault(); onPick(candidates[Number(event.key) - 1]); }
          else if (event.key === "ArrowDown") { const first = buttons()[0]; if (first) { event.preventDefault(); first.focus(); } }
        }} />
      <button type="button" className={s.close} onClick={onClose} aria-label="Close hand effect">Esc</button>
    </div>
    <div ref={list} onKeyDown={event => {
      const all = buttons(), at = all.indexOf(document.activeElement as HTMLButtonElement);
      if (at < 0) return;
      const next = event.key === "ArrowDown" || event.key === "ArrowRight" ? all[at + 1] : event.key === "ArrowUp" || event.key === "ArrowLeft" ? (at === 0 ? input.current : all[at - 1]) : undefined;
      if (next) { event.preventDefault(); next.focus(); }
    }}>
    {text.length >= 2 ? <ul className={s.results} aria-label="Search results" data-testid="hand-effect-results">
      {results === null ? <li className={s.note}>Searching…</li> : results.length ? results.map(card => <li key={card.id}>
        <button type="button" className={s.pick} onClick={() => onPick({ cardId: card.id, name: card.name })}><img src={cardArt(card.id, "small")} alt="" draggable={false} loading="lazy" /><span>{card.name}</span></button>
      </li>) : <li className={s.note}>No card found</li>}
    </ul> : candidates.length ? <ol className={s.cands}>{candidates.slice(0, HAND_EFFECT_KEYS).map((card, index) => <li key={card.cardId}>
      <button type="button" className={s.pick} onClick={() => onPick(card)} data-testid="hand-effect-card">
        <img src={cardArt(card.cardId, "small")} alt="" draggable={false} />
        <span>{card.name}</span>
        <kbd>{index + 1}</kbd>
      </button>
    </li>)}</ol> : <p className={s.note} data-testid="hand-effect-empty">No hand traps in your deck list — search a card</p>}
    </div>
  </div>;
}

/**
 * Shows while an opponent's activation can still be answered: who, which card, which chain link, and a ring that runs down to the
 * end of the answer window. A click opens the hand effect row. It goes away when the window ends or the chain resolves.
 */
export function RespondChip({ event, n, who, card, onClick, style }: { event: RemoteEvent; n: number; who: string; card: string; onClick: () => void; style?: CSSProperties }) {
  // The ring starts where the window already is (a reconnect) and then runs on its own: a re-render never restarts it.
  const [elapsed] = useState(() => Math.min(REMOTE_CHAIN_GAP_MS, Math.max(0, serverNow() - event.at)));
  const expires = event.at + REMOTE_CHAIN_GAP_MS;
  const secondsLeft = () => Math.max(0, Math.ceil((expires - serverNow()) / 1000));
  const [left, setLeft] = useState(secondsLeft);
  useEffect(() => { const timer = setInterval(() => setLeft(secondsLeft()), 500); return () => clearInterval(timer); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expires]);
  return <button type="button" className={s.respond} style={style} onClick={onClick} data-testid="respond-chip" title="Respond with a card from your hand (H). Field cards: hover and press E"
    aria-label={`Respond to ${who}'s ${card} (Chain ${n}), ${left} seconds left. Opens the hand effect row`}>
    <svg className={s.ring} viewBox="0 0 20 20" aria-hidden="true">
      <circle className={s.ringBg} cx="10" cy="10" r="8" />
      <circle className={s.ringFg} cx="10" cy="10" r="8" pathLength="100" style={{ animationDuration: `${REMOTE_CHAIN_GAP_MS}ms`, animationDelay: `-${elapsed}ms` }} />
    </svg>
    <span className={s.rsec} data-testid="respond-seconds">{left}s</span>
    <span className={s.rtext}><span className={s.rlead}>Respond to</span>{" "}<b className={s.rname}>{who}&apos;s {card}</b></span>{" "}
    <span className={s.rchain}>(Chain {n})</span>
    <kbd>H</kbd>
  </button>;
}
