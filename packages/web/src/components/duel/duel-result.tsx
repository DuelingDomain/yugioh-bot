"use client";

import { duelFxClock } from "./fx-clock";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import type { DuelRoom } from "@yugidraft/shared/duels";
import { cardArtUrl, formatLp } from "./constants";
import { duelFontClasses } from "./fonts";
import styles from "./duel-result.module.css";
import seriesStyles from "./series.module.css";
import { SeriesBadges } from "./series-banner";
import { SeriesNextControls } from "./series-next";
import { betweenGamesInfo, isBetweenGames, seriesOutcome, seriesPlayerIndex, seriesRecordLabel, seriesScoreForViewer } from "./series-model";


/** The longest animation ends near 1.55 s; the timer settles just after it. */
const INTRO_MS = 1650;

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
  const loserSeat = winnerSeat === 0 ? 1 : winnerSeat === 1 ? 0 : null;
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
          isWinner: session.status !== "interrupted" && winnerSeat != null && seat.seat === winnerSeat,
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
  const reason = reasonLine(kind, raw, loser);
  if (mySeat == null) {
    return { outcome: "spectator", headline: `${seatName(room, winnerSeat)} wins`, winnerSeat, reasonKind: kind, reason, scores };
  }
  return mySeat === winnerSeat
    ? { outcome: "win", headline: "YOU WIN", winnerSeat, reasonKind: kind, reason, scores }
    : { outcome: "lose", headline: "YOU LOSE", winnerSeat, reasonKind: kind, reason, scores };
}

// ---------------------------------------------------------------------------
// Geometry (computed once; rounded so every render prints the same numbers)
// ---------------------------------------------------------------------------

const RAY_COUNT = 36;
const n2 = (value: number) => value.toFixed(2);
const polar = (radius: number, angle: number) => `${n2(radius * Math.cos(angle))} ${n2(radius * Math.sin(angle))}`;

/** Alternating wedges fanning from the centre: the sunburst. */
const RAY_WEDGES = Array.from({ length: RAY_COUNT }, (_, index) => {
  const start = (index * 2 * Math.PI) / RAY_COUNT;
  return `M0 0L${polar(100, start)}L${polar(100, start + Math.PI / RAY_COUNT)}Z`;
}).join("");

/** Twelve long hairline rays that cut through the wedges. */
const RAY_HAIRLINES = Array.from({ length: 12 }, (_, index) => {
  const angle = (index * 2 * Math.PI) / 12 + Math.PI / 12;
  return `M${polar(22, angle)}L${polar(100, angle)}`;
}).join("");

/** Star polygon {points/step}: one closed path that skips `step` vertices each time. */
function starPath(points: number, step: number, radius: number): string {
  const vertices = Array.from({ length: points }, (_, index) => {
    const angle = (((index * step) % points) * 2 * Math.PI) / points - Math.PI / 2;
    return polar(radius, angle);
  });
  return `M${vertices.join("L")}Z`;
}

const STAR_OUTER = starPath(12, 5, 47);
const STAR_INNER = starPath(8, 3, 27);

const TICKS = Array.from({ length: 72 }, (_, index) => {
  const angle = (index * 2 * Math.PI) / 72;
  const long = index % 6 === 0;
  return `M${polar(long ? 63 : 64.5, angle)}L${polar(67, angle)}`;
}).join("");

/** Four small diamonds at the compass points of the main ring. */
const GEMS = [0, 1, 2, 3].map((index) => {
  const angle = (index * Math.PI) / 2;
  return `M${polar(47, angle)}m-1.7 0l1.7-2.4 1.7 2.4-1.7 2.4z`;
});

function SunburstRays() {
  return (
    <svg className={styles.raysSvg} viewBox="-100 -100 200 200" aria-hidden="true" focusable="false">
      <path className={styles.wedges} d={RAY_WEDGES} />
      <path className={styles.hairRays} d={RAY_HAIRLINES} />
    </svg>
  );
}

function Rosette() {
  return (
    <svg className={styles.rosette} viewBox="-100 -100 200 200" aria-hidden="true" focusable="false">
      <circle className={styles.ringSoft} r="70" />
      <circle className={styles.ringRule} r="47" />
      <circle className={styles.ringDots} r="44" />
      <circle className={styles.ringSoft} r="27" />
      <path className={styles.ticks} d={TICKS} />
      <path className={styles.starOuter} d={STAR_OUTER} />
      <path className={styles.starInner} d={STAR_INNER} />
      {GEMS.map((gem) => (
        <path key={gem} className={styles.gem} d={gem} />
      ))}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const FOCUSABLE = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])';

