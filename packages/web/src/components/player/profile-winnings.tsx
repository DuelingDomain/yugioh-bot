"use client";

import { useId, useState } from "react";
import Link from "next/link";
import { Trophy } from "lucide-react";
import { FloorRow, SectionHead, Zone } from "@/components/sheet";
import { formatDay, groupAwards, type AwardEntry } from "./profile-model";
import styles from "./profile.module.css";

/** The last winnings earned, grouped by event: a light-line heading per tournament, then floor rows. */
export function ProfileWinnings({ recent }: { recent: AwardEntry[] }) {
  const [expanded, setExpanded] = useState(false);
  const listId = useId();
  if (recent.length === 0) {
    return (
      <section className={styles.emptyWin} aria-labelledby="pf-win-empty">
        <Zone state="dashed" />
        <div>
          <h2 id="pf-win-empty">No winnings yet</h2>
          <p>Win a match or place in a tournament to earn some. Losses never cost winnings.</p>
        </div>
      </section>
    );
  }
  let entryOffset = 0;
  return (
    <section className={styles.winnings} aria-labelledby="pf-win" data-expanded={expanded}>
      <SectionHead
        id="pf-win"
        title="Winnings earned"
        note={<span className={styles.winningsNote}>The last 10, every season. Losses never take winnings away.</span>}
        action={
          recent.length > 3 ? (
            <button
              type="button"
              className={styles.expandLink}
              aria-controls={listId}
              aria-expanded={expanded}
              onClick={() => setExpanded((value) => !value)}
            >
              {expanded ? "Show fewer" : `Show ${recent.length}`}
            </button>
          ) : undefined
        }
      />
      <ul className="sv-rows" id={listId}>
        {groupAwards(recent).map((group, g) => {
          const offset = entryOffset;
          entryOffset += group.entries.length;
          return <GroupRows key={`${group.key}-${g}`} title={group.title} entries={group.entries} offset={offset} />;
        })}
      </ul>
    </section>
  );
}

function GroupRows({ title, entries, offset }: { title: string; entries: AwardEntry[]; offset: number }) {
  const tournamentId = entries[0]?.tournament_id ?? null;
  return (
    <>
      <li className={`${styles.turn}${offset >= 3 ? ` ${styles.collapsedItem}` : ""}`}>
        {tournamentId !== null ? <Link href={`/tournament/${tournamentId}`}>{title}</Link> : title}
      </li>
      {entries.map((entry, i) => {
        const placing = entry.kind === "placement";
        return (
          <FloorRow
            key={i}
            cols="22px minmax(0, 1fr) auto 64px"
            className={`${styles.award}${offset + i >= 3 ? ` ${styles.collapsedItem}` : ""}`}
          >
            <span className={styles.awardMark}>
              {placing ? <Trophy className={styles.trophy} aria-hidden /> : <Zone state="won" size="xs" />}
            </span>
            <span className={styles.awardName}>
              {placing ? "Placing" : "Match win"}
              {placing && <small>placing award</small>}
            </span>
            <small className={styles.awardDay}>{formatDay(entry.created_at)}</small>
            <span className={`up ${styles.gain}`}>+{entry.points}</span>
          </FloorRow>
        );
      })}
    </>
  );
}
