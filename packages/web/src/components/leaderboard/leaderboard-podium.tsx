import Link from "next/link";
import { Flame } from "lucide-react";
import { TierName } from "@/components/rank/rank-gem";
import type { LeaderboardScope, Standing } from "./leaderboard-model";
import styles from "./leaderboard.module.css";

const places = ["FIRST", "SECOND", "THIRD"];

export function LeaderboardPodium({ standings, scope }: { standings: Standing[]; scope: LeaderboardScope }) {
  if (!standings.length) return null;
  return <section className={styles.podium} aria-label="Top three">
    {standings.slice(0, 3).map(({ row, place }) => <Link href={`/player/${row.playerId}`} key={row.playerId}>
      <span className={styles["pd-top"]}>
        <span className={styles["pd-pos"]}>{places[place - 1]}</span>
        <TierName tier={row.rank}>{row.rating}</TierName>
      </span>
      <span className={styles["pd-name"]}>{row.displayName}</span>
      <span className={styles["pd-big"]}>{row.winnings.toLocaleString()}<span>winnings</span></span>
      {scope === "season" && <span className={styles["pd-foot"]}>
        <span>{row.wins}–{row.losses}</span>
        {row.currentStreak > 0 && <span className={styles["pd-streak"]}><Flame aria-hidden="true" />{row.currentStreak} straight</span>}
      </span>}
    </Link>)}
  </section>;
}
