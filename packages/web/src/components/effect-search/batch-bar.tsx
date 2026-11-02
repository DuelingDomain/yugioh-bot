"use client";

import * as React from "react";
import { Plus } from "lucide-react";
import { BugFabLift } from "@/components/bug-report/fab-lift";
import { ThemedSelect } from "@/components/ui/themed-select";
import type { Batch } from "./selection";
import styles from "./effect-search.module.css";

export const BATCH_COPY_CHOICES = [1, 2, 3] as const;
export const DEFAULT_BATCH_COPIES = 3;
const COPY_OPTIONS = BATCH_COPY_CHOICES.map((value) => ({ value, label: String(value) }));

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
  const n = batch.cards.size;
  if (n === 0 && !note) return null;
  return (
    <BugFabLift className={styles.bar} role="region" aria-label="Batch" data-testid="batch-bar">
      {n > 0 && (
        <>
          <span className={styles.barCount} role="status">
            {n} selected
          </span>
          <div className={styles.barCopies}>
            <span aria-hidden="true">Copies each</span>
            <ThemedSelect
              hideLabel
              compact
              className={styles.barSelect}
              label="Copies each"
              value={copies}
              choices={COPY_OPTIONS}
              onChange={onCopies}
              disabled={busy}
            />
          </div>
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
