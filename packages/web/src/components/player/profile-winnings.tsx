"use client";

import { useId, useState } from "react";
import { Coins, Trophy } from "lucide-react";
import { HistoryRail, HistoryRow, HistoryTurn } from "@/components/sheet";
import { formatDay, groupAwards, type AwardEntry } from "./profile-model";
import styles from "./profile.module.css";

/** The duel-log style list of the last winnings earned, grouped by event. */
export function ProfileWinnings({ recent }: { recent: AwardEntry[] }) {
  const [expanded, setExpanded] = useState(false);
  const railId = useId();
  if (recent.length === 0) {
    return (
      <section aria-labelledby="pf-win-empty">
        <div className={`empty ${styles.empty}`}>
          <Coins className="ic" aria-hidden />
          <h2 id="pf-win-empty">No winnings yet</h2>
          <p>Win a match or place in a tournament to earn some. Losses never cost winnings.</p>
        </div>
      </section>
    );
  }
  let entryOffset = 0;
  return (
    <HistoryRail
      title="Winnings earned"
      headingLevel={2}
      className={styles.winnings}
      id={railId}
      data-expanded={expanded}
      aside={
        <>
          <small className={styles.winningsNote}>The last 10, every season. Losses never take winnings away.</small>
          {recent.length > 3 && (
            <button
              type="button"
              className={styles.expandLink}
              aria-controls={railId}
              aria-expanded={expanded}
              onClick={() => setExpanded((value) => !value)}
            >
              {expanded ? "Show fewer" : `Show ${recent.length}`}
            </button>
          )}
        </>
      }
    >
      {groupAwards(recent).map((group, g) => {
        const offset = entryOffset;
        entryOffset += group.entries.length;
        return <GroupRows key={`${group.key}-${g}`} title={group.title} entries={group.entries} offset={offset} />;
      })}
    </HistoryRail>
  );
}

function GroupRows({ title, entries, offset }: { title: string; entries: AwardEntry[]; offset: number }) {
  return (
    <>
      <HistoryTurn className={offset >= 3 ? styles.collapsedItem : undefined}>{title}</HistoryTurn>
      {entries.map((entry, i) => {
        const placing = entry.kind === "placement";
        return (
          <HistoryRow
            key={i}
            className={offset + i >= 3 ? styles.collapsedItem : undefined}
            own={placing ? "me" : "none"}
            score={placing ? <Trophy className="ic sm" aria-hidden /> : "W"}
            meta={<><span className="up">+{entry.points}</span><small>{formatDay(entry.created_at)}</small></>}
          >
            {placing ? "Placing" : "Match win"}
            {placing && <small>placing award</small>}
          </HistoryRow>
        );
      })}
    </>
  );
}
