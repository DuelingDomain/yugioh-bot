"use client";

import * as React from "react";
import Link from "next/link";
import { FINISHED_PREVIEW, draftHref, formatDay, kindLabel, type DraftListItem } from "./drafts-list-model";
import styles from "./drafts-list.module.css";

/** Completed and cancelled drafts, newest first (the page passes them sorted). Ten rows, then "Show all N". */
export function FinishedLedger({ items }: { items: DraftListItem[] }) {
  const [all, setAll] = React.useState(false);
  const shown = all ? items : items.slice(0, FINISHED_PREVIEW);
  const hidden = items.length - shown.length;
  return (
    <div className="ledger fin hr-frame">
      <table style={{ minWidth: 0 }}>
        <thead>
          <tr>
            <th style={{ paddingLeft: 18 }}>Draft</th>
            <th>Kind</th>
            <th className="r">Players</th>
            <th className="r" style={{ paddingRight: 18 }}>
              Ended
            </th>
          </tr>
        </thead>
        <tbody className={styles.fin}>
          {shown.map((d) => {
            const href = draftHref(d);
            return (
              <tr key={d.id}>
                <td className="t" style={{ paddingLeft: 18 }}>
                  {href ? <Link href={href}>{d.name}</Link> : d.name}
                </td>
                <td>{kindLabel(d.config)}</td>
                <td className="r v">{d.playerCount}</td>
                <td className="r" style={{ paddingRight: 18 }}>
                  {d.status === "cancelled" ? (
                    <span className="early">Cancelled</span>
                  ) : (
                    (formatDay(d.endedAt ?? d.createdAt) ?? "")
                  )}
                </td>
              </tr>
            );
          })}
          {hidden > 0 && (
            <tr className="cut">
              <td colSpan={4}>
                <button type="button" className={styles.more} onClick={() => setAll(true)}>
                  Show all {items.length}
                </button>
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
