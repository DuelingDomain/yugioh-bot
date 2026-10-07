"use client";

import * as React from "react";
import { correctedHeading, skippedHeading, type ListDiagnostics } from "@/lib/card-list-import";
import styles from "./list-import-report.module.css";

/** What a list import left over: names it corrected, and lines it skipped (section titles land here). */
export function ListImportReport({ unknown, corrected }: Partial<ListDiagnostics>) {
  const skipped = unknown ?? [];
  const fixed = corrected ?? [];
  if (skipped.length === 0 && fixed.length === 0) return null;
  return (
    <div className={styles.report} data-testid="list-import-report">
      {fixed.length > 0 && (
        <details className={styles.block} open={fixed.length <= 5}>
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
