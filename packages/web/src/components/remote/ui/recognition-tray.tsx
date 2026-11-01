"use client";

import { useEffect, useRef, useState } from "react";
import { cardArt, cardInfo, searchCards, loadCards } from "./catalog";
import { Icon } from "./icons";
import { BigArt, CardText, PopupFrame, TierChip, type PopAt, type Tier } from "./popup";
import type { Guess } from "./recognizer";
import { useVideoHub } from "./video-hub";
import s from "./remote-ui.module.css";

export type TrayState = {
  seat: number; ownerName: string; status: "reading" | "guesses" | "empty" | "sure";
  guesses: Guess[]; note: string; reader: string; at: PopAt;
  /** How sure the local reader was, and the kept crop for an optional AI second opinion (own camera reads only). */
  tier?: Tier; aiToken?: number; covered?: boolean;
};
import type { FeedbackSource } from "./recognizer";
/** `feedback` names how a person chose this card; set only for an explicit choice, so it can be saved as a training sample. */
export type Pick = { cardId: number; name: string; via: "click" | "typed" | "voice"; feedback?: FeedbackSource };

/**
 * The popup for a card that was just clicked on a feed. It opens at once with a skeleton, then shows the large card,
 * its full text and tier. When the reader is not sure, a slim strip of the top 5 guesses lets the person choose:
 * keys 1-5 pick, arrows move the preview, Enter picks the previewed card, typing searches the whole catalog.
 */
