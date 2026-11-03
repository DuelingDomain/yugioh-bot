"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { DuelDeck } from "@yugidraft/shared/duels";
import type { RemoteActionProposal, RemoteRoom } from "@yugidraft/shared/remote";
import { formatLp } from "@/components/duel/constants";
import { duelFontClasses } from "@/components/duel/fonts";
import { ResultTitle } from "@/components/duel/duel-result";
import { Section, Tile, type Tag } from "@/components/duel/between-games";
import { useDeckCardMeta } from "@/components/duel/deck-card-types";
import { DeckCardPreview } from "@/components/duel/deck-card-preview";
import { cx, sheetRoot, SheetButton } from "@/components/duel/sheet-ui";
import ui from "@/components/duel/sheet-ui.module.css";
import resultStyles from "@/components/duel/duel-result.module.css";
import betweenStyles from "@/components/duel/between-games.module.css";
import seriesStyles from "@/components/duel/series.module.css";
import {
  hasMarks, isExtraDeckType, isMarkedIn, isMarkedOut, NO_MARKS, planSideDeck, toggleIn, toggleOut, type SideMarks, type SwapSection,
} from "@/components/duel/side-deck-model";
import {
  attachedDeck, clock, HEADLINE, matchScore, outcomeFor, reasonLine, seatDeadline, SIDE_DECK_MS, SIDE_MS, winsBySeat, type Match,
} from "./match-model";
import s from "./match-ui.module.css";

/** The longest title animation ends near 1.0 s; the buttons wake up just after it. */
const INTRO_MS = 1050;

type Act = (proposal: RemoteActionProposal) => Promise<unknown>;

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => { try { setReduced(window.matchMedia("(prefers-reduced-motion: reduce)").matches); } catch { /* keep motion */ } }, []);
  return reduced;
}

/**
 * A dialog that covers the table: focus moves in (to `[data-autofocus]` or the dialog itself) once `ready`, Tab stays inside it,
 * and the focus goes back to where it was when the dialog closes.
 */
function useDialogFocus(ref: RefObject<HTMLElement | null>, ready = true, trap = true) {
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    return () => { try { before?.focus?.(); } catch { /* the element is gone */ } };
  }, []);
  useEffect(() => {
    if (!ready) return;
    const root = ref.current; if (!root) return;
    const target = root.querySelector<HTMLElement>("[data-autofocus]:not(:disabled)") ?? root;
    target.focus({ preventScroll: true });
  }, [ready, ref]);
  useEffect(() => {
    const root = ref.current; if (!root || !trap) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const items = Array.from(root.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex='-1'])"))
        .filter(item => item.getClientRects().length > 0);
      if (!items.length) { event.preventDefault(); return; }
      const first = items[0], last = items[items.length - 1], active = document.activeElement;
      if (event.shiftKey && (active === first || active === root)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && active === last) { event.preventDefault(); first.focus(); }
      else if (!root.contains(active)) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [ref, trap]);
}

/** Re-renders a few times a second so a countdown stays current. */
function useNow(now: () => number, on = true): number {
  const [value, setValue] = useState(() => now());
  useEffect(() => {
    if (!on) return undefined;
    setValue(now());
    const timer = window.setInterval(() => setValue(now()), 250);
    return () => window.clearInterval(timer);
  }, [now, on]);
  return value;
}

/**
 * The result of a game, or of the whole match. It uses the simulator's result screen look: the big word, the reason,
 * the Life Points tray and the match score. A game that did not decide the match offers Continue to side decking;
 * the final screen names the match winner.
 */
