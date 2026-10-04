"use client";

import { duelFxClock } from "./fx-clock";
import {
  Fragment,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import type { DuelRoom } from "@yugidraft/shared/duels";
import { cardArtUrl, formatLp } from "./constants";
import { duelFontClasses } from "./fonts";
import { isMultiSeat, seatNamer, winnerLabel, winnerSeats } from "./multi-seat";
import styles from "./duel-result.module.css";
import seriesStyles from "./series.module.css";
import { SeriesBadges } from "./series-banner";
import { SeriesNextControls } from "./series-next";
import {
  betweenGamesInfo, isBetweenGames, seriesOutcome, seriesPlayerIndex, seriesRecordLabel, seriesScoreForViewer, spectatorSeriesStatus,
} from "./series-model";


/** The longest animation ends near 1.0 s (the chips falling out of the break); the timer settles just after it. */
const INTRO_MS = 1050;

export type DuelResultScreenProps = {
  room: DuelRoom;
  slug: string;
  reducedMotion: boolean;
  soundEnabled: boolean;
  /** Dismiss the screen and keep viewing the final board. */
  onClose: () => void;
  /** Leave the duel (closes the duel window, or returns to the tables list). */
  onExit?: () => void;
  /** Series only: the series changed (Ready, Cancel series); reload the room. */
  onSeriesChanged?: () => void;
  /** Series only: go to the next game's room. */
  onNavigate?: (slug: string) => void;
  /**
   * Tables of 3 or more seats: the final standing. The scoreboard becomes a list in this order, each row with its
   * place. `label` is the place in words ("1st"). Absent: the two-column scoreboard of a duel of two.
   */
  placings?: ReadonlyArray<{ seat: number; place: number; label: string }>;
};

// ---------------------------------------------------------------------------
// Result model (pure, exported for tests)
// ---------------------------------------------------------------------------

export type DuelResultOutcome = "win" | "lose" | "spectator" | "draw" | "interrupted" | "cancelled" | "ended";

export type DuelResultReasonKind = "life-points" | "deck-out" | "surrender" | "time" | "connection" | "other";

export interface DuelResultScore {
  seat: number;
  name: string;
  lp: number;
  isMe: boolean;
  isWinner: boolean;
  deckMaster: { code: number; name: string } | null;
}

export interface DuelResultModel {
  outcome: DuelResultOutcome;
  /** Natural-case text for assistive technology. The screen shows it in capitals. */
  headline: string;
  winnerSeat: number | null;
  reasonKind: DuelResultReasonKind;
  /** Plain-words reason, or null when the server gave none. */
  reason: string | null;
  scores: DuelResultScore[];
}

/**
 * Engine reason strings (packages/duel-server):
 *   strings.conf !victory  "Surrendered" | "LP reached 0" | "Cards can't be drawn"
 *                          | "Time limit up" | "Lost connection"
 *                          | "Victory by the effect of ..." | "Victory by the rules of ..."
 *   engine.ts fallback     "Win reason <n>"
 *   host.ts                "Surrender" | "Time limit"
 */
export function classifyResultReason(raw: string | null | undefined): DuelResultReasonKind {
  const text = (raw ?? "").trim();
  if (/^surrender(ed)?\b/i.test(text)) return "surrender";
  if (/^time limit/i.test(text)) return "time";
  if (/^lost connection/i.test(text)) return "connection";
  if (/^lp reached 0/i.test(text) || /^life points?\b.*\b0\b/i.test(text)) return "life-points";
  if (/(can'?t|cannot|could not) (be )?draw/i.test(text)) return "deck-out";
  return "other";
}

function seatName(room: DuelRoom, seat: number): string {
  if (isMultiSeat(room.engine)) {
    return seatNamer(room.session.seats.map((item) => ({
      ...item, displayName: item.displayName?.trim() || `Seat ${item.seat + 1}`,
    })))(seat);
  }
  return room.session.seats.find((item) => item.seat === seat)?.displayName?.trim() || `Seat ${seat + 1}`;
}

function reasonLine(
  kind: DuelResultReasonKind,
  raw: string,
  loser: { name: string; isMe: boolean } | null,
): string | null {
  if (!raw) return null;
  if (kind === "time") return "Time ran out";
  if (!loser) return kind === "life-points" ? "Both players' Life Points hit 0" : raw;
  const subject = loser.isMe ? "You" : loser.name;
  switch (kind) {
    case "life-points":
      return loser.isMe ? "Your Life Points hit 0" : `${loser.name}'s Life Points hit 0`;
    case "deck-out":
      return `${subject} could not draw a card`;
    case "surrender":
      return `${subject} surrendered`;
    case "connection":
      return `${subject} lost connection`;
    default:
      return raw;
  }
}

export function describeDuelResult(room: DuelRoom): DuelResultModel {
  const { session, engine, mySeat } = room;
  const result = engine?.result ?? null;
  const winnerSeat = result ? result.winnerSeat : session.winnerSeat;
  const raw = (result?.reason ?? session.resultReason ?? "").trim();
  const kind = classifyResultReason(raw);
  // 3 and 4 seat tables: the winners are a set (both partners in Tag); no "other seat" math.
  const multi = isMultiSeat(engine);
  const winners = !multi ? [] : engine?.result ? winnerSeats(engine) : winnerSeat == null ? [] : [winnerSeat];
  const loserSeat = multi ? null : winnerSeat === 0 ? 1 : winnerSeat === 1 ? 0 : null;
  const loser = loserSeat == null ? null : { name: seatName(room, loserSeat), isMe: loserSeat === mySeat };

  const scores: DuelResultScore[] = session.status === "cancelled"
    ? []
    : [...(engine?.seats ?? [])]
        .sort((a, b) => a.seat - b.seat)
        .map((seat) => ({
          seat: seat.seat,
          name: seatName(room, seat.seat),
          lp: seat.lp,
          isMe: seat.seat === mySeat,
          isWinner: session.status !== "interrupted" && winnerSeat != null && (multi ? winners.includes(seat.seat) : seat.seat === winnerSeat),
          deckMaster: seat.deckMaster ? { code: seat.deckMaster.card.code, name: seat.deckMaster.card.name } : null,
        }));

  if (session.status === "cancelled") {
    return { outcome: "cancelled", headline: "TABLE CANCELLED", winnerSeat: null, reasonKind: "other", reason: raw || "This table was cancelled", scores };
  }
  if (session.status === "interrupted") {
    return { outcome: "interrupted", headline: "DUEL INTERRUPTED", winnerSeat: null, reasonKind: "other", reason: raw || "This duel ended without a result", scores };
  }
  if (winnerSeat == null) {
    const finished = result != null || session.status === "completed";
    return {
      outcome: finished ? "draw" : "ended",
      headline: finished ? "DRAW" : "DUEL ENDED",
      winnerSeat: null,
      reasonKind: kind,
      reason: reasonLine(kind, raw, null),
      scores,
    };
  }
  const reason = multi ? (raw ? reasonLine(kind === "life-points" ? "other" : kind, raw, null) : null) : reasonLine(kind, raw, loser);
  if (multi) {
    const won = mySeat != null && winners.includes(mySeat);
    const names = engine ? winnerLabel(engine, (seat) => seatName(room, seat)) : null;
    const who = names ?? seatName(room, winnerSeat);
    const plural = winners.length > 1;
    if (mySeat == null) return { outcome: "spectator", headline: `${who} ${plural ? "win" : "wins"}`, winnerSeat, reasonKind: kind, reason, scores };
    return won
      ? { outcome: "win", headline: "YOU WIN", winnerSeat, reasonKind: kind, reason, scores }
      : { outcome: "lose", headline: "YOU LOSE", winnerSeat, reasonKind: kind, reason, scores };
  }
  if (mySeat == null) {
    return { outcome: "spectator", headline: `${seatName(room, winnerSeat)} wins`, winnerSeat, reasonKind: kind, reason, scores };
  }
  return mySeat === winnerSeat
    ? { outcome: "win", headline: "YOU WIN", winnerSeat, reasonKind: kind, reason, scores }
    : { outcome: "lose", headline: "YOU LOSE", winnerSeat, reasonKind: kind, reason, scores };
}

// ---------------------------------------------------------------------------
// The title: one word, whole on a win or a draw, broken along one jagged line on a loss
// ---------------------------------------------------------------------------

/** Which look the title has: the loss breaks, the win is gold, everything else is ivory. */
export type TitleKind = "lose" | "win" | "calm";

export function titleKindOf(outcome: DuelResultOutcome): TitleKind {
  return outcome === "lose" ? "lose" : outcome === "win" ? "win" : "calm";
}

/** Line height of the title, in em. The break sits in the middle of the last row, so it is a function of the row count. */
const TITLE_LINE = 0.9;
/** Wobble of the break, in em of the title size, left to right. The same on every loss. */
const FRACTURE_JITTER = [0.5, -0.9, 0.7, -1, 0.6, -0.8, 1, -0.6, 0.8, -0.7, 0.5, -0.4];
/** The chips that fall out of the break: x along the line in %, drift, fall (px), spin (deg), size (px). */
const CHIPS = [
  [12, -26, 150, 200, 9], [31, 18, 210, -160, 6], [50, -12, 120, 120, 11], [69, 30, 240, -230, 7], [87, 16, 170, 180, 8],
] as const;

export interface FractureGeometry {
  /** clip-path of the upper half, the lower half, and the strip around the line that the glow shows through. */
  top: string;
  bottom: string;
  strip: string;
  /** Steel gradient stops (%) for the halves: warm toward the break on both sides. */
  steel: [string, string, string, string];
  /** Glow gradient stops (%) for the light in the gap. */
  glow: [string, string, string, string, string];
  /** Where each chip starts, as a % of the title's height. */
  chipY: string[];
}

const pct = (value: number) => `${value.toFixed(2)}%`;

/**
 * The break across a title of `rows` rows (1 on a wide screen, 2 when the words stack on a phone).
 * The box is rows x 0.9em tall, so every number is a function of `rows`: no measuring needed.
 * Percentages are of the title's box.
 */
export function fractureGeometry(rows: number): FractureGeometry {
  const height = rows * TITLE_LINE;
  const em = 100 / height; // 1em as a % of the box height
  const center = ((rows - 0.5) / rows) * 100; // middle of the last row
  const slope = 0.06 * em; // the line climbs a little to the right
  const yAt = (x: number) => center + slope * (0.5 - (x + 2) / 104) * 2;
  const line: Array<[number, number]> = FRACTURE_JITTER.map((jit, index) => {
    const x = -2 + (index * 104) / (FRACTURE_JITTER.length - 1);
    return [x, yAt(x) + jit * 0.05 * em];
  });
  const e0: [number, number] = [-40, yAt(-40)];
  const e1: [number, number] = [140, yAt(140)];
  const point = (q: [number, number]) => `${pct(q[0])} ${pct(q[1])}`;
  const polygon = (points: Array<[number, number]>) => `polygon(${points.map(point).join(", ")})`;
  const reversed = [...line].reverse();
  const shift = (q: [number, number], d: number): [number, number] => [q[0], q[1] + d * em];
  return {
    top: polygon([[-40, -40], [140, -40], e1, ...reversed, e0]),
    bottom: polygon([e0, ...line, e1, [140, 140], [-40, 140]]),
    strip: polygon([
      shift(e0, -0.06), ...line.map((q) => shift(q, -0.06)), shift(e1, -0.06),
      shift(e1, 0.06), ...reversed.map((q) => shift(q, 0.06)), shift(e0, 0.06),
    ]),
    steel: [-0.09, -0.025, 0.025, 0.09].map((d) => pct(center + d * em)) as FractureGeometry["steel"],
    glow: [-0.065, -0.025, 0, 0.025, 0.065].map((d) => pct(center + d * em)) as FractureGeometry["glow"],
    chipY: CHIPS.map(([x]) => pct(yAt(x))),
  };
}

/** Inline custom properties for a loss title: both row counts, the stylesheet picks one with its phone breakpoint. */
const FRACTURE_VARS: CSSProperties = (() => {
  const vars: Record<string, string> = {};
  for (const rows of [1, 2]) {
    const g = fractureGeometry(rows);
    vars[`--top-${rows}`] = g.top;
    vars[`--bottom-${rows}`] = g.bottom;
    vars[`--strip-${rows}`] = g.strip;
    g.steel.forEach((value, index) => { vars[`--h${index}-${rows}`] = value; });
    g.glow.forEach((value, index) => { vars[`--l${index}-${rows}`] = value; });
  }
  return vars as CSSProperties;
})();

const CHIP_VARS: CSSProperties[] = CHIPS.map(([x, dx, dy, spin, size], index) => {
  const vars: Record<string, string> = {
    left: `${x}%`, "--dx": `${dx}px`, "--dy": `${dy}px`, "--r": `${spin}deg`, "--sz": `${size}px`,
  };
  [1, 2].forEach((rows) => { vars[`--y-${rows}`] = fractureGeometry(rows).chipY[index]; });
  return vars as CSSProperties;
});

/** Smallest and largest title sizes (px), and the share of the screen height one row may use. */
const TITLE_MIN = 28;
const TITLE_MAX = { fixed: 210, calm: 170 } as const;
const TITLE_ROW_SHARE = 0.27;
const TITLE_STACK_SHARE = 0.3;

/**
 * Font size (px) that makes the title exactly as wide as its column, but no taller than a share of the
 * screen. `widthAt100` is the title's width at 100px. Returns 0 when nothing can be measured (no layout),
 * and the stylesheet's own size stays.
 */
export function titleFontSize(input: {
  available: number;
  widthAt100: number;
  viewportHeight: number;
  /** Rows the words occupy: 1 on one line, the word count when they stack. */
  rows: number;
  max: number;
}): number {
  const { available, widthAt100, viewportHeight, rows, max } = input;
  if (!(available > 0) || !(widthAt100 > 0)) return 0;
  const fit = (available / widthAt100) * 100 * 0.995;
  const cap = viewportHeight * (rows > 1 ? TITLE_STACK_SHARE / rows : TITLE_ROW_SHARE);
  return Math.max(TITLE_MIN, Math.min(fit, cap, max));
}

const PHONE_MAX = 600;

function useTitleFit(headlineWords: string[], max: number, stackable: boolean) {
  const titleRef = useRef<HTMLHeadingElement>(null);
  const wordRef = useRef<HTMLSpanElement>(null);
  const key = headlineWords.join(" ");
  useLayoutEffect(() => {
    const title = titleRef.current;
    const word = wordRef.current;
    if (!title || !word) return undefined;
    const words = key.split(" ");
    const fit = () => {
      const available = title.clientWidth;
      const viewportHeight = window.innerHeight;
      const measure = (stack: boolean) => {
        word.dataset.stack = stack ? "1" : "0";
        title.style.setProperty("--fs", "100px");
        // The natural width of the text, not the width the column would squeeze it to.
        word.style.width = "max-content";
        word.style.maxWidth = "none";
        const width = word.offsetWidth;
        word.style.width = "";
        word.style.maxWidth = "";
        return width;
      };
      let stack = window.innerWidth <= PHONE_MAX && words.length > 1;
      let size = titleFontSize({ available, widthAt100: measure(stack), viewportHeight, rows: stack ? words.length : 1, max });
      // A long name would shrink the word to a whisper: let the words stack instead.
      if (size > 0 && !stack && stackable && words.length > 1 && size < 56) {
        stack = true;
        size = titleFontSize({ available, widthAt100: measure(true), viewportHeight, rows: words.length, max });
      }
      if (size > 0) title.style.setProperty("--fs", `${size.toFixed(2)}px`);
      else title.style.removeProperty("--fs");
    };
    fit();
    window.addEventListener("resize", fit);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(fit);
    observer?.observe(title);
    // The fonts swap in after the first paint: measure again with the real letters.
    const fonts = typeof document !== "undefined" ? document.fonts : undefined;
    let live = true;
    void fonts?.ready.then(() => { if (live) fit(); });
    fonts?.addEventListener?.("loadingdone", fit);
    return () => {
      live = false;
      window.removeEventListener("resize", fit);
      observer?.disconnect();
      fonts?.removeEventListener?.("loadingdone", fit);
    };
  }, [key, max, stackable]);
  return { titleRef, wordRef };
}

function InkWords({ words }: { words: string[] }) {
  return (
    <>
      {words.map((word, index) => (
        <Fragment key={index}>
          {index > 0 ? <span className={styles.brk}> </span> : null}
          {word}
        </Fragment>
      ))}
    </>
  );
}

/**
 * The result title. Screen readers read the text once; every painted copy is hidden from them.
 * Loss: two clipped copies of the word along one jagged line, parted, and an unmoved copy under them
 * that lights up through the gap. Win and calm: one whole copy.
 */
function ResultTitle({ id, text, outcome }: { id: string; text: string; outcome: DuelResultOutcome }) {
  const kind = titleKindOf(outcome);
  const words = useMemo(() => text.split(/\s+/).filter(Boolean), [text]);
  const { titleRef, wordRef } = useTitleFit(words, kind === "calm" ? TITLE_MAX.calm : TITLE_MAX.fixed, kind === "calm");
  const ink = (extra?: string) => (
    <span className={extra ? `${styles.ink} ${extra}` : styles.ink}><InkWords words={words} /></span>
  );
  return (
    <h1 ref={titleRef} id={id} className={styles.title}>
      <span className={styles.srOnly}>{text}</span>
      <span ref={wordRef} className={styles.word} data-kind={kind} aria-hidden="true" style={kind === "lose" ? FRACTURE_VARS : undefined}>
        {kind === "lose" ? (
          <>
            <span className={styles.lit}>{ink()}</span>
            <span className={`${styles.lit} ${styles.hot}`}>{ink()}</span>
            <span className={styles.piece} data-p="t">{ink()}</span>
            <span className={styles.piece} data-p="b">{ink()}</span>
            <span className={styles.dust}>
              {CHIP_VARS.map((chip, index) => <i key={index} style={chip} />)}
            </span>
          </>
        ) : (
          <span className={styles.piece} data-p="whole">{ink()}</span>
        )}
      </span>
    </h1>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const FOCUSABLE = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Series score, the series result at the end, and the between-games controls. */
function SeriesResult({ room, slug, onChanged, onNavigate }: {
  room: DuelRoom;
  slug: string;
  onChanged?: () => void;
  onNavigate?: (slug: string) => void;
}) {
  const series = room.series;
  if (!series) return null;
  const index = seriesPlayerIndex(room, series);
  const outcome = seriesOutcome(series, index);
  const record = seriesRecordLabel(series);
  const between = isBetweenGames(room, slug);
  const info = betweenGamesInfo(room, slug);
  const watching = spectatorSeriesStatus(room, slug);
  const live = watching?.kind === "next-live" ? watching : null;
  return (
    <section className={styles.seriesBlock} aria-label="Series" data-state={outcome ? "decided" : between ? "between" : live ? "next-live" : "score"}>
      <SeriesBadges series={series} hideScore />
      {outcome ? (
        <div className={seriesStyles.result} data-final="true">
          <p className={`${seriesStyles.resultHead} ${styles.sHead}`}>{outcome.headline}</p>
          <p className={`${seriesStyles.resultLine} ${styles.sLine}`}>{outcome.detail}</p>
          {record ? <p className={`${seriesStyles.resultRecord} ${styles.sRecord}`}>{record}</p> : null}
        </div>
      ) : live ? (
        <div className={seriesStyles.result} data-testid="next-game-live">
          <p className={`${seriesStyles.resultHead} ${styles.sHead}`}>{live.headline}</p>
          <p className={`${seriesStyles.resultLine} ${styles.sLine}`}>Series score <b>{seriesScoreForViewer(series, index)}</b></p>
          <button type="button" className={styles.btn} data-kind="primary" onClick={() => (onNavigate ?? noop)(live.nextSlug)}>
            Watch game {series.gameNumber}
          </button>
        </div>
      ) : info ? (
        <div className={seriesStyles.result} data-testid="between-games-info">
          <p className={`${seriesStyles.resultHead} ${styles.sHead}`}>{info.result}</p>
          <p className={`${seriesStyles.resultLine} ${styles.sLine}`}>Up next: <b>{info.next}</b></p>
          <p className={`${seriesStyles.resultRecord} ${styles.sRecord}`}>{info.first}</p>
        </div>
      ) : (
        <p className={`${seriesStyles.resultLine} ${styles.sLine}`}>
          Series score <b>{seriesScoreForViewer(series, index)}</b>
          {series.tournamentId != null ? null : series.ranked ? " · Ranked" : null}
        </p>
      )}
      {between ? (
        <SeriesNextControls room={room} slug={slug} tone="result" onChanged={onChanged ?? noop}
          onNavigate={onNavigate ?? noop} />
      ) : null}
    </section>
  );
}

const noop = () => undefined;

const subscribeNever = () => () => undefined;
const readBody = () => document.body;
const readNoBody = () => null;

export function DuelResultScreen({ room, slug, reducedMotion, onClose, onExit, onSeriesChanged, onNavigate, placings }: DuelResultScreenProps) {
  const described = useMemo(() => describeDuelResult(room), [room]);
  const model = useMemo(() => {
    if (!placings || placings.length === 0) return described;
    const order = new Map(placings.map((entry, index) => [entry.seat, index]));
    const scores = [...described.scores].sort((a, b) => (order.get(a.seat) ?? 99) - (order.get(b.seat) ?? 99));
    return { ...described, scores };
  }, [described, placings]);
  const placeOf = useMemo(() => new Map((placings ?? []).map((entry) => [entry.seat, entry])), [placings]);
  const { outcome } = model;
  // A spectator whose next game is already live gets "Watch game N" as the main button; leaving steps back.
  const watching = room.series ? spectatorSeriesStatus(room, slug) : null;
  const leaveKind = watching?.kind === "next-live" && watching.follow ? "secondary" : "primary";
  const host = useSyncExternalStore(subscribeNever, readBody, readNoBody);
  const rootRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const reasonId = useId();
  const [skipped, setSkipped] = useState(false);
  const [timedOut, setTimedOut] = useState(false);
  const settled = reducedMotion || skipped || timedOut;

  const settle = useCallback(() => setSkipped(true), []);

  // The intro ends on its own; a skip (click, Space, Esc, Tab) jumps to the same frame.
  useEffect(() => {
    if (settled) return undefined;
    const timer = duelFxClock.setTimeout(() => setTimedOut(true), INTRO_MS);
    return () => duelFxClock.clearTimeout(timer);
  }, [settled]);

  // Move focus into the dialog, keep it there, and give it back on close.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    root.focus({ preventScroll: true });
    const onFocusIn = (event: FocusEvent) => {
      if (event.target instanceof Node && !root.contains(event.target)) root.focus({ preventScroll: true });
    };
    document.addEventListener("focusin", onFocusIn);
    return () => {
      document.removeEventListener("focusin", onFocusIn);
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, [host]);

  const onKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    const root = rootRef.current;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      if (!settled) settle();
      else onClose();
      return;
    }
    if ((event.key === " " || event.key === "Spacebar") && event.target === event.currentTarget) {
      event.preventDefault();
      if (!settled) settle();
      return;
    }
    if (event.key !== "Tab" || !root) return;
    if (!settled) settle();
    const nodes = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (nodes.length === 0) {
      event.preventDefault();
      return;
    }
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === root)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }, [onClose, settle, settled]);

  if (!host) return null;

  const canReplay = room.session.status === "completed" || room.session.status === "interrupted";
  // A player who is between games has the solid "Ready for next game" in the series block: leaving steps back.
  const readyHere = room.series != null && seriesPlayerIndex(room, room.series) != null && isBetweenGames(room, slug);
  const leaveKindNow = readyHere ? "secondary" : leaveKind;
  const actionCount = canReplay ? 3 : 2;
  const tray = placings || model.scores.length !== 2 ? "rows" : "duo";

  return createPortal(
    <div
      ref={rootRef}
      className={`${duelFontClasses} ${styles.root}`}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={model.reason ? reasonId : undefined}
      tabIndex={-1}
      data-testid="duel-result"
      data-duel-fx-speed-root
      data-outcome={outcome}
      data-title={titleKindOf(outcome)}
      data-phase={settled ? "settled" : "play"}
      data-reduced={reducedMotion ? "true" : "false"}
      data-series={room.series ? "true" : undefined}
      onKeyDown={onKeyDown}
      onClick={() => {
        if (!settled) settle();
      }}
    >
      <div className={styles.backdrop} aria-hidden="true" />
      <div className={styles.flash} aria-hidden="true" />

      <div className={styles.scroll}>
        <div className={styles.col}>
          <div className={styles.hero}>
            <div className={styles.light} aria-hidden="true" />
            <ResultTitle id={titleId} text={model.headline} outcome={outcome} />
            {model.reason ? <p id={reasonId} className={styles.reason}>{model.reason}</p> : null}
          </div>

          {model.scores.length > 0 ? (
            <ul className={styles.scoreboard} aria-label={placings ? "Final standings" : "Final Life Points"} data-layout={tray} data-placings={placings ? "true" : undefined}>
              {model.scores.map((score) => (
                <li key={score.seat} className={styles.score} data-winner={score.isWinner ? "true" : "false"} data-out={score.lp <= 0 ? "true" : "false"} data-seat={score.seat}>
                  {placeOf.has(score.seat) ? (
                    <span className={styles.place} data-place={placeOf.get(score.seat)?.place}>{placeOf.get(score.seat)?.label}</span>
                  ) : null}
                  {score.deckMaster ? (
                    <img
                      className={styles.dmArt}
                      src={cardArtUrl(score.deckMaster.code, "small")}
                      alt=""
                      draggable={false}
                      onError={(event) => { event.currentTarget.style.visibility = "hidden"; }}
                    />
                  ) : null}
                  <div className={styles.scoreText}>
                    <span className={styles.scoreName}>
                      <span className={styles.name}>{score.name}</span>
                      {score.isMe ? <span className={styles.tag} data-tag="you">You</span> : null}
                      {score.isWinner ? <span className={styles.tag} data-tag="winner">Winner</span> : null}
                    </span>
                    <span className={styles.scoreLp}>
                      <b>{formatLp(score.lp)}</b>
                      <i className={styles.lpUnit} aria-hidden="true">LP</i>
                      <span className={styles.srOnly}> Life Points</span>
                    </span>
                    {score.deckMaster ? <span className={styles.dmName}>{score.deckMaster.name}</span> : null}
                  </div>
                </li>
              ))}
            </ul>
          ) : null}

          {room.series ? (
            <SeriesResult room={room} slug={slug} onChanged={onSeriesChanged} onNavigate={onNavigate} />
          ) : null}

          <div className={styles.actions} data-lead={leaveKindNow === "primary" ? "true" : "false"} style={{ "--n": actionCount - 1 } as CSSProperties}>
            {onExit ? (
              <button type="button" className={styles.btn} data-kind={leaveKindNow} onClick={onExit}>Exit duel</button>
            ) : (
              <Link href="/duels" className={styles.btn} data-kind={leaveKindNow}>Back to tables</Link>
            )}
            {canReplay ? (
              <Link href={`/duels/${slug}/replay`} className={styles.btn} data-kind="secondary">Watch replay</Link>
            ) : null}
            <button type="button" className={styles.btn} data-kind="quiet" onClick={onClose}>View board</button>
          </div>
        </div>
      </div>
    </div>,
    host,
  );
}
