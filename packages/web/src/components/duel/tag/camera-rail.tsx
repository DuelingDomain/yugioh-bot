"use client";

import type { CSSProperties } from "react";
import styles from "./tag-camera.module.css";

export interface CameraRailSeat {
  seat: number;
  code: string;
  /** "r g b" triplet of the seat tone. */
  rgb: string;
}

/** The two camera actions the rail sends: both belong to the roof reducer and to the table camera alike. */
export type CameraRailAction = { type: "overview" } | { type: "focus"; seat: number };

export interface CameraRailProps {
  /** The seat the camera is close on. */
  focusSeat: number | null;
  seats: readonly CameraRailSeat[];
  nameOf: (seat: number) => string;
  /** Seats that are out of the duel: they stay listed but cannot be picked. */
  out?: ReadonlySet<number>;
  /** Seats with targets for the open prompt or aim: a soft dot on their button (the camera does not move for it). */
  hintSeats?: readonly number[];
  /** Reduced motion: the dot stays still. */
  calm?: boolean;
  dispatch: (action: CameraRailAction) => void;
}

/**
 * Shown only while the camera is close on one field: the way back to the overview (also the Esc key), and a small
 * switcher so another field is one tap away without a trip through the overview. The overview needs no rail.
 */
export function CameraRail({ focusSeat, seats, nameOf, out, hintSeats, calm, dispatch }: CameraRailProps) {
  return (
    <div className={styles.rail} data-camera-rail role="group" aria-label="Camera">
      <button type="button" className={styles.back} data-camera-back aria-label="Back to overview" title="Back to overview (Esc)" onClick={() => dispatch({ type: "overview" })}>
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M15 5l-7 7 7 7" />
        </svg>
        <span>Back to overview</span>
        <kbd aria-hidden="true">Esc</kbd>
      </button>
      <div className={styles.switch} role="group" aria-label="Switch field">
        {seats.map((entry) => {
          const hint = entry.seat !== focusSeat && (hintSeats?.includes(entry.seat) ?? false);
          return (
          <button
            key={entry.seat}
            type="button"
            className={styles.seat}
            style={{ ["--seat" as string]: entry.rgb } as CSSProperties}
            data-camera-seat-button={entry.seat}
            aria-pressed={entry.seat === focusSeat}
            data-targets={hint ? "true" : undefined}
            data-calm={hint && calm ? "true" : undefined}
            aria-label={hint ? `Focus ${nameOf(entry.seat)}'s field, it has targets` : `Focus ${nameOf(entry.seat)}'s field`}
            title={nameOf(entry.seat)}
            disabled={out?.has(entry.seat) === true}
            onClick={() => dispatch({ type: "focus", seat: entry.seat })}
          >
            {entry.code}
          </button>
          );
        })}
      </div>
    </div>
  );
}