export function MatchResultScreen({ room, match, mySeat, name, final, busy, error, undo, onContinue, onLeave, onClose }: {
  room: RemoteRoom; match: Match; mySeat: number; name: (seat: number) => string; final: boolean; busy: boolean;
  /** The last action was refused: shown here, above the result. */ error?: string | null;
  /** A wrong result is fixed with Undo; null when there is nothing to undo. */ undo: { label: string; onUndo: () => void } | null;
  onContinue: () => void; onLeave: () => void; onClose: () => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [sureLeave, setSureLeave] = useState(false);
  useEffect(() => { if (!sureLeave) return undefined; const timer = window.setTimeout(() => setSureLeave(false), 4000); return () => window.clearTimeout(timer); }, [sureLeave]);
  const reduced = useReducedMotion();
  const [timedOut, setTimedOut] = useState(false);
  const [skipped, setSkipped] = useState(false);
  useEffect(() => { const timer = window.setTimeout(() => setTimedOut(true), INTRO_MS); return () => window.clearTimeout(timer); }, []);
  const settled = reduced || skipped || timedOut;
  useDialogFocus(rootRef, settled);
  const game = match.games[match.games.length - 1];
  const decided = final ? (match.winnerSeat ?? null) : (game?.winnerSeat ?? null);
  const outcome = outcomeFor(decided, mySeat, room.solo);
  const headline = HEADLINE[outcome];
  const seatCount = room.seatCount;
  const score = matchScore(match, seatCount, mySeat);
  const wins = winsBySeat(match, seatCount);
  const gameNumber = game?.n ?? match.games.length;
  const reason = final
    ? (outcome === "win" ? "You won the match." : outcome === "lose" ? `${name(decided as number)} won the match.` : outcome === "draw" ? "Nobody won the match." : decided === null ? "Nobody won the match." : `${name(decided)} won the match.`)
    : reasonLine(game, name, mySeat, game?.winnerSeat ?? null);
  const titleId = "match-result-title";
  const seats = room.seats.map(seat => seat.seat);
  const leave = () => { if (final || sureLeave) onLeave(); else setSureLeave(true); };
  return <div ref={rootRef} className={cx(duelFontClasses, resultStyles.root, s.resultRoot)} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}
    data-testid="match-result" data-final={final || undefined} data-outcome={outcome === "spectator" ? "ended" : outcome} data-title={outcome === "win" ? "win" : outcome === "lose" ? "lose" : "calm"}
    data-phase={settled ? "settled" : "play"} data-reduced={reduced ? "true" : "false"} onClick={() => { if (!settled) setSkipped(true); }}>
    <div className={resultStyles.backdrop} aria-hidden="true" />
    <div className={resultStyles.flash} aria-hidden="true" />
    <div className={resultStyles.scroll}><div className={resultStyles.col}>
      <div className={resultStyles.hero}>
        <div className={resultStyles.light} aria-hidden="true" />
        <p className={s.kicker} data-testid="match-kicker">{final ? "Match over" : `Game ${gameNumber}${match.bestOf === 3 ? " of 3" : ""}`}</p>
        <ResultTitle id={titleId} text={headline} outcome={outcome === "spectator" ? "ended" : outcome} />
        {reason ? <p className={resultStyles.reason} data-testid="match-reason">{reason}</p> : null}
      </div>

      {score ? <p className={s.matchScore} data-testid="match-score"><span>Match score</span><b>{score}</b><span>Best of 3</span></p> : null}

      <ul className={resultStyles.scoreboard} aria-label="Result" data-layout={seats.length === 2 ? "duo" : "rows"}>
        {seats.map(seat => {
          const lp = room.state.seats[seat]?.resources.lp ?? 0;
          const winner = decided === seat;
          return <li key={seat} className={resultStyles.score} data-winner={winner ? "true" : "false"} data-out={lp <= 0 ? "true" : "false"} data-seat={seat}>
            <div className={resultStyles.scoreText}>
              <span className={resultStyles.scoreName}>
                <span className={resultStyles.name}>{name(seat)}</span>
                {seat === mySeat && !room.solo ? <span className={resultStyles.tag} data-tag="you">You</span> : null}
                {winner ? <span className={resultStyles.tag} data-tag="winner">{final ? "Match winner" : "Winner"}</span> : null}
              </span>
              <span className={resultStyles.scoreLp}>
                {final || match.bestOf === 3 ? <><b>{wins[seat]}</b><i className={resultStyles.lpUnit}>{wins[seat] === 1 ? "win" : "wins"}</i></>
                  : <><b>{formatLp(lp)}</b><i className={resultStyles.lpUnit} aria-hidden="true">LP</i><span className={resultStyles.srOnly}> Life Points</span></>}
              </span>
            </div>
          </li>;
        })}
      </ul>

      {error ? <p className={s.resultError} role="alert" data-testid="match-error">{error}</p> : null}
      <div className={resultStyles.actions} data-count={final ? 2 : undo ? 3 : 2}>
        {final
          ? <button type="button" className={resultStyles.btn} data-kind="primary" data-autofocus onClick={leave} data-testid="match-leave">Leave</button>
          : <button type="button" className={resultStyles.btn} data-kind="primary" data-autofocus disabled={busy} onClick={onContinue} data-testid="match-continue">Continue to side decking</button>}
        {undo ? <button type="button" className={resultStyles.btn} data-kind="secondary" disabled={busy} onClick={undo.onUndo} title={undo.label} data-testid="match-undo">Undo last action</button> : null}
        {final
          ? <button type="button" className={resultStyles.btn} data-kind="secondary" onClick={onClose} data-testid="match-view-board">View board</button>
          : <button type="button" className={resultStyles.btn} data-kind="secondary" onClick={leave} data-testid="match-leave">{sureLeave ? "Leave? Press again" : "Leave"}</button>}
      </div>
    </div></div>
  </div>;
}

