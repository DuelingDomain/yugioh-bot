"use client";

import * as React from "react";
import { correctedHeading, skippedHeading, type ListDiagnostics } from "@/lib/card-list-import";
import styles from "./list-import-report.module.css";

/** Said when the server ran out of lookups. The cards it did not reach also come back in "unknown", so add the list again. */
export const LOOKUP_LIMITED_LINE = "Some cards were not looked up this time. Add the list again to look up the rest.";

/** "3 cards listed under Extra are not Extra Deck monsters - added to Main" */
export function movedToMainLine(n: number): string {
  return `${n === 1 ? "1 card" : `${n} cards`} listed under Extra ${n === 1 ? "is not an Extra Deck monster" : "are not Extra Deck monsters"} - added to Main`;
}

/**
 * What a list import left over: names it corrected, lines it skipped (section titles land here), cards the server
 * did not look up, and cards it moved to Main. `collapsed` keeps the two lists closed.
 */
export function ListImportReport({ unknown, corrected, lookupLimited, movedToMain, collapsed = false }: Partial<ListDiagnostics> & { collapsed?: boolean }) {
  const skipped = unknown ?? [];
  const fixed = corrected ?? [];
  const moved = movedToMain ?? 0;
  if (skipped.length === 0 && fixed.length === 0 && !lookupLimited && moved <= 0) return null;
  return (
    <div className={styles.report} data-testid="list-import-report">
      {lookupLimited && <p className={styles.note}>{LOOKUP_LIMITED_LINE}</p>}
      {moved > 0 && <p className={styles.note}>{movedToMainLine(moved)}</p>}
      {fixed.length > 0 && (
        <details className={styles.block} open={!collapsed && fixed.length <= 5}>
          <summary>{correctedHeading(fixed.length)}</summary>
          <ul aria-label="Corrected names">
            {fixed.map((c) => (
              <li key={`${c.from}>${c.to}`}>
                <span>{c.from}</span>
                <span aria-hidden="true"> → </span>
                <span className="sr-only"> became </span>
                <b>{c.to}</b>
              </li>
            ))}
          </ul>
        </details>
      )}
      {skipped.length > 0 && (
        <details className={styles.block}>
          <summary>{skippedHeading(skipped.length)}</summary>
          <ul aria-label="Skipped lines">
            {skipped.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
