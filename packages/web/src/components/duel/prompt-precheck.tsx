"use client";

import { useEffect, useRef } from "react";
import type { DuelCardInfo } from "@yugidraft/shared/duels";
import { cardArtUrl } from "./constants";
import styles from "./prompt-precheck.module.css";

/** One thumbnail on the bar. `card` is what the left inspector shows on hover or focus. */
export interface PrecheckCard {
  code: number;
  card?: DuelCardInfo;
}

export interface PrecheckBarProps {
  /** Source card name, or "N effects". */
  name: string;
  /** The question: "You can activate an effect. Activate?" */
  ask: string;
  /** Short phase / step line, empty when there is none. */
  context: string;
  cards: readonly PrecheckCard[];
  tone: "chain" | "action";
  busy: boolean;
  reducedMotion: boolean;
  onYes: () => void;
  onNo: () => void;
  onInspectCard?: (card: DuelCardInfo) => void;
}

/**
 * The compact "you can activate an effect, use it?" bar. It sits in the middle of the board, like the
 * select bar, so it is easy to see; it is small so the field stays readable. Only the bar takes pointer events. Enter / Y answer Yes and Esc / N answer No through the
 * key handler in PromptCenter, which owns every shortcut of the response prompts.
 */
export function PrecheckBar({ name, ask, context, cards, tone, busy, reducedMotion, onYes, onNo, onInspectCard }: PrecheckBarProps) {
  const yesRef = useRef<HTMLButtonElement>(null);
  // Focus Yes so Enter answers it, as the response panel focuses its primary button.
  useEffect(() => {
    yesRef.current?.focus({ preventScroll: true });
  }, []);

  return (
    <div
      className={styles.bar}
      data-prompt-panel
      data-precheck
      data-tone={tone}
      data-reduced={reducedMotion ? "true" : "false"}
      role="group"
      aria-label={`${name}. ${ask}`}
      aria-live="polite"
    >
      <div className={styles.thumbs} data-count={cards.length}>
        {cards.map((entry, index) => (
          <span
            key={`${entry.code}:${index}`}
            className={styles.thumb}
            tabIndex={entry.card && onInspectCard ? 0 : undefined}
            onMouseEnter={() => {
              if (entry.card) onInspectCard?.(entry.card);
            }}
            onFocus={() => {
              if (entry.card) onInspectCard?.(entry.card);
            }}
          >
            <img src={cardArtUrl(entry.code, "small")} alt="" draggable={false} />
          </span>
        ))}
      </div>
      <div className={styles.text}>
        <b title={name}>{name}</b>
        <span className={styles.ask}>{ask}</span>
        {context ? <small className={styles.context}>{context}</small> : null}
      </div>
      <div className={styles.btns}>
        <button
          ref={yesRef}
          type="button"
          className={styles.btn}
          data-kind="primary"
          data-primary
          disabled={busy}
          aria-keyshortcuts="Y Enter"
          title="Yes (Y or Enter)"
          onClick={onYes}
        >
          Yes
        </button>
        <button
          type="button"
          className={styles.btn}
          disabled={busy}
          aria-keyshortcuts="N Escape"
          title="No (N or Esc). Right-click also says no."
          onClick={onNo}
        >
          No
        </button>
      </div>
    </div>
  );
}
