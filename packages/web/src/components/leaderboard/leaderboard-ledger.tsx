"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Flame } from "lucide-react";
import { RankGem, TierName } from "@/components/rank/rank-gem";
import sheet from "@/components/sheet/sheet.module.css";
import type { LeaderboardScope, PlayerPosition, Standing } from "./leaderboard-model";
import styles from "./leaderboard.module.css";

interface LedgerProps {
  standings: Standing[];
  scope: LeaderboardScope;
  position: PlayerPosition | null;
  loading: boolean;
}

export function LeaderboardLedger({ standings, scope, position, loading }: LedgerProps) {
  const currentRow = useRef<HTMLTableRowElement>(null);
  const [pinned, setPinned] = useState(false);
  const currentPlayerId = position?.row.playerId;

  useEffect(() => {
    setPinned(false);
    const row = currentRow.current;
    if (!row || typeof IntersectionObserver === "undefined") return;
    // Pin whenever the row is out of view, above or below. On phones the
    // top-three strip pushes the row below the fold on first load.
    const observer = new IntersectionObserver(([entry]) => {
      if (entry) setPinned(!entry.isIntersecting);
    });
    observer.observe(row);
    return () => observer.disconnect();
  }, [standings, currentPlayerId]);

  return <div className={styles["ledger-container"]} role="region" aria-label="Leaderboard standings" aria-busy={loading}>
    {standings.length === 0 ? <div className={`${sheet.panel} ${sheet["panel-pad"]} ${sheet.small}`}>No one is on the board yet.</div> :
      <div className={styles.ledger}>
        <table aria-label={scope === "season" ? "Season leaderboard" : "All-time leaderboard"} data-scope={scope}>
          <thead><tr>
            <th scope="col">#</th><th scope="col">Player</th><th scope="col">Tier</th>
            <th scope="col" className={styles.r}>Elo</th>
            <th scope="col" className={`${styles.r} ${styles.sort}`} aria-sort="descending">{scope === "season" ? "Winnings" : "Career winnings"}</th>
            {scope === "season" && <>
              <th scope="col" className={styles.r}>W–L</th>
              <th scope="col" className={styles.r}>Win %</th>
              <th scope="col" className={styles.r}>Streak</th>
            </>}
          </tr></thead>
          <tbody>{standings.map(({ row, place }) => {
            const me = row.playerId === currentPlayerId;
            return <tr key={row.playerId} className={me ? styles.me : undefined} ref={me ? currentRow : undefined}>
              <td className={styles.p}>{place}</td>
              <td><span className={styles.nm}>
                <Link className={styles["row-link"]} href={`/player/${row.playerId}`}>{row.displayName}</Link>
                {me && <span className={sheet.youtag}>YOU</span>}
              </span></td>
              <td><TierName tier={row.rank} /></td>
              <td className={`${styles.r} ${styles.v}`}>{row.rating}</td>
              <td className={`${styles.r} ${styles.wn}`}>{row.winnings.toLocaleString()}</td>
              {scope === "season" && <>
                <td className={`${styles.r} ${styles.wl}`}>{row.wins}<span>–</span>{row.losses}</td>
                <td className={`${styles.r} ${styles.v}`}>{row.winRate}</td>
                <td className={styles.r}>{row.currentStreak > 0 ?
                  <span className={styles.stk}><Flame aria-hidden="true" />{row.currentStreak}</span> :
                  <span className={`${styles.stk} ${styles.z}`}>–</span>}
                </td>
              </>}
            </tr>;
          })}</tbody>
        </table>
      </div>}
    {pinned && position && <div className={styles.pinbar} role="region" aria-label="Your position, pinned">
      <span className={styles.p}>{position.place}</span>
      <span className={styles.nm}>
        <RankGem tier={position.row.rank} />
        <Link href={`/player/${position.row.playerId}`}>{position.row.displayName}</Link>
        <span className={sheet.youtag}>YOU</span>
        {position.gapLabel && <span className={styles.gap}>{position.gapLabel}</span>}
      </span>
      <span className={styles.wn}>{position.row.winnings.toLocaleString()}</span>
    </div>}
  </div>;
}
