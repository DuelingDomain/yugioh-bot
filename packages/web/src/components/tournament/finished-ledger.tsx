"use client";

import * as React from "react";
import Link from "next/link";
import { FINISHED_PREVIEW, formatLabel, tournamentHref, type TournamentListItem } from "./tournaments-list-model";
import styles from "./tournament-row.module.css";

/**
 * The finished ledger: newest first, the first few rows, then "Show all N".
 * Champion and ended date need data the list query does not read yet, so they are left out.
 */
export function FinishedLedger({ items }: { items: TournamentListItem[] }) {
  const [all, setAll] = React.useState(false);
  const shown = all ? items : items.slice(0, FINISHED_PREVIEW);
  const hidden = items.length - shown.length;
  return (
    <div className="ledger fin hr-frame">
      <table style={{ minWidth: 0 }}>
        <thead>
          <tr>
            <th style={{ paddingLeft: 18 }}>Tournament</th>
            <th>Format</th>
            <th className="r" style={{ paddingRight: 18 }}>
              Players
            </th>
          </tr>
        </thead>
        <tbody className={styles.fin}>
          {shown.map((t) => (
            <tr key={t.id}>
              <td className="t" style={{ paddingLeft: 18 }}>
                <Link href={tournamentHref(t)}>{t.name}</Link>
              </td>
              <td>{formatLabel(t.format)}</td>
              <td className="r v" style={{ paddingRight: 18 }}>
                {t.participantCount}
              </td>
            </tr>
          ))}
          {hidden > 0 && (
            <tr className="cut">
              <td colSpan={3}>
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
