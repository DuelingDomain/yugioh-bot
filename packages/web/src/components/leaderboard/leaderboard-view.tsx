"use client";

import { useMemo } from "react";
import { SheetRoot } from "@/components/sheet/sheet-root";
import sheet from "@/components/sheet/sheet.module.css";
import { getPlayerPosition, getStandings, getTierCounts, type ActiveSeason, type LeaderboardRow, type LeaderboardScope } from "./leaderboard-model";
import { LeaderboardPodium } from "./leaderboard-podium";
import { LeaderboardLedger } from "./leaderboard-ledger";
import { LeaderboardRail } from "./leaderboard-rail";
import styles from "./leaderboard.module.css";

interface LeaderboardViewProps {
  rows: LeaderboardRow[];
  currentPlayerId: number | null;
  activeSeason: ActiveSeason | null;
  seasonStartedOn: string | null;
  scope: LeaderboardScope;
  onScopeChange: (scope: LeaderboardScope) => void;
  loading?: boolean;
  error?: string | null;
}

export function LeaderboardView({ rows, currentPlayerId, activeSeason, seasonStartedOn, scope, onScopeChange, loading = false, error = null }: LeaderboardViewProps) {
  // The season API falls back to career rows when no season is running.
  // All presentation branches below share this one effective scope.
  const effectiveScope = activeSeason ? scope : "all";
  const standings = useMemo(() => getStandings(rows), [rows]);
  const position = getPlayerPosition(rows, currentPlayerId);
  const tiers = getTierCounts(rows);

  return <SheetRoot>
    <header className={styles["lb-head"]}>
      <div>
        <h1 className={sheet.title}>Leaderboard</h1>
        <p className={styles["lb-sub"]}>{!activeSeason ? "No season running · all-time standings" : effectiveScope === "all" ? "All seasons · ranked by career winnings" : <>
          <span className={styles.status}><span className={sheet.lamp} data-s="live" aria-hidden="true" />{activeSeason.name ?? `Season ${activeSeason.number}`}</span>
          <span className={styles.dot} aria-hidden="true" /><span>since {seasonStartedOn}</span>
          <span className={styles.dot} aria-hidden="true" /><span>{rows.length} ranked {rows.length === 1 ? "player" : "players"}</span>
        </>}</p>
      </div>
      {activeSeason && <div className={sheet.seg} role="group" aria-label="Leaderboard scope">
        <button type="button" aria-pressed={effectiveScope === "season"} disabled={loading} onClick={() => onScopeChange("season")}>This season</button>
        <button type="button" aria-pressed={effectiveScope === "all"} disabled={loading} onClick={() => onScopeChange("all")}>All-time</button>
      </div>}
    </header>
    {error && <p role="status" className={`${sheet.small} ${styles.error}`}>{error}</p>}
    <div className={styles["lb-grid"]}>
      <div className={styles.main}>
        <LeaderboardPodium standings={standings} scope={effectiveScope} />
        <LeaderboardLedger standings={standings} scope={effectiveScope} position={position} loading={loading} />
        {effectiveScope === "all" && <p className={`${sheet.small} ${styles["all-time-note"]}`}>Season records, win rate and streaks live on the season view. The all-time view shows only what is kept across seasons.</p>}
      </div>
      <LeaderboardRail position={position} scope={effectiveScope} tiers={tiers} />
    </div>
  </SheetRoot>;
}
