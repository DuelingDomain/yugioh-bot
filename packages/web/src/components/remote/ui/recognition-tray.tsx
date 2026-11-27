"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { cardArt, cardInfo, searchCards, loadCards } from "./catalog";
import { Icon } from "./icons";
import { BigArt, CardText, PopupFrame, TierChip, type PopAt, type Tier } from "./popup";
import type { Guess } from "./recognizer";
import { useVideoHub } from "./video-hub";
import s from "./remote-ui.module.css";

export type TrayState = {
  seat: number; ownerName: string; status: "guesses" | "empty";
  guesses: Guess[]; note: string; reader: string; at: PopAt;
  /** How sure the local reader was, and the kept crop for an optional AI second opinion (own camera reads only). */
  tier?: Tier; aiToken?: number; covered?: boolean; faceDown?: boolean;
  /** The top guess is shown alone as "Best match". "Wrong card?" opens the choices and search. */
  best?: boolean;
  /** An explicit correction always exposes the candidate list and search. */
  correction?: boolean;
  /** "hand": the chosen card is added to the hand, not placed on the board. */
  /** The card this read just added to the board. "Wrong card?" can take it off again. */
  placedRef?: string;
  intent?: "hand"; originId?: string; source?: "deck" | "gy" | "banish"; by?: { cardId: number; name: string };
};
import type { FeedbackSource } from "./recognizer";
/** `feedback` names how a person chose this card; set only for an explicit choice, so it can be saved as a training sample. */
export type Pick = { cardId: number; name: string; via: "click" | "typed" | "voice"; feedback?: FeedbackSource };

/**
 * The popup for a card that was clicked on a feed and needs a choice. It opens only after the read ends, and shows the large card,
 * its full text and tier. When the reader is not sure, a slim strip of the top 5 guesses lets the person choose:
 * keys 1-5 pick, arrows move the preview, Enter picks the previewed card, typing searches the whole catalog.
 */