/** The other players are asked to agree to a result that one player declared. */
export function DeclareConfirm({ match, mySeat, name, busy, onAnswer }: {
  match: Match; mySeat: number; name: (seat: number) => string; busy: boolean; onAnswer: (declarationId: string, accept: boolean) => void;
}) {
  const pending = match.pendingResult;
  const rootRef = useRef<HTMLDivElement>(null);
  const open = !!pending && mySeat >= 0 && !pending.confirmed.includes(mySeat);
  useDialogFocus(rootRef, open, false);
  if (!pending || !open) return null;
  const by = pending.confirmed[0];
  const claim = pending.winnerSeat === null ? "the game was a draw" : pending.winnerSeat === mySeat ? "you won" : `${name(pending.winnerSeat)} won`;
  return <div ref={rootRef} className={s.declare} role="alertdialog" aria-labelledby="declare-q" tabIndex={-1} data-testid="declare-confirm">
    <p id="declare-q"><b>{by !== undefined ? name(by) : "A player"}</b> says {claim}. Do you agree?</p>
    <div className={s.declareBtns}>
      <button type="button" className={s.agree} disabled={busy} onClick={() => onAnswer(pending.id, true)} data-autofocus data-testid="declare-agree">Agree</button>
      <button type="button" className={s.disagree} disabled={busy} onClick={() => onAnswer(pending.id, false)} data-testid="declare-reject">Disagree</button>
    </div>
  </div>;
}

/** The player who declared a result sees who has not agreed yet. */
export function DeclarePending({ match, mySeat, seats, name }: { match: Match; mySeat: number; seats: number[]; name: (seat: number) => string }) {
  const pending = match.pendingResult;
  if (!pending || mySeat < 0 || !pending.confirmed.includes(mySeat)) return null;
  const waiting = seats.filter(seat => !pending.confirmed.includes(seat)).map(name);
  return <div className={s.pending} role="status" data-testid="declare-pending">
    <span className={s.pendingDot} aria-hidden="true" />Waiting for {waiting.length ? waiting.join(", ") : "the other players"} to agree to the result.
  </div>;
}

/** The choices of "Declare result": who won, or a draw. A player who is out of the game cannot win it. */
export function declareChoices(seats: { seat: number; name: string; out?: boolean }[], mySeat: number): { seat: number | null; label: string }[] {
  const mine = seats.find(item => item.seat === mySeat);
  return [
    ...(mine && !mine.out ? [{ seat: mine.seat, label: "I won" }] : []),
    ...seats.filter(item => item.seat !== mySeat && !item.out).map(item => ({ seat: item.seat, label: `${item.name} won` })),
    { seat: null, label: "Draw" },
  ];
}

