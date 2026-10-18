"use client";

import * as React from "react";
import { Plus } from "lucide-react";
import { BugFabLift } from "@/components/bug-report/fab-lift";
import type { Batch } from "./selection";
import { EFFECT_SEARCH_ATTRIBUTION } from "./effect-api";
import styles from "./effect-search.module.css";

export const BATCH_COPY_CHOICES = [1, 2, 3] as const;
export const DEFAULT_BATCH_COPIES = 3;

/** The credit line for effect search. It shows wherever a description result, preview or health block shows. */
export function EffectCredit() {
  return <p className={styles.credit}>{EFFECT_SEARCH_ATTRIBUTION}</p>;
}

/**
 * The sticky bar under the list: how many cards are picked, how many copies each gets, and the one button that
 * adds them all. It shows only while the batch holds a card.
 */
export function BatchBar({
  batch,
  target,
  copies,
  onCopies,
  busy,
  note,
  onClear,
  onAdd,
}: {
  batch: Batch;
  /** What the cards go into, as one word: "cube" or "pool". */
  target: string;
  copies: number;
  onCopies: (copies: number) => void;
  busy?: boolean;
  /** One line under the bar, e.g. a refusal. */
  note?: React.ReactNode;
  onClear: () => void;
  onAdd: () => void;
}) {
  const id = React.useId();
  const n = batch.cards.size;
  if (n === 0 && !note) return null;
  return (
    <BugFabLift className={styles.bar} role="region" aria-label="Batch" data-testid="batch-bar">
      {n > 0 && (
        <>
          <span className={styles.barCount} role="status">
            {n} selected
          </span>
          <label className={styles.barCopies} htmlFor={id}>
            Copies each
            <select id={id} value={copies} onChange={(event) => onCopies(Number(event.target.value))} disabled={busy}>
              {BATCH_COPY_CHOICES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <span className={styles.barActs}>
            <button type="button" className="btn btn-quiet btn-sm" disabled={busy} onClick={onClear}>
              Clear
            </button>
            <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={onAdd} data-testid="batch-add">
              <Plus className="ic sm" aria-hidden="true" />
              Add {n} to {target}
            </button>
          </span>
        </>
      )}
      {note ? (
        <p className={styles.barNote} role="status">
          {note}
        </p>
      ) : null}
    </BugFabLift>
  );
}
