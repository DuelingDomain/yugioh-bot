"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { cardArt, cardInfo, isMonsterInfo, searchCards, loadCards } from "./catalog";
import { Icon } from "./icons";
import type { Guess } from "./recognizer";
import s from "./remote-ui.module.css";

export type TrayState = {
  seat: number; ownerName: string; status: "reading" | "guesses" | "empty";
  guesses: Guess[]; note: string; reader: string; style: CSSProperties;
};
export type Pick = { cardId: number; name: string; via: "click" | "typed" | "voice" };

/** The "Which card is this?" tray. Keys 1-5 pick, Enter picks the top guess, typing searches the whole catalog. */
export function RecognitionTray({ tray, inDeck, onPick, onClose, onSay, saying }: {
  tray: TrayState; inDeck: (cardId: number) => boolean | null; onPick: (pick: Pick) => void; onClose: () => void; onSay: () => void; saying: boolean;
}) {
  const [query, setQuery] = useState(""); const [found, setFound] = useState<Guess[] | null>(null); const [, tick] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const guessKey = tray.guesses.map(g => g.cardId).join(",");
  useEffect(() => { void loadCards(tray.guesses.map(g => g.cardId)).then(() => tick(n => n + 1)); }, [guessKey, tray.guesses]);
  useEffect(() => {
    const text = query.trim(); if (text.length < 2) { setFound(null); return; }
    let live = true; const timer = setTimeout(() => {
      void searchCards(text).then(list => { if (live) setFound(list.map(card => ({ cardId: card.id, name: card.name, score: null }))); });
    }, 220);
    return () => { live = false; clearTimeout(timer); };
  }, [query]);

  const list = found ?? tray.guesses;
  const nameOf = (g: Guess) => g.name || cardInfo(g.cardId)?.name || `Card ${g.cardId}`;
  const choose = (g: Guess, via: Pick["via"]) => onPick({ cardId: g.cardId, name: nameOf(g), via });
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.target === input.current) return;
      const n = Number(event.key);
      if (n >= 1 && n <= 5 && list[n - 1] && !event.ctrlKey && !event.metaKey && !event.altKey) { event.preventDefault(); choose(list[n - 1], "click"); }
      else if (event.key === "Enter" && list[0] && document.activeElement?.closest("[data-layer=tray]")?.tagName !== "LI") { event.preventDefault(); choose(list[0], "click"); }
    }
    document.addEventListener("keydown", onKey); return () => document.removeEventListener("keydown", onKey);
  });

  const reading = tray.status === "reading";
  return <div className={`${s.pop} ${s.tray} ${s.show}`} data-layer="tray" role="dialog" aria-label="Identify card" aria-busy={reading} style={tray.style} data-testid="recognition-tray">
    <div className={s.th}>
      <div className={s.thumb} aria-hidden="true"><Icon name="cam" /></div>
      <div><h2>{reading ? "Reading the card…" : "Which card is this?"}</h2>
        <small>Source <b>{tray.ownerName}&apos;s field cam</b> · {tray.note || "priors: decklist and cards already on the table"}</small></div>
      <button type="button" className={s.ibtn} aria-label="Close without choosing" onClick={onClose}><Icon name="x" /></button>
    </div>
    {reading ? <p className={s.hint} role="status">Looking at the sharpest frames…</p> : <ul className={s.gl} role="listbox" aria-label="Top 5 guesses">
      {list.length === 0 ? <li className={s.noGuess}>No guesses. Type the name below.</li> : list.map((g, i) => {
        const info = cardInfo(g.cardId); const deck = inDeck(g.cardId);
        return <li key={g.cardId} role="option" aria-selected={i === 0} tabIndex={0} data-testid="guess" onClick={() => choose(g, found ? "typed" : "click")}
          onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.stopPropagation(); choose(g, found ? "typed" : "click"); } }}>
          <kbd>{i + 1}</kbd>
          <span className={s.th34}><img className={s.artImg} src={cardArt(g.cardId, "small")} alt="" loading="lazy" onError={event => { event.currentTarget.style.display = "none"; }} /></span>
          <span><b className={s.gn}>{nameOf(g)}</b>
            <span className={s.gs}>{found ? "Search result" : g.score === null ? "From your decklist" : "Art match"}{isMonsterInfo(info) ? <> · ATK <span className={s.atk}>{info?.atk}</span></> : null}
              {deck === false ? <span className={`${s.why} ${s.w}`}>NOT IN DECKLIST</span> : null}</span></span>
          <span className={s.cf}>{g.score === null ? <em>–</em> : <><em>{Math.round(g.score * 100)}%</em><i><s style={{ width: `${Math.round(g.score * 100)}%` }} /></i></>}</span>
        </li>;
      })}
    </ul>}
    <div className={s.srch}><Icon name="search" /><input ref={input} type="text" placeholder="Type to search any card" aria-label="Search any card" autoComplete="off" value={query}
      onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === "Enter" && list[0]) { event.preventDefault(); choose(list[0], found ? "typed" : "click"); } }} /></div>
    <div className={s.hint}><span><kbd>1</kbd>–<kbd>5</kbd> pick · <kbd>Enter</kbd> top guess · <kbd>Esc</kbd> close</span><span className={s.sp} />
      <button type="button" className={`${s.btn} ${s.sm} ${s.q}`} aria-pressed={saying} onClick={onSay}><Icon name="mic" />{saying ? "Listening…" : "Say the name"}</button></div>
  </div>;
}
