"use client";

import type { CSSProperties, ReactNode } from "react";
import type { DuelCardInfo } from "@yugidraft/shared/duels";
import { cardArtUrl } from "../constants";
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
  /** The fly-in pump places this panel with `style.transform`: the anchor translate is zero. */
  floating?: boolean;
  /** LP this seat lost last (its newest LP event): the old LP is struck out and a "-1,200" chip shows beside the numerals. */
  lastDamage?: number | null;
  /** A rival's Deck Master: a small art thumb at the top right of the panel. A click inspects it. */
  master?: DuelCardInfo | null;
  onInspectMaster?: (card: DuelCardInfo) => void;
  /** The seat just left the duel: the LP is struck out, a chip says its place ("Eliminated, 3rd"), and the panel fades away. */
  exiting?: boolean;
  placeLabel?: string | null;
  /** The seats regroup after an elimination: the panel waits, then glides to its new corner. */
  glide?: boolean;
  /** Hangs under the panel (your Deck Master chip). It sits outside the panel body, so it never changes the panel's own box. */
  footer?: ReactNode;
  /** The footer chip stays within the panel's width. */
  footerTight?: boolean;
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
  floating = false,
  master = null,
  onInspectMaster,
  lastDamage = null,
  exiting = false,
  placeLabel = null,
  glide = false,
  footer = null,
  footerTight = false,
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
    translate: floating ? "0px 0px" : `${x}px ${y}px`,
  };
  const body = (
    <>
      <div className={styles.top}>
        <i aria-hidden="true" />
        <b>{me ? `${name} (you)` : name}</b>
        {turn ? <span className={styles.turnChip}>Turn</span> : null}
      </div>
      <div className={styles.main} data-lp-seat={seat}>
        <LifePoints value={lp} reducedMotion={reducedMotion} size={me ? "lg" : "sm"} showChange={false} />
        {lastDamage != null && lastDamage > 0 && lp != null ? (
          <span className={styles.hit} data-damage-chip title="Last damage">
            <s aria-label="LP before">{(lp + lastDamage).toLocaleString("en-US")}</s>
            <b>-{lastDamage.toLocaleString("en-US")}</b>
          </span>
        ) : null}
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
      {stateLabel && !exiting ? <div className={styles.state}>{out && placeLabel ? `Eliminated, ${placeLabel}` : stateLabel}</div> : null}
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
      data-exiting={exiting ? "true" : undefined}
      data-glide={glide ? "true" : undefined}
      data-leaving={status === "leaving" ? "true" : undefined}
      data-legal={legal ? "true" : undefined}
      data-beam={beam}
      data-floating={floating ? "true" : undefined}
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
      {master ? (
        <button
          type="button"
          className={styles.master}
          data-master-thumb={seat}
          aria-label={`${name}'s Master: ${master.name}`}
          title={`${name}'s Master: ${master.name}`}
          onClick={() => onInspectMaster?.(master)}
        >
          <img src={cardArtUrl(master.code, "small")} alt="" draggable={false} />
        </button>
      ) : null}
      {exiting ? <span className={styles.exitChip} data-exit-chip>{placeLabel ? `Eliminated, ${placeLabel}` : "Eliminated"}</span> : null}
      <span className={styles.beam} aria-hidden="true" />
      {footer ? <div className={styles.footer} data-tight={footerTight ? "true" : undefined}>{footer}</div> : null}
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
