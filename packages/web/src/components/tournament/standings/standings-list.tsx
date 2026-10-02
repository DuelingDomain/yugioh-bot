"use client";

import Link from "next/link";
import { RankGem } from "@/components/rank/rank-gem";
import sheet from "@/components/sheet/sheet.module.css";
import type { PlayerRatings } from "../sheet-contracts";
import type { Standing } from "./standings-model";
import styles from "./standings.module.css";

interface StandingsListProps {
  standings: Standing[];
  currentUserPlayerId: number | null;
  ratings: PlayerRatings;
}

export function StandingsPlayer({ player, ratings, me }: {
  player: Pick<Standing, "playerId" | "displayName">;
  ratings: PlayerRatings;
  me: boolean;
}) {
  return <span>
    <RankGem tier={ratings.get(player.playerId)?.rank ?? "none"} />
    <Link className={styles.nm} href={`/player/${player.playerId}`} title={player.displayName}>{player.displayName}</Link>
    {me && <span className={sheet.youtag}>YOU</span>}
  </span>;
}

export function StandingsList({ standings, currentUserPlayerId, ratings }: StandingsListProps) {
  return <div className={styles["xt-wrap"]}>
    <table className={styles.mini} aria-label="Tournament standings">
      <thead><tr>
        <th scope="col" className={styles.pos}>#</th><th scope="col">Player</th>
        <th scope="col" className={`${styles.rec} ${styles.r}`}>W</th>
        <th scope="col" className={`${styles.rec} ${styles.r} ${styles["loss-head"]}`}>L</th>
      </tr></thead>
      <tbody>{standings.map((row) => {
        const me = row.playerId === currentUserPlayerId;
        return <tr key={row.playerId} className={me ? styles.me : undefined}>
          <td className={styles.pos}>{row.place}</td>
          <td className={styles.who}><StandingsPlayer player={row} ratings={ratings} me={me} /></td>
          <td className={`${styles.rec} ${styles.w} ${styles.r}`}>{row.wins}</td>
          <td className={`${styles.rec} ${styles.l} ${styles.r}`}>{row.losses}</td>
        </tr>;
      })}</tbody>
    </table>
  </div>;
}