export function RecognitionTray({ tray, deckIds, inDeck, onPick, onClose, onRemovePlaced, onSay, saying, aiAllowed, dock }: {
  onRemovePlaced?: (ref: string) => void; dock?: HTMLElement | null; tray: TrayState; aiAllowed: boolean; inDeck: (cardId: number) => boolean | null; onPick: (pick: Pick) => void; onClose: () => void; onSay?: () => void; saying: boolean;
  deckIds: number[];
}) {
  const [query, setQuery] = useState(""); const [search, setSearch] = useState<{ query: string; guesses: Guess[] } | null>(null); const [, tick] = useState(0);
  const [cursor, setCursor] = useState<number | null>(null); const [wrong, setWrong] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const stripRef = useRef<HTMLUListElement>(null);
  /** A touch screen has no hardware keys, so the search field must not take focus (it would open the keyboard over the choices). */
  const [coarse] = useState(() => typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches);
  const [edges, setEdges] = useState({ l: false, r: false });
  const hub = useVideoHub();
  const [ai, setAi] = useState<{ status: "idle" | "asking" | "done" | "none" | "off" | "error"; guess?: Guess; note?: string }>({ status: "idle" });
  const canAsk = aiAllowed && tray.status === "guesses" && tray.aiToken !== undefined && tray.tier !== "sure" && ai.status !== "off" && ai.status !== "done";
  async function askAi() {
    if (tray.aiToken === undefined) return;
    setAi({ status: "asking" });
    const answer = await hub.askAi(tray.aiToken);
    if (answer.status === "ok") { await loadCards([answer.guess.cardId]); setAi({ status: "done", guess: answer.guess }); setCursor(null); }
    else setAi({ status: answer.status, note: answer.note });
  }
  const guessKey = tray.guesses.map(g => g.cardId).join(",");
  useEffect(() => { void loadCards(tray.guesses.map(g => g.cardId)).then(() => tick(n => n + 1)); setCursor(null); setWrong(false); }, [guessKey, tray.guesses]);
  useEffect(() => {
    const text = query.trim(); if (text.length < 2) return;
    let live = true; const timer = setTimeout(() => {
      void searchCards(text).then(list => { if (live) { setSearch({ query: text, guesses: list.map(card => ({ cardId: card.id, name: card.name, score: null })) }); setCursor(null); } });
    }, 220);
    return () => { live = false; clearTimeout(timer); };
  }, [query]);

  const found = search && search.query === query.trim() ? search.guesses : null;
  const base = ai.guess ? [ai.guess, ...tray.guesses.filter(g => g.cardId !== ai.guess?.cardId)] : tray.guesses;
  const deckFirst = tray.correction || wrong;
  let list = found ?? base.slice(0, 5);
  let guessedInDeck = 0;
  if (!found && deckFirst) {
    const deck = new Set(deckIds);
    const guesses = new Map(base.map(g => [g.cardId, g]));
    const deckGuesses = [...guesses.keys()].filter(id => deck.has(id));
    guessedInDeck = deckGuesses.length;
    const ordered = new Set([...deckGuesses, ...deckIds, ...guesses.keys()]);
    list = [...ordered].map(cardId => guesses.get(cardId) ?? { cardId, name: "", score: null });
  }
  const deckKey = deckIds.join(",");
  useEffect(() => {
    if (!deckFirst || !deckKey) return;
    let live = true;
    void loadCards(deckKey.split(",").map(Number), { preload: true }).then(() => { if (live) tick(n => n + 1); });
    return () => { live = false; };
  }, [deckFirst, deckKey]);
  const nameOf = (g: Guess) => g.name || cardInfo(g.cardId)?.name || `Card ${g.cardId}`;
  const choose = (g: Guess, via: Pick["via"]) => onPick({ cardId: g.cardId, name: nameOf(g), via, feedback: g.source === "ai" ? "ai" : found ? "search" : "pick" });
  const startsSelected = found !== null || !deckFirst || !!base[0] && inDeck(base[0].cardId) === true;
  const selected = Math.min(cursor ?? (startsSelected ? 0 : -1), list.length - 1);
  const current = list[selected];
  /** The reader's best guess is not in the decklist: nothing is chosen until the player picks, so say why. */
  const offDeckTop = deckFirst && !!base[0] && inDeck(base[0].cardId) === false;
  const waiting = !current && deckFirst && list.length > 0;
  const showArt = !!current || waiting;
  const alone = !!tray.best && !deckFirst && found === null;
  const strip = !alone && (deckFirst || found !== null || tray.status === "empty" || tray.tier !== "sure" || !!tray.covered);
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.target === input.current || event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest('input,textarea,select,[contenteditable="true"]')) return;
      const n = Number(event.key);
      if (n >= 1 && n <= 5 && strip && list[n - 1]) { event.preventDefault(); choose(list[n - 1], found ? "typed" : "click"); }
      else if (!strip) return;
      else if (["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp"].includes(event.key) && list.length) {
        event.preventDefault();
        const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : -1;
        const next = Math.max(0, Math.min(list.length - 1, selected + step));
        setCursor(next);
        const option = stripRef.current?.querySelector<HTMLElement>(`[data-i="${next}"]`) ?? undefined;
        if (target?.closest('[role="option"]')) option?.focus({ preventScroll: true });
        option?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
      }
      else if (event.key === "Enter" && current && !target?.closest("li,button")) { event.preventDefault(); choose(current, found ? "typed" : "click"); }
    }
    document.addEventListener("keydown", onKey); return () => document.removeEventListener("keydown", onKey);
  });

  useEffect(() => {
    const el = stripRef.current; if (!el) return;
    const update = () => { const l = el.scrollLeft > 4, r = el.scrollWidth - el.clientWidth - el.scrollLeft > 4; setEdges(old => old.l === l && old.r === r ? old : { l, r }); };
    update(); el.addEventListener("scroll", update, { passive: true });
    return () => el.removeEventListener("scroll", update);
  }, [list.length, strip]);

  const info = current ? cardInfo(current.cardId) : undefined;
  const searchHint = `Search for the card below${onSay ? " or say its name" : ""}.`;
  const askName = offDeckTop && cursor === null && !found ? `The reader thinks this is ${nameOf(base[0]!)}, but that card is not in your deck list. Pick the right card below or search.` : "";
  // The reader's own debug text ("Sharpest of 5 frames") is for the plain popup only; the correction tray never shows it.
  const note = tray.faceDown ? `The reader sees a card back. ${searchHint}` : deckFirst ? askName || (!list.length ? searchHint : "") : tray.note || (!list.length ? searchHint : "");
  return <PopupFrame dock={dock} at={tray.at} layer="tray" label="Which card is this?" testid="recognition-tray" className={`${s.bigTray} ${showArt ? "" : s.noArt}`}>
    <button type="button" className={`${s.ibtn} ${s.bclose}`} aria-label="Close without choosing" onClick={onClose}><Icon name="x" /></button>
    {current ? <BigArt id={current.cardId} /> : waiting ? <div className={`${s.bigart} ${s.bigartEmpty}`} aria-hidden="true" data-testid="art-slot"><b>?</b></div> : null}
    <div className={s.bmain}>
      {current ? <>
        <CardText id={current.cardId} info={info} name={nameOf(current)} fallbackName={`Card ${current.cardId}`}>
          <div className={s.bchips}>
            {found ? <span className={s.tier}>Search result</span> : alone ? <span className={s.tier} data-testid="best-match">Best match</span> : current.cardId === tray.guesses[0]?.cardId ? <TierChip tier={tray.tier} /> : null}
            {tray.covered ? <span className={`${s.tier} ${s.tierLow}`}>Covered</span> : null}
            {current.source === "ai" ? <span className={s.tier}>AI second opinion</span> : null}
            {inDeck(current.cardId) === false ? <span className={`${s.cb} ${s.w}`}><Icon name="warn" />NOT IN DECKLIST</span> : null}
          </div>
        </CardText>
      </> : <div className={`${s.bsk} ${waiting ? s.askFill : ""}`}><b className={s.skbig}>{tray.faceDown ? "Face-down card" : askName ? "Which card is this?" : list.length ? "Choose a card" : "No match"}</b>{note ? <p className={s.bdetails}>{note}</p> : null}</div>}
      {strip && deckFirst && !found && list.length > 0 ? <div className={s.stripCap}>{guessedInDeck > 0 ? <span>Reader guesses</span> : null}<span>Your deck ({deckIds.length})</span></div> : null}
      {strip ? <ul ref={stripRef} className={`${s.bstrip} ${deckFirst ? s.deckStrip : ""}`} data-l={edges.l || undefined} data-r={edges.r || undefined} tabIndex={coarse && !startsSelected ? -1 : undefined} data-autofocus={coarse && !startsSelected ? "" : undefined} role="listbox" aria-label={found ? "Search results" : deckFirst ? "Card choices" : "Top 5 guesses"}>
        {list.length === 0 ? <li className={s.noGuess} role="presentation">No guesses. Type the name below.</li> : list.map((g, i) => <Fragment key={g.cardId}>
          {deckFirst && !found && i === guessedInDeck && guessedInDeck > 0 ? <li className={s.deckDiv} role="presentation" aria-hidden="true" /> : null}
          <li data-i={i} role="option" aria-selected={i === selected} tabIndex={0} data-testid="guess" data-on={i === selected} aria-label={`${i + 1}. ${nameOf(g)}${g.score === null ? "" : `, ${Math.round(g.score * 100)} percent`}`}
            onMouseEnter={() => setCursor(i)} onFocus={() => setCursor(i)} onClick={() => choose(g, found ? "typed" : "click")}
            onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.stopPropagation(); choose(g, found ? "typed" : "click"); } }}>
            <img src={cardArt(g.cardId, "small")} alt="" loading="lazy" onError={event => { event.currentTarget.style.visibility = "hidden"; }} />
            {i < 5 ? <kbd>{i + 1}</kbd> : null}
            <em>{g.score === null ? "–" : `${Math.round(g.score * 100)}%`}</em>
          </li></Fragment>)}
      </ul> : null}
      {strip || tray.status === "empty" ? <div className={s.srch}><Icon name="search" /><input ref={input} type="text" placeholder="Not it? Search any card" aria-label="Search any card" autoComplete="off" value={query} data-autofocus={!startsSelected && !coarse ? "" : undefined}
        onChange={event => { setQuery(event.target.value); setCursor(null); }} onKeyDown={event => { if (event.key === "Enter" && found && current) { event.preventDefault(); choose(current, "typed"); } }} /></div> : null}
      {ai.note ? <p className={s.bnote} role="status" data-testid="ask-ai-note">{ai.status === "off" ? "AI second opinion is not available for this account." : ai.note}</p> : null}
    </div>
    <div className={s.bbar}>
      <span className={s.bhint}>{!current && !found ? <>Pick a card or search · <kbd>Esc</kbd></> : alone ? <><kbd>Enter</kbd> confirm · <kbd>Esc</kbd></> : <><kbd>1</kbd>–<kbd>5</kbd> pick · <kbd>←</kbd><kbd>→</kbd> preview · <kbd>Enter</kbd> confirm · <kbd>Esc</kbd></>}</span>
      <span className={s.sp} />
      {canAsk ? <span data-testid="ask-ai-row"><button type="button" className={`${s.btn} ${s.sm} ${s.q}`} onClick={() => void askAi()} disabled={ai.status === "asking"} data-testid="ask-ai">{ai.status === "asking" ? "Asking the AI…" : "Ask AI"}</button></span> : null}
      {alone ? <button type="button" className={`${s.btn} ${s.sm} ${s.q}`} onClick={() => { setWrong(true); setCursor(null); }} data-testid="wrong-card">Wrong card?</button> : null}
      {tray.placedRef && onRemovePlaced ? <button type="button" className={`${s.btn} ${s.sm} ${s.q}`} onClick={() => onRemovePlaced(tray.placedRef!)} data-testid="remove-placed">Remove card</button> : null}
      {onSay ? <button type="button" className={`${s.btn} ${s.sm} ${s.q}`} aria-pressed={saying} onClick={onSay}><Icon name="mic" />{saying ? "Listening…" : "Say the name"}</button> : null}
      {current || deckFirst && list.length > 0 ? <button type="button" className={`${s.btn} ${s.sm} ${s.go}`} disabled={!current} onClick={() => { if (current) choose(current, found ? "typed" : "click"); }} data-testid="confirm-card"><Icon name="check" />This is it</button> : null}
    </div>
  </PopupFrame>;
}
