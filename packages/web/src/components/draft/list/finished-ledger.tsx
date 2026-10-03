"use client";

import * as React from "react";
import { FloorList, FloorRow } from "@/components/sheet";
import { FINISHED_PREVIEW, draftHref, formatDay, kindLabel, playersLabel, type DraftListItem } from "./drafts-list-model";
import styles from "./drafts-list.module.css";

/** Completed and cancelled drafts, newest first (the page passes them sorted). Ten rows, then "Show all N". */
export function FinishedLedger({ items, labelledBy }: { items: DraftListItem[]; labelledBy?: string }) {
  const [all, setAll] = React.useState(false);
  const shown = all ? items : items.slice(0, FINISHED_PREVIEW);
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
            <span className={`sv-cell-name ${styles.name}`} style={{ gridArea: "nm" }}>{d.name}</span>
            <span className={`sv-cell-mute ${styles.kind}`} style={{ gridArea: "kind" }}>{kindLabel(d.config)}</span>
            <span className={`sv-cell-mute ${styles.players}`} style={{ gridArea: "players" }}>{playersLabel(d.playerCount)}</span>
            <span className={`sv-cell-end ${styles.end}`} style={{ gridArea: "end" }}>
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
        <button type="button" className={styles.more} onClick={() => setAll(true)}>
          Show all {items.length}
        </button>
      )}
    </>
  );
}
