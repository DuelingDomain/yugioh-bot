"use client";

import * as React from "react";
import { FloorList, FloorRow } from "@/components/sheet";
import { FINISHED_PREVIEW, formatLabel, playersLabel, tournamentHref, type TournamentListItem } from "./tournaments-list-model";
import styles from "./tournament-row.module.css";

/**
 * Finished tournaments: newest first, the first few rows, then "Show all N".
 * Champion and ended date need data the list query does not read yet, so they are left out.
 */
export function FinishedLedger({ items }: { items: TournamentListItem[] }) {
  const [all, setAll] = React.useState(false);
  const shown = all ? items : items.slice(0, FINISHED_PREVIEW);
  const hidden = items.length - shown.length;
  return (
    <>
      <FloorList aria-label="Finished tournaments">
        {shown.map((t) => (
          <FloorRow
            key={t.id}
            href={tournamentHref(t)}
            cols="minmax(0, 1fr) 190px 110px"
            phoneCols="minmax(0, 1fr) auto"
            phoneAreas={'"nm pl" "fm fm"'}
          >
            <span className={`sv-cell-grow ${styles.finName}`}>{t.name}</span>
            <span className={`sv-cell-mute ${styles.finFormat}`}>{formatLabel(t.format)}</span>
            <span className={`sv-cell-mute sv-cell-end ${styles.finPlayers}`}>{playersLabel(t.participantCount)}</span>
          </FloorRow>
        ))}
      </FloorList>
      {hidden > 0 && (
        <button type="button" className={styles.more} onClick={() => setAll(true)}>
          Show all {items.length}
        </button>
      )}
    </>
  );
}
