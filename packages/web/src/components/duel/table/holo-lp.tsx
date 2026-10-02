"use client";

import type { CSSProperties } from "react";
import { LifePoints } from "../life-points";
import { hexToRgbTriplet } from "./seat-angle";
import { SEAT_TONE_HEX, type SeatStatus, type SeatTone } from "./types";
import styles from "./holo-lp.module.css";

export interface HoloLpProps {
  seat: number;
  name: string;
  tone: SeatTone;
  lp: number | null;
  /** Cards in hand and in the Deck, shown under the numerals. */
  handCount: number;
  deckCount: number;
  /** Clock left of this seat in ms, or null when the duel has no clock. */
  clockMs: number | null;
  status: SeatStatus;
  /** True for the viewer's own panel: a little larger, no projector beam. */
  me: boolean;
  /** Top-left of the panel in stage px. */
  x: number;
  y: number;
  beam: "down" | "up" | "none";
  /** This panel can be chosen now (an opponent pick or a direct attack): dashed ring and a key hint. */
  legal?: boolean;
  hotkey?: number | null;
  onPick?: () => void;
  onHover?: (hover: boolean) => void;
  reducedMotion: boolean;
}

const STATE_LABEL: Partial<Record<SeatStatus, string>> = {
  leaving: "Leaving",
  eliminated: "Eliminated",
};

export function formatClock(ms: number | null): string | null {
  if (ms == null || !Number.isFinite(ms)) return null;
  const total = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function HandIcon() {
  return (
    <svg viewBox="0 0 12 12" width="11" height="11" aria-hidden="true">
      <rect x="2.5" y="1.5" width="7" height="9" rx="1" fill="none" stroke="currentColor" strokeWidth="1.1" />
    </svg>
  );
}

function DeckIcon() {
  return (
    <svg viewBox="0 0 12 12" width="11" height="11" aria-hidden="true">
      <rect x="3.5" y="0.8" width="6.5" height="8.2" rx="1" fill="none" stroke="currentColor" strokeWidth="1" />
      <path d="M2 3v7.4c0 .4.3.8.8.8H8" fill="none" stroke="currentColor" strokeWidth="1" />
    </svg>
  );
}

/**
 * One holo life-point panel. It floats over the plaza at a fixed anchor and owns `data-lp-seat` for its seat:
 * damage effects aim at the numerals, and the seat field hides its own tally (`showTally = false`).
 */
export function HoloLp({
  seat,
  name,
  tone,
  lp,
  handCount,
  deckCount,
  clockMs,
  status,
  me,
  x,
  y,
  beam,
  legal = false,
  hotkey = null,
  onPick,
  onHover,
  reducedMotion,
}: HoloLpProps) {
  const hex = SEAT_TONE_HEX[tone];
  const stateLabel = STATE_LABEL[status];
  const turn = status === "turn";
  const out = status === "eliminated";
  const clock = formatClock(clockMs);
  const style: CSSProperties & Record<string, string | number> = {
    "--t": hexToRgbTriplet(hex.main),
    "--tink": hex.ink,
    translate: `${x}px ${y}px`,
  };
  const body = (
    <>
      <div className={styles.top}>
        <i aria-hidden="true" />
        <b>{me ? `${name} (you)` : name}</b>
        {turn ? <span className={styles.turnChip}>Turn</span> : null}
      </div>
      <div className={styles.main} data-lp-seat={seat}>
        <LifePoints value={lp} reducedMotion={reducedMotion} size={me ? "lg" : "sm"} />
      </div>
      <div className={styles.meta}>
        <span title="Cards in hand">
          <HandIcon />
          {handCount}
        </span>
        <span title="Cards in Deck">
          <DeckIcon />
          {deckCount}
        </span>
        {clock ? <span className={styles.clock}>{clock}</span> : null}
      </div>
      {stateLabel ? <div className={styles.state}>{stateLabel}</div> : null}
      {status === "choosing" ? <div className={styles.think}>choosing...</div> : null}
    </>
  );
  return (
    <div
      className={styles.holo}
      style={style}
      data-holo={seat}
      data-seat={seat}
      data-tone={tone}
      data-me={me ? "true" : undefined}
      data-turn={turn ? "true" : undefined}
      data-active={turn || status === "choosing" ? "true" : undefined}
      data-elim={out ? "true" : undefined}
      data-leaving={status === "leaving" ? "true" : undefined}
      data-legal={legal ? "true" : undefined}
      data-beam={beam}
      data-status={status}
      onMouseEnter={legal ? () => onHover?.(true) : undefined}
      onMouseLeave={legal ? () => onHover?.(false) : undefined}
    >
      {legal ? (
        <button
          type="button"
          className={styles.pick}
          onClick={onPick}
          aria-label={`Choose ${name}`}
          data-testid={`holo-pick-${seat}`}
        >
          <span className={styles.ring} aria-hidden="true" />
          {hotkey != null ? <span className={styles.key}>{hotkey}</span> : null}
          <div className={styles.body}>{body}</div>
        </button>
      ) : (
        <div className={styles.body}>{body}</div>
      )}
      <span className={styles.beam} aria-hidden="true" />
    </div>
  );
}

/** Which state a panel shows for a seat. The camera step may replace it with its own `seatStatus`. */
export function holoStatus(
  engine: { turnSeat: number; seats: ReadonlyArray<{ seat: number; eliminated?: boolean; pendingElimination?: boolean }> },
  seat: number,
  promptSeat: number | null,
): SeatStatus {
  const view = engine.seats.find((entry) => entry.seat === seat);
  if (view?.eliminated) return "eliminated";
  if (view?.pendingElimination) return "leaving";
  if (promptSeat === seat) return "choosing";
  if (engine.turnSeat === seat) return "turn";
  return "active";
}
