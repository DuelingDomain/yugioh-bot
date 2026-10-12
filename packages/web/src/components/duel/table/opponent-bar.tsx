import type { CSSProperties } from "react";
import { hexToRgbTriplet } from "./seat-angle";
import { SEAT_TONE_HEX, type SeatTone } from "./types";
import styles from "./opponent-bar.module.css";

export interface OpponentBarEntry {
  seat: number;
  name: string;
  tone: SeatTone;
  /** The number key that picks this rival (1 = first). */
  hotkey: number;
  /** This rival is the locked aim of a direct attack. */
  locked?: boolean;
}

export type OpponentBarKind = "pick" | "direct" | "confirm";

export interface OpponentBarProps {
  kind: OpponentBarKind;
  title: string;
  entries: readonly OpponentBarEntry[];
  onPick: (seat: number) => void;
  /** Locked aim: the Attack button and Esc. */
  onConfirm?: () => void;
  onCancel?: () => void;
  confirmLabel?: string;
  /** Plain words for the locked target, when `kind` is "confirm". */
  targetLabel?: string;
  /** Show Cancel with no locked aim (the aim before an attack is sent). */
  cancelable?: boolean;
}

/**
 * The bar over the board for a prompt that picks a rival: an opponent pick (click answers), a direct attack
 * (click locks the aim, a second click, Enter or Attack sends it) and the locked card target of an attack.
 * One button per living rival with its number key.
 */
export function OpponentBar({ kind, title, entries, onPick, onConfirm, onCancel, confirmLabel = "Attack", targetLabel, cancelable }: OpponentBarProps) {
  const locked = entries.find((entry) => entry.locked);
  return (
    <div className={styles.bar} data-opponent-bar={kind} role="group" aria-label={title}>
      <span className={styles.title}>{kind === "confirm" && targetLabel ? targetLabel : title}</span>
      {kind !== "confirm"
        ? entries.map((entry) => {
            const style: CSSProperties & Record<string, string> = {
              "--t": hexToRgbTriplet(SEAT_TONE_HEX[entry.tone].main),
              "--tink": SEAT_TONE_HEX[entry.tone].ink,
            };
            return (
              <button
                key={entry.seat}
                type="button"
                className={styles.rival}
                style={style}
                data-rival-seat={entry.seat}
                data-locked={entry.locked ? "true" : undefined}
                aria-pressed={entry.locked ? true : undefined}
                onClick={() => onPick(entry.seat)}
              >
                <kbd>{entry.hotkey}</kbd>
                <i aria-hidden="true" />
                {entry.name}
              </button>
            );
          })
        : null}
      {onConfirm && (kind === "confirm" || locked) ? (
        <button type="button" className={styles.confirm} onClick={onConfirm} data-testid="aim-confirm">
          {confirmLabel}
          <kbd>Enter</kbd>
        </button>
      ) : null}
      {onCancel && (kind === "confirm" || locked || cancelable) ? (
        <button type="button" className={styles.cancel} onClick={onCancel}>
          Cancel
          <kbd>Esc</kbd>
        </button>
      ) : null}
    </div>
  );
}
