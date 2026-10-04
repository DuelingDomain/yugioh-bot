"use client";

import type { KeyboardEvent } from "react";
import { DUEL_CHAIN_MODES, type DuelChainMode } from "@yugidraft/shared/duels";
import { CHAIN_MODE_HINT, CHAIN_MODE_LABEL } from "./chain-mode";
import type { ChainModeControl } from "./use-chain-mode";
import styles from "./chain-mode-switch.module.css";

/**
 * The Auto / Always / Off switch for your own response windows. It sits in the station track's actions slot and
 * has no state of its own: the mode comes from the server through the room view, the click goes back the same way.
 * Violet marks Auto and Always; Off is gold, because it is the state that can cost you a play.
 */
export function ChainModeSwitch({ mode, onChange }: ChainModeControl) {
  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1
      : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();
    const next = DUEL_CHAIN_MODES[(index + step + DUEL_CHAIN_MODES.length) % DUEL_CHAIN_MODES.length];
    onChange(next);
    const group = event.currentTarget.parentElement;
    group?.querySelector<HTMLButtonElement>(`button[data-mode="${next}"]`)?.focus();
  }

  return (
    <div className={styles.root} data-mode={mode} data-testid="chain-mode-switch"
      role="radiogroup" aria-label="Chain responses" aria-keyshortcuts="R">
      <span className={styles.label} aria-hidden="true">
        Responses<kbd className={styles.key}>R</kbd>
      </span>
      <div className={styles.seg}>
        {DUEL_CHAIN_MODES.map((entry: DuelChainMode, index) => (
          <button
            key={entry}
            type="button"
            role="radio"
            aria-checked={entry === mode}
            tabIndex={entry === mode ? 0 : -1}
            className={styles.option}
            data-mode={entry}
            title={CHAIN_MODE_HINT[entry]}
            onClick={() => { if (entry !== mode) onChange(entry); }}
            onKeyDown={(event) => onKeyDown(event, index)}
          >
            {CHAIN_MODE_LABEL[entry]}
          </button>
        ))}
      </div>
      <span className={styles.srOnly} role="status" aria-live="polite" aria-atomic="true">
        Responses: {CHAIN_MODE_LABEL[mode]}
      </span>
    </div>
  );
}
