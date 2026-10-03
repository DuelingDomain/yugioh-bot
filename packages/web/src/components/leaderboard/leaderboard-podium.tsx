import Link from "next/link";
import { Flame } from "lucide-react";
import { TierName } from "@/components/sheet";
import type { LeaderboardScope, Standing } from "./leaderboard-model";

const places = ["FIRST", "SECOND", "THIRD"];

/** The top three as a strip, linked to their profiles. */
export function LeaderboardPodium({ standings, scope }: { standings: Standing[]; scope: LeaderboardScope }) {
  if (!standings.length) return null;
  return (
    <section className="podium" aria-label="Top three">
      {standings.slice(0, 3).map(({ row, place }) => (
        <Link href={`/player/${row.playerId}`} key={row.playerId}>
          <span className="pd-top">
            <span className="pd-pos first">{places[place - 1]}</span>
            <TierName tier={row.rank}>{row.rating}</TierName>
          </span>
          <span className="pd-name">{row.displayName}</span>
          <span className="pd-big">{row.winnings.toLocaleString()}<span>winnings</span></span>
          {scope === "season" && (
            <span className="pd-foot">
              <span>{row.wins}–{row.losses}</span>
              {row.currentStreak > 0 && (
                <span style={{ color: "var(--ember)", display: "inline-flex", alignItems: "center", gap: 4 }}>
                  <Flame className="ic sm" aria-hidden="true" />{row.currentStreak} straight
                </span>
              )}
            </span>
          )}
        </Link>
      ))}
    </section>
  );
}
