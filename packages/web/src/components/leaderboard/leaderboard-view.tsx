"use client";

import { useMemo } from "react";
import { PageFrame } from "@/components/dashboard/page-frame";
import { Segmented } from "@/components/sheet";
import {
  getPlayerPosition,
  getStandings,
  getTierCounts,
  type ActiveSeason,
  type LeaderboardRow,
  type LeaderboardScope,
} from "./leaderboard-model";
import { LeaderboardPodium } from "./leaderboard-podium";
import { LeaderboardLedger } from "./leaderboard-ledger";
import { LeaderboardRail, PositionNumbers } from "./leaderboard-rail";
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
  /** Player id to the slug of the duel they are playing now. */
  liveDuels?: Record<number, string>;
}

export function LeaderboardView({
  rows, currentPlayerId, activeSeason, seasonStartedOn, scope, onScopeChange, loading = false, error = null, liveDuels = {},
}: LeaderboardViewProps) {
  // With no running season the API falls back to career rows, so every part of
  // the page below follows this one effective scope.
  const effectiveScope: LeaderboardScope = activeSeason ? scope : "all";
  const standings = useMemo(() => getStandings(rows), [rows]);
  const position = getPlayerPosition(rows, currentPlayerId);
  const tiers = getTierCounts(rows);

  const playerCount = `${rows.length} ranked ${rows.length === 1 ? "player" : "players"}`;
  const sub = !activeSeason
    ? "No season running, all-time standings"
    : effectiveScope === "all"
      ? "All seasons, ranked by career winnings"
      : [
          `${activeSeason.name ?? `Season ${activeSeason.number}`}, running${seasonStartedOn ? ` since ${seasonStartedOn}` : ""}`,
          playerCount,
        ].join(", ");

  return (
    <PageFrame
      title="Leaderboard"
      sub={sub}
      actions={
        activeSeason ? (
          <Segmented
            label="Leaderboard scope"
            value={effectiveScope}
            disabled={loading}
            onChange={onScopeChange}
            options={[
              { value: "season", label: "This season" },
              { value: "all", label: "All-time" },
            ]}
          />
        ) : undefined
      }
    >
      {error && <p role="status" className={styles.error}>{error}</p>}

      {position && (
        <div className={styles.phoneOnly}>
          <PositionNumbers position={position} />
        </div>
      )}

      <div className={styles.layout}>
        <div className={styles.main}>
          <div className={styles.deskOnly}>
            <LeaderboardPodium standings={standings} scope={effectiveScope} currentPlayerId={currentPlayerId} />
          </div>
          <LeaderboardLedger standings={standings} scope={effectiveScope} position={position} loading={loading} liveDuels={liveDuels} />
          {effectiveScope === "all" && (
            <p className={styles.note}>
              Season records, win rate and streaks live on the season view. The all-time view shows only what is kept across seasons.
            </p>
          )}
        </div>
        <LeaderboardRail position={position} scope={effectiveScope} tiers={tiers} />
      </div>
    </PageFrame>
  );
}
