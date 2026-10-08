"use client";

import type { CSSProperties, ReactNode } from "react";
import { Lock } from "lucide-react";
import type { DuelEngineView, DuelPrompt } from "@yugidraft/shared/duels";
import { hexToRgbTriplet } from "../table/seat-angle";
import { attackLockAt } from "../table/seat-state";
import { SEAT_TONE_HEX, type SeatTone } from "../table/types";
import { batonOrder } from "./tag-logic";
import styles from "./tag-track.module.css";

/** Seat tones of the Rooftop when the caller has no layout: the seats alternate by team. */
const DEFAULT_TONES: readonly SeatTone[] = ["violet", "ice", "verdant", "rose"];

export interface TagTrackProps {
  engine: Pick<DuelEngineView, "turn" | "turnSeat" | "seats">;
  nameOf: (seat: number) => string;
  /** The open prompt: an offer of the Battle Phase lifts the lock early, like the 3 and 4 seat table. */
  prompt?: DuelPrompt | null;
  /** The tone of a seat from the roof layout. Defaults to the fixed tones of the four seats. */
  toneOf?: (seat: number) => { main: string; ink: string };
  /** The station track mounts here, under the baton. */
  children?: ReactNode;
}

/**
 * The baton of the Rooftop (1A, 2A, 1B, 2B) with the turn player lit. The track shows it under the header; the floating
 * HUD shows it in the middle pill of the top row.
 */
export function TagBaton({ engine, nameOf, toneOf }: Pick<TagTrackProps, "engine" | "nameOf" | "toneOf">) {
  const outSeats = new Set(engine.seats.filter((seat) => seat.eliminated).map((seat) => seat.seat));
  const tone = (seat: number) => toneOf?.(seat) ?? SEAT_TONE_HEX[DEFAULT_TONES[seat % 4]];
  return (
    <ol className={styles.baton} aria-label="Turn order" data-baton-strip>
      {batonOrder(engine.turnSeat).map((stop, index) => {
        const hex = tone(stop.seat);
        const style = { "--seat": hexToRgbTriplet(hex.main), "--seat-ink": hex.ink } as CSSProperties;
        return (
          <li
            key={stop.seat}
            style={style}
            data-now={stop.now ? "true" : undefined}
            data-next={stop.next ? "true" : undefined}
            data-out={outSeats.has(stop.seat) ? "true" : undefined}
            aria-current={stop.now ? "step" : undefined}
          >
            {index > 0 ? <span className={styles.arrow} aria-hidden="true">&rarr;</span> : null}
            <b>{stop.code}</b>
            <span>{nameOf(stop.seat).split(" ")[0]}</span>
            {stop.now ? <em>now</em> : stop.next ? <em>next</em> : null}
          </li>
        );
      })}
    </ol>
  );
}

/**
 * The turn track of the live Rooftop: the baton (1A, 2A, 1B, 2B) with the turn player lit and the attack lock marker while attacks are shut (turns 1 to 3; the first Battle Phase is turn 4).
 */
export function TagTrack({ engine, nameOf, prompt = null, toneOf, children }: TagTrackProps) {
  const lock = attackLockAt("tag", engine.seats.length || 4, engine.turn, prompt);
  return (
    <div className={styles.track} data-tag-track>
      <div className={styles.row}>
        <TagBaton engine={engine} nameOf={nameOf} toneOf={toneOf} />
        {lock ? (
          <span
            className={styles.lock}
            data-testid="tag-attack-lock"
            title={`No attacks until turn ${lock.firstTurn}`}
          >
            <Lock size={12} strokeWidth={1.75} aria-hidden />
            Attacks locked &middot; Battle Phase opens on turn {lock.firstTurn}
          </span>
        ) : null}
      </div>
      {children}
    </div>
  );
}
