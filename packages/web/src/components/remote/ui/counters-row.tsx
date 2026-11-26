"use client";

import s from "./counters-row.module.css";

/** Counters on a card on the field: minus, the count, plus. The server keeps the count (0 to 99) and the Log writes each change. */
export function CountersRow({ count, disabled, onChange }: { count: number; disabled?: boolean; onChange(delta: 1 | -1): void }) {
  return <div className={s.row} role="group" aria-label="Counters" data-testid="counters-row">
    <span className={s.label}>Counters</span>
    <button type="button" className={s.step} disabled={disabled || count <= 0} onClick={() => onChange(-1)} aria-label="Remove one counter" data-testid="counters-minus">{"−"}</button>
    <output className={s.count} aria-live="polite" data-testid="counters-count">{count}</output>
    <button type="button" className={s.step} disabled={disabled || count >= 99} onClick={() => onChange(1)} aria-label="Add one counter" data-testid="counters-plus">+</button>
  </div>;
}
