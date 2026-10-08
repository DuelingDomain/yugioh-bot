"use client";

import * as React from "react";
import { FloorList, FloorRow } from "@/components/sheet";
import { FINISHED_PREVIEW, draftHref, formatDay, kindLabel, playersLabel, type DraftListItem } from "./drafts-list-model";
import styles from "./drafts-list.module.css";

/** Completed and cancelled drafts, newest first (the page passes them sorted). Ten rows, then "Show all N". */
export interface FinishedLedgerProps {
  items: DraftListItem[];
  labelledBy?: string;
  /** Rows were loaded from further pages, so none stay hidden behind "Show all". */
  showAll?: boolean;
  /** Called when "Show all N" is pressed, so the list can hold back "Load more" until then. */
  onShowAll?: () => void;
}
export function FinishedLedger({ items, labelledBy, showAll = false, onShowAll }: FinishedLedgerProps) {
  const [all, setAll] = React.useState(false);
  const shown = all || showAll ? items : items.slice(0, FINISHED_PREVIEW);
  const hidden = items.length - shown.length;
  return (
    <>
      <FloorList aria-labelledby={labelledBy}>
        {shown.map((d) => (
          <FloorRow
            key={d.id}
            href={draftHref(d) ?? undefined}
            className={styles.row}
            cols="minmax(0, 1fr) 150px 110px 110px"
            phoneCols="minmax(0, 1fr) auto"
            phoneAreas={'"nm end" "kind players"'}
          >
            <span className={`sv-cell-name ${styles.name} ${styles.aNm}`}>{d.name}</span>
            <span className={`sv-cell-mute ${styles.kind} ${styles.aKind}`}>{kindLabel(d.config)}</span>
            <span className={`sv-cell-mute ${styles.players} ${styles.aPlayers}`}>{playersLabel(d.playerCount)}</span>
            <span className={`sv-cell-end ${styles.end} ${styles.aEnd}`}>
              {d.status === "cancelled" ? (
                <span className={styles.cancelled}>Cancelled</span>
              ) : (
                (formatDay(d.endedAt ?? d.createdAt) ?? "")
              )}
            </span>
          </FloorRow>
        ))}
      </FloorList>
      {hidden > 0 && (
        <button type="button" className={styles.more} onClick={() => { setAll(true); onShowAll?.(); }}>
          Show all {items.length}
        </button>
      )}
    </>
  );
}