export function RecognitionTray({ tray, inDeck, onPick, onClose, onSay, saying, aiAllowed }: {
  tray: TrayState; aiAllowed: boolean; inDeck: (cardId: number) => boolean | null; onPick: (pick: Pick) => void; onClose: () => void; onSay: () => void; saying: boolean;
}) {
  const [query, setQuery] = useState(""); const [found, setFound] = useState<Guess[] | null>(null); const [, tick] = useState(0);
  const [cursor, setCursor] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const hub = useVideoHub();
  const [ai, setAi] = useState<{ status: "idle" | "asking" | "done" | "none" | "off" | "error"; guess?: Guess; note?: string }>({ status: "idle" });
  const canAsk = aiAllowed && tray.status === "guesses" && tray.aiToken !== undefined && tray.tier !== "sure" && ai.status !== "off" && ai.status !== "done";
  async function askAi() {
    if (tray.aiToken === undefined) return;
    setAi({ status: "asking" });
    const answer = await hub.askAi(tray.aiToken);
    if (answer.status === "ok") { await loadCards([answer.guess.cardId]); setAi({ status: "done", guess: answer.guess }); setCursor(0); }
    else setAi({ status: answer.status, note: answer.note });
  }
  const guessKey = tray.guesses.map(g => g.cardId).join(",");
  useEffect(() => { void loadCards(tray.guesses.map(g => g.cardId)).then(() => tick(n => n + 1)); setCursor(0); }, [guessKey, tray.guesses]);
  useEffect(() => {
    const text = query.trim(); if (text.length < 2) { setFound(null); return; }
    let live = true; const timer = setTimeout(() => {
      void searchCards(text).then(list => { if (live) { setFound(list.map(card => ({ cardId: card.id, name: card.name, score: null }))); setCursor(0); } });
    }, 220);
    return () => { live = false; clearTimeout(timer); };
  }, [query]);

  const base = ai.guess ? [ai.guess, ...tray.guesses.filter(g => g.cardId !== ai.guess?.cardId)].slice(0, 5) : tray.guesses;
  const list = found ?? base;
  const nameOf = (g: Guess) => g.name || cardInfo(g.cardId)?.name || `Card ${g.cardId}`;
  const choose = (g: Guess, via: Pick["via"]) => onPick({ cardId: g.cardId, name: nameOf(g), via, feedback: g.source === "ai" ? "ai" : found ? "search" : "pick" });
  const reading = tray.status === "reading";
  const placing = tray.status === "sure";
  const current = list[Math.min(cursor, list.length - 1)];
  const strip = !reading && !placing && (found !== null || tray.status === "empty" || tray.tier !== "sure" || !!tray.covered);
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.target === input.current || event.ctrlKey || event.metaKey || event.altKey || reading || placing) return;
      const target = event.target as HTMLElement | null;
      const n = Number(event.key);
      if (n >= 1 && n <= 5 && list[n - 1]) { event.preventDefault(); choose(list[n - 1], found ? "typed" : "click"); }
      else if (event.key === "ArrowRight" || event.key === "ArrowDown") { event.preventDefault(); setCursor(c => Math.min(list.length - 1, c + 1)); }
      else if (event.key === "ArrowLeft" || event.key === "ArrowUp") { event.preventDefault(); setCursor(c => Math.max(0, c - 1)); }
      else if (event.key === "Enter" && current && !target?.closest("li,button")) { event.preventDefault(); choose(current, found ? "typed" : "click"); }
    }
    document.addEventListener("keydown", onKey); return () => document.removeEventListener("keydown", onKey);
  });

  const ownerLine = `${tray.ownerName}'s field cam`;
  const info = current ? cardInfo(current.cardId) : undefined;
  const label = reading ? "Reading card" : placing ? "Card found" : "Which card is this?";
  return <PopupFrame at={tray.at} layer="tray" label={label} busy={reading || placing} testid="recognition-tray" className={s.bigTray}>
    <button type="button" className={`${s.ibtn} ${s.bclose}`} aria-label="Close without choosing" onClick={onClose}><Icon name="x" /></button>
    <BigArt id={reading || !current ? null : current.cardId} reading={reading} label={reading ? undefined : "No card to show"} />
    <div className={s.bmain}>
      {reading ? <div className={s.bsk} role="status" data-testid="popup-reading">
        <b className={s.skbig}>Reading card…</b><i className={s.skline} style={{ width: "58%" }} /><i className={s.skline} style={{ width: "84%" }} />
        <i className={s.skline} /><i className={s.skline} style={{ width: "92%" }} /><i className={s.skline} style={{ width: "46%" }} />
        <small>Looking at the sharpest frame of {ownerLine}</small>
      </div> : current ? <>
        <CardText info={info} name={nameOf(current)} fallbackName={`Card ${current.cardId}`}>
          <div className={s.bchips}>
            {found ? <span className={s.tier}>Search result</span> : placing || current === list[0] ? <TierChip tier={tray.tier} /> : null}
            {tray.covered ? <span className={`${s.tier} ${s.tierLow}`}>Covered</span> : null}
            {current.source === "ai" ? <span className={s.tier}>AI second opinion</span> : null}
            {inDeck(current.cardId) === false ? <span className={`${s.cb} ${s.w}`}><Icon name="warn" />NOT IN DECKLIST</span> : null}
          </div>
        </CardText>
      </> : <div className={s.bsk}><b className={s.skbig}>No match</b><p className={s.bdetails}>{tray.note || "Search for the card below or say its name."}</p></div>}
      {strip ? <ul className={s.bstrip} role="listbox" aria-label="Top 5 guesses">
        {list.length === 0 ? <li className={s.noGuess} role="presentation">No guesses. Type the name below.</li> : list.map((g, i) =>
          <li key={g.cardId} role="option" aria-selected={i === cursor} tabIndex={0} data-testid="guess" data-on={i === cursor} aria-label={`${i + 1}. ${nameOf(g)}${g.score === null ? "" : `, ${Math.round(g.score * 100)} percent`}`}
            onMouseEnter={() => setCursor(i)} onFocus={() => setCursor(i)} onClick={() => choose(g, found ? "typed" : "click")}
            onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.stopPropagation(); choose(g, found ? "typed" : "click"); } }}>
            <img src={cardArt(g.cardId, "small")} alt="" loading="lazy" onError={event => { event.currentTarget.style.visibility = "hidden"; }} />
            <kbd>{i + 1}</kbd>
            <em>{g.score === null ? "–" : `${Math.round(g.score * 100)}%`}</em>
          </li>)}
      </ul> : null}
      {strip || tray.status === "empty" ? <div className={s.srch}><Icon name="search" /><input ref={input} type="text" placeholder="Not it? Search any card" aria-label="Search any card" autoComplete="off" value={query}
        onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === "Enter" && list[0]) { event.preventDefault(); choose(list[Math.min(cursor, list.length - 1)], found ? "typed" : "click"); } }} /></div> : null}
      {ai.note ? <p className={s.bnote} role="status" data-testid="ask-ai-note">{ai.status === "off" ? "AI second opinion is not available for this account." : ai.note}</p> : null}
    </div>
    <div className={s.bbar}>
      <span className={s.bhint}>{reading ? <>Press <kbd>Esc</kbd> to cancel</> : placing ? "Placing on the field…" : <><kbd>1</kbd>–<kbd>5</kbd> pick · <kbd>←</kbd><kbd>→</kbd> preview · <kbd>Enter</kbd> confirm · <kbd>Esc</kbd></>}</span>
      <span className={s.sp} />
      {canAsk ? <span data-testid="ask-ai-row"><button type="button" className={`${s.btn} ${s.sm} ${s.q}`} onClick={() => void askAi()} disabled={ai.status === "asking"} data-testid="ask-ai">{ai.status === "asking" ? "Asking the AI…" : "Ask AI"}</button></span> : null}
      {!reading && !placing ? <button type="button" className={`${s.btn} ${s.sm} ${s.q}`} aria-pressed={saying} onClick={onSay}><Icon name="mic" />{saying ? "Listening…" : "Say the name"}</button> : null}
      {!reading && !placing && current ? <button type="button" className={`${s.btn} ${s.sm} ${s.go}`} onClick={() => choose(current, found ? "typed" : "click")} data-testid="confirm-card"><Icon name="check" />This is it</button> : null}
    </div>
  </PopupFrame>;
}