/**
 * Between two games. A countdown (3:00, or 5:00 with a deck list), Ready and the Ready state of the other players. With a deck list
 * the player can also swap cards between Main, Extra and Side like the simulator. When every player is Ready or the clock ends, the
 * next game starts. The loser of the last game chooses who goes first.
 */
export function SidingScreen({ room, match, mySeat, name, now, act, error: outsideError }: {
  room: RemoteRoom; match: Match; mySeat: number; name: (seat: number) => string; now: () => number; act: Act;
  /** The last action was refused (the table passes the server's reason). */ error?: string | null;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  useDialogFocus(rootRef);
  const siding = match.siding;
  const deck = attachedDeck(room, mySeat);
  const clockNow = useNow(now, !!siding);
  const [busy, setBusy] = useState(false);
  const [localError, setError] = useState<string | null>(null);
  const error = localError ?? outsideError ?? null;
  const seatNo = mySeat >= 0 ? mySeat : 0;
  const imReady = !!siding?.ready.includes(mySeat);
  const myEnd = siding ? seatDeadline(siding, seatNo) : 0;
  const left = siding ? myEnd - clockNow : 0;
  const total = deck ? SIDE_DECK_MS : SIDE_MS;
  const expired = !!siding && left <= 0;
  // A room with a mix of physical and deck seats: a seat can be out of time while the next game still waits for the others.
  const finalLeft = siding ? siding.deadline - clockNow : 0;
  const mixed = !!siding && siding.extendedFor.length > 0 && siding.extendedFor.length < room.seats.length;
  const waitsForOthers = expired && finalLeft > 0;
  const locked = busy || imReady || expired || mySeat < 0 || room.solo;

  // A clock check at the end: never a game loss, and the server sweeps the room too.
  const timeoutSent = useRef<number | null>(null);
  useEffect(() => {
    if (!siding || timeoutSent.current === siding.deadline) return undefined;
    const wait = Math.max(0, siding.deadline - now()) + 1500;
    const timer = window.setTimeout(() => { timeoutSent.current = siding.deadline; void act({ type: "side.timeout", actorSeat: seatNo }); }, wait);
    return () => window.clearTimeout(timer);
  }, [siding, now, act, seatNo]);

  // `act` never throws: a refused action comes back as null and the table shows the reason through `error`.
  const run = useCallback(async (job: () => Promise<unknown>) => {
    setBusy(true); setError(null);
    try { return await job(); } catch (cause) { setError(cause instanceof Error ? cause.message : "Something went wrong. Try again."); return null; } finally { setBusy(false); }
  }, []);

  // ---- deck editing (only with a deck list) ----
  const current: DuelDeck = deck ?? { main: [], extra: [], side: [] };
  const meta = useDeckCardMeta(current, { enabled: !!deck });
  const types = useMemo(() => new Map([...meta].map(([code, info]) => [code, info.type] as const)), [meta]);
  const nameOf = (code: number) => meta.get(code)?.name ?? `Card ${code}`;
  const [marks, setMarks] = useState<SideMarks>(NO_MARKS);
  const [hovered, setHovered] = useState<number | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const plan = useMemo(() => planSideDeck(current, marks, types, current), [current, marks, types]);
  const changed = hasMarks(marks);
  const deckKey = JSON.stringify(current);
  useEffect(() => { setMarks(NO_MARKS); }, [deckKey]);
  const saving = useRef(false);
  const save = useCallback(async () => {
    if (saving.current || plan.reason || !changed) return true;
    saving.current = true;
    try { return (await act({ type: "side.swap", actorSeat: seatNo, deckChanges: { main: plan.deck.main, extra: plan.deck.extra, side: plan.deck.side } })) !== null; } finally { saving.current = false; }
  }, [plan, changed, act, seatNo]);
  // A complete swap is saved on its own, so the clock ending never loses it.
  useEffect(() => {
    if (!deck || locked || !changed || plan.reason) return undefined;
    const timer = window.setTimeout(() => { void save(); }, 700);
    return () => window.clearTimeout(timer);
  }, [deck, locked, changed, plan.reason, save]);

  const ready = () => run(async () => {
    // A swap that the server refused must not be followed by Ready: the deck would start the game unchanged.
    if (changed) { if (plan.reason) return null; if (!(await save())) return null; }
    return act({ type: "side.ready", actorSeat: seatNo, seat: seatNo });
  });
  const unready = () => run(() => act({ type: "side.unready", actorSeat: seatNo, seat: seatNo }));
  const first = (seat: number) => run(() => act({ type: "match.first", actorSeat: seatNo, seatGoesFirst: seat }));

  const chooser = match.firstChooser ?? null;
  const iChoose = chooser !== null && chooser === mySeat && !room.solo;
  const seats = room.seats.map(item => item.seat);
  const gameNo = match.games.length + 1;
  const score = matchScore(match, room.seatCount, mySeat);
  const lastGame = match.games[match.games.length - 1];
  const chooserWhy = room.seatCount === 2 && lastGame?.winnerSeat !== null && lastGame?.winnerSeat !== undefined ? "You lost, so you choose who goes first" : "You choose who goes first";
  const fallbackNote = room.seatCount === 2 && lastGame?.winnerSeat !== null ? "If nobody chooses, the loser goes first." : "If nobody chooses, the table picks a player.";
  const everyoneReady = !!siding && room.seats.every(item => siding.ready.includes(item.seat));
  const firstLine = match.firstSeat !== undefined ? `${name(match.firstSeat)} goes first.` : chooser !== null ? `${name(chooser)} chooses who goes first.` : "";
  const clockText = clock(Math.max(0, left));
  const danger = left <= 30_000;

  const readyRows = <ul className={cx(seriesStyles.readyRows, s.readyRows)} aria-label="Players" data-testid="siding-players">
    {seats.map(seat => {
      const isReady = !!siding?.ready.includes(seat);
      return <li key={seat} className={seriesStyles.readyRow} data-ready={isReady ? "true" : "false"} data-testid={`siding-ready-${seat}`}>
        <span className={seriesStyles.readyName}>{name(seat)}{seat === mySeat && !room.solo ? " (you)" : ""}</span>
        {room.seatCount > 2 && match.games.length ? <span className={s.readyWins}>{winsBySeat(match, room.seatCount)[seat]} {winsBySeat(match, room.seatCount)[seat] === 1 ? "win" : "wins"}</span> : null}
        <span className={seriesStyles.readyState}><i aria-hidden />{isReady ? "Ready" : "Siding"}</span>
      </li>;
    })}
  </ul>;

  const firstChoice = chooser !== null && match.firstSeat === undefined || iChoose
    ? <div className={seriesStyles.first} role="group" aria-label="Who goes first in the next game" data-testid="first-choice">
      <p className={seriesStyles.firstHead}>{iChoose ? chooserWhy : `${name(chooser as number)} chooses who goes first`}</p>
      {iChoose ? <div className={seriesStyles.firstRow}>
        {seats.map(seat => <button key={seat} type="button" className={seriesStyles.firstBtn} aria-pressed={match.firstSeat === seat} disabled={busy || finalLeft <= 0}
          data-testid={`first-choice-${seat === mySeat ? "me" : seat}`} onClick={() => void first(seat)}>{seat === mySeat ? "I go first" : `${name(seat)} first`}</button>)}
      </div> : null}
      <p className={seriesStyles.firstNote}>{match.firstSeat !== undefined ? `${name(match.firstSeat)} goes first.` : fallbackNote}</p>
    </div> : (firstLine ? <p className={s.firstLine} data-testid="first-line">{firstLine}</p> : null);

  const buttons = <div className={s.buttons}>
    {imReady
      ? <SheetButton kind="secondary" size="lg" disabled={busy || expired || room.solo} onClick={() => void unready()} data-testid="siding-unready">Not ready</SheetButton>
      : <SheetButton kind="primary" size="lg" loading={busy} disabled={busy || expired || mySeat < 0 || room.solo || (changed && plan.reason != null)} onClick={() => void ready()} data-testid="siding-ready">Ready</SheetButton>}
  </div>;
  const waitingFirst = everyoneReady && match.firstSeat === undefined && chooser !== null;
  const status = waitingFirst ? (iChoose ? `Everyone is ready. Choose who goes first. The game starts in ${clock(Math.max(0, finalLeft))}.` : `Everyone is ready. Waiting for ${name(chooser as number)} to choose who goes first (${clock(Math.max(0, finalLeft))}).`)
    : waitsForOthers ? `Your time is up. The next game starts in ${clock(finalLeft)}.`
    : expired ? "Time is up. The next game starts now."
    : imReady ? "You are ready. Waiting for the other players."
      : changed && plan.reason ? plan.reason
        : deck ? "Swap cards if you want. When you are ready, press Ready, or wait for the clock."
          : "Take your time with your physical cards. Press Ready when your deck is set.";

  const timer = <div className={s.timer} data-danger={danger ? "true" : undefined} role="timer" aria-label="Time left to side deck" data-testid="siding-timer">
    <span className={s.timerCap}>{waitsForOthers ? "Game starts in" : "Time left"}</span>
    <b className={s.timerNum}>{waitsForOthers ? clock(Math.max(0, finalLeft)) : clockText}</b>
    {mixed ? <span className={s.timerNote} data-testid="siding-mixed">{deck ? "Players without a deck list have 2 minutes less." : "Players with a deck list have 2 more minutes."}</span> : null}
    <span className={s.timerBar} aria-hidden="true"><i style={{ width: `${Math.max(0, Math.min(100, (left / total) * 100))}%` }} /></span>
  </div>;

  if (!deck) {
    return <div ref={rootRef} className={cx(sheetRoot, s.sidingRoot, s.plainRoot)} role="dialog" aria-modal="true" aria-label="Side decking" tabIndex={-1} data-testid="siding" data-deck="false">
      <div className={s.plain}>
        <p className={betweenStyles.eyebrow}>Between games{score ? ` · Score ${score}` : ""}</p>
        <h1 className={s.plainTitle}>Game {gameNo}{match.bestOf === 3 ? " of 3" : ""} is next</h1>
        {timer}
        {readyRows}
        <div className={s.sticky}>
          {firstChoice}
          <p className={betweenStyles.reason} role="status" data-testid="siding-status">{status}</p>
          {error ? <p className={betweenStyles.error} role="alert" data-testid="siding-error">{error}</p> : null}
          {buttons}
        </div>
      </div>
    </div>;
  }

  const flag = (code: number, section: string, tag?: Tag, extra?: boolean) => `${nameOf(code)}, ${section} Deck${tag === "out" ? ", marked out" : tag === "in" ? ", marked in" : extra ? ", goes to the Extra Deck" : ""}`;
  const edit = (next: SideMarks) => { if (!locked) setMarks(next); };
  const mainCards = current.main.map((code, i) => { const tag: Tag | undefined = isMarkedOut(marks, "main", i) ? "out" : undefined;
    return <Tile key={`m${i}`} code={code} name={nameOf(code)} label={flag(code, "Main", tag)} tag={tag} locked={locked} onClick={() => edit(toggleOut(marks, "main", i))} onHover={setHovered} onSelect={setSelected} />; });
  const extraCards = current.extra.map((code, i) => { const tag: Tag | undefined = isMarkedOut(marks, "extra", i) ? "out" : undefined;
    return <Tile key={`e${i}`} code={code} name={nameOf(code)} label={flag(code, "Extra", tag)} tag={tag} locked={locked} onClick={() => edit(toggleOut(marks, "extra", i))} onHover={setHovered} onSelect={setSelected} />; });
  const incoming = (section: SwapSection) => [...plan.destination].filter(([, to]) => to === section).map(([sideIndex]) => {
    const code = current.side[sideIndex];
    return <Tile key={`in${section}${sideIndex}`} code={code} name={nameOf(code)} label={flag(code, section === "main" ? "Main" : "Extra", "in")} tag="in" locked={locked} onClick={() => edit(toggleIn(marks, sideIndex))} onHover={setHovered} onSelect={setSelected} />;
  });
  const sideCards = current.side.map((code, i) => { const tag: Tag | undefined = isMarkedIn(marks, i) ? "in" : undefined; const type = types.get(code); const extra = type != null && isExtraDeckType(type);
    return <Tile key={`s${i}`} code={code} name={nameOf(code)} label={flag(code, "Side", tag, extra)} tag={tag} extra={extra} locked={locked} onClick={() => edit(toggleIn(marks, i))} onHover={setHovered} onSelect={setSelected} />; });
  const counterState = !changed ? "none" : !plan.typesReady ? "loading" : plan.balanced ? "even" : "uneven";
  const counterNote = !changed ? "No changes" : !plan.typesReady ? "Loading card types…" : plan.balanced ? "Even" : plan.out === plan.inn ? "Section sizes changed" : "Not even";
  const sideShown = plan.counts.side;

  return <div ref={rootRef} className={cx(sheetRoot, betweenStyles.screen, s.sidingRoot)} role="dialog" aria-modal="true" aria-label="Side decking" tabIndex={-1} data-testid="siding" data-deck="true">
    <header className={betweenStyles.head}>
      <div className={betweenStyles.headMain}>
        <p className={betweenStyles.eyebrow}>Between games</p>
        <h1 className={betweenStyles.title}>Game {gameNo}{match.bestOf === 3 ? " of 3" : ""} is next</h1>
      </div>
      <div className={betweenStyles.chips}>
        {score ? <span className={betweenStyles.chip}>Score <b>{score}</b></span> : null}
        <span className={betweenStyles.chip} data-tone="gold">Starts in <b>{clockText}</b></span>
      </div>
    </header>
    <div className={betweenStyles.body}>
      <div className={betweenStyles.deck}>
        <Section title="Main" count={plan.counts.main} target={`keep ${current.main.length} cards`} tone={plan.counts.main === current.main.length ? undefined : "bad"} empty="No Main Deck cards.">{[...mainCards, ...incoming("main")]}</Section>
        <Section title="Extra" count={plan.counts.extra} target={`keep ${current.extra.length} cards`} tone={plan.counts.extra === current.extra.length ? undefined : "bad"} hint="Only Extra Deck monsters come into the Extra Deck." empty="No Extra Deck cards.">{[...extraCards, ...incoming("extra")]}</Section>
        <Section title="Side" count={sideShown} target={sideShown === current.side.length ? "stays the same" : `was ${current.side.length}`} tone={sideShown === current.side.length ? undefined : "bad"} empty="No Side Deck. You play the same deck again.">{sideCards}</Section>
      </div>
      <aside className={cx(betweenStyles.panel, s.panel)} aria-label="Siding">
        <div className={betweenStyles.preview}><DeckCardPreview code={hovered ?? selected} compact /></div>
        {timer}
        <div className={betweenStyles.counter} data-state={counterState} role="status" aria-live="polite" data-testid="swap-counter">
          <span className={ui.num}>{plan.out} out · {plan.inn} in</span><span className={betweenStyles.counterNote}>{counterNote}</span>
        </div>
        {readyRows}
        <div className={s.sticky}>
          {firstChoice}
          <div className={betweenStyles.actions}>
            <p className={betweenStyles.reason} role="status" data-testid="siding-status">{status}</p>
            {error ? <p className={betweenStyles.error} role="alert" data-testid="siding-error">{error}</p> : null}
            {buttons}
            <SheetButton kind="quiet" disabled={locked || !changed} onClick={() => setMarks(NO_MARKS)}>Undo swaps</SheetButton>
          </div>
        </div>
      </aside>
    </div>
  </div>;
}

