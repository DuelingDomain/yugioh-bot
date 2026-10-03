import type { CSSProperties } from "react";
import Link from "next/link";
import { Flame } from "lucide-react";
import { Mono, TierName, ringColour } from "@/components/sheet";
import type { LeaderboardScope, Standing } from "./leaderboard-model";
import styles from "./leaderboard.module.css";

const places = ["First", "Second", "Third"];

/** The top three standing on the floor, each lit from below by their ring colour. */
export function LeaderboardPodium({
  standings,
  scope,
  currentPlayerId = null,
}: {
  standings: Standing[];
  scope: LeaderboardScope;
  currentPlayerId?: number | null;
}) {
  if (!standings.length) return null;
  return (
    <section className={styles.podium} aria-label="Top three">
      {standings.slice(0, 3).map(({ row, place }) => {
        const me = row.playerId === currentPlayerId;
        const ring = ringColour(row.playerId);
        return (
          <Link
            href={`/player/${row.playerId}`}
            key={row.playerId}
            className={styles.pd}
            data-place={place}
            style={{ "--lit": place === 1 ? "var(--chain)" : me ? "var(--pen)" : ring } as CSSProperties}
          >
            <Mono name={row.displayName} size="big" champion={place === 1} you={me && place !== 1} ring={ring} />
            <span className={styles.pdPlace}>{places[place - 1]}</span>
            <span className={styles.pdName}>{row.displayName}</span>
            <span className={styles.pdTier}>
              <TierName tier={row.rank}>{row.rating}</TierName>
            </span>
            <span className={styles.pdBig}>
              {row.winnings.toLocaleString()}
              <span> winnings</span>
            </span>
            {scope === "season" && (
              <span className={styles.pdFoot}>
                <span>
                  {row.wins}–{row.losses}
                </span>
                {row.currentStreak > 0 && (
                  <span className={styles.pdStreak}>
                    <Flame className={styles.flame} aria-hidden="true" />
                    {row.currentStreak} straight
                  </span>
                )}
              </span>
            )}
          </Link>
        );
      })}
    </section>
  );
}