function wordmarkTier(text: string): "xl" | "lg" | "md" | "sm" {
  const length = text.length;
  return length <= 8 ? "xl" : length <= 12 ? "lg" : length <= 18 ? "md" : "sm";
}

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
  return (
    <section className={styles.seriesBlock} aria-label="Series">
      <SeriesBadges series={series} hideScore />
      {outcome ? (
        <div className={seriesStyles.result}>
          <p className={seriesStyles.resultHead}>{outcome.headline}</p>
          <p className={seriesStyles.resultLine}>{outcome.detail}</p>
          {record ? <p className={seriesStyles.resultRecord}>{record}</p> : null}
        </div>
      ) : info ? (
        <div className={seriesStyles.result} data-testid="between-games-info">
          <p className={seriesStyles.resultHead}>{info.result}</p>
          <p className={seriesStyles.resultLine}>Up next: <b>{info.next}</b></p>
          <p className={seriesStyles.resultRecord}>{info.first}</p>
        </div>
      ) : (
        <p className={seriesStyles.resultLine}>
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

export function DuelResultScreen({ room, slug, reducedMotion, onClose, onExit, onSeriesChanged, onNavigate }: DuelResultScreenProps) {
  const model = useMemo(() => describeDuelResult(room), [room]);
  const { outcome } = model;
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

  const burst = outcome === "win" || outcome === "spectator" || outcome === "draw" || outcome === "lose";
  const canReplay = room.session.status === "completed" || room.session.status === "interrupted";
  const tier = wordmarkTier(model.headline);

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
      data-outcome={outcome}
      data-phase={settled ? "settled" : "play"}
      data-reduced={reducedMotion ? "true" : "false"}
      data-spin={outcome === "win" || outcome === "spectator" ? "true" : "false"}
      onKeyDown={onKeyDown}
      onClick={() => {
        if (!settled) settle();
      }}
    >
      <div className={styles.backdrop} aria-hidden="true" />
      <div className={styles.frame} aria-hidden="true">
        <span className={styles.corner} data-corner="tl" />
        <span className={styles.corner} data-corner="tr" />
        <span className={styles.corner} data-corner="bl" />
        <span className={styles.corner} data-corner="br" />
      </div>

      <div className={styles.stage}>
        <div className={styles.hero}>
          {burst ? (
            <div className={styles.burst} aria-hidden="true">
              <div className={styles.raysSpin}>
                <SunburstRays />
              </div>
              <Rosette />
            </div>
          ) : null}

          <h1 id={titleId} className={styles.wordmark} data-tier={tier}>
            <span className={styles.srOnly}>{model.headline}</span>
            <span className={styles.face} aria-hidden="true">
              {outcome === "lose"
                ? (["a", "b", "c"] as const).map((shard) => (
                    <span key={shard} className={styles.layer} data-shard={shard}>{model.headline}</span>
                  ))
                : <span className={styles.layer}>{model.headline}</span>}
              {outcome === "lose" ? (
                <svg className={styles.crack} viewBox="0 0 100 100" preserveAspectRatio="none" focusable="false">
                  <polyline points="41,-2 47,26 38,49 46,74 40,102" vectorEffect="non-scaling-stroke" />
                  <polyline points="69,-2 63,30 72,58 64,82 70,102" vectorEffect="non-scaling-stroke" />
                </svg>
              ) : null}
            </span>
          </h1>
        </div>

        {model.reason ? <p id={reasonId} className={styles.reason}>{model.reason}</p> : null}

        {model.scores.length > 0 ? (
          <ul className={styles.scoreboard} aria-label="Final Life Points">
            {model.scores.map((score) => (
              <li key={score.seat} className={styles.score} data-winner={score.isWinner ? "true" : "false"} data-out={score.lp <= 0 ? "true" : "false"}>
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
                    <span>{formatLp(score.lp)}</span>
                    <span className={styles.lpUnit} aria-hidden="true">LP</span>
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

        <div className={styles.actions}>
          {onExit ? (
            <button type="button" className={styles.btn} data-kind="primary" onClick={onExit}>Exit duel</button>
          ) : (
            <Link href="/duels" className={styles.btn} data-kind="primary">Back to tables</Link>
          )}
          {canReplay ? (
            <Link href={`/duels/${slug}/replay`} className={styles.btn} data-kind="secondary">Watch replay</Link>
          ) : null}
          <button type="button" className={styles.btn} data-kind="quiet" onClick={onClose}>View board</button>
        </div>
      </div>
      <div className={styles.flash} aria-hidden="true" />
    </div>,
    host,
  );
}
