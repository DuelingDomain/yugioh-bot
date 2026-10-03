"use client";

import { useMemo } from "react";
import { MetaLine } from "@/components/meta-line/meta-line";
import { LpTally, SheetRoot, type LpTallyItem } from "@/components/sheet";
import {
  getPlayerPosition,
  getStandings,
  getTierCounts,
  getTierProgress,
  type ActiveSeason,
  type LeaderboardRow,
  type LeaderboardScope,
} from "./leaderboard-model";
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

export function LeaderboardView({
  rows, currentPlayerId, activeSeason, seasonStartedOn, scope, onScopeChange, loading = false, error = null,
}: LeaderboardViewProps) {
  // With no running season the API falls back to career rows, so every part of
  // the page below follows this one effective scope.
  const effectiveScope: LeaderboardScope = activeSeason ? scope : "all";
  const standings = useMemo(() => getStandings(rows), [rows]);
  const position = getPlayerPosition(rows, currentPlayerId);
  const tiers = getTierCounts(rows);

  const phoneReadouts: LpTallyItem[] | null = position ? (() => {
    const progress = getTierProgress(position.row.rating);
    return [
      {
        key: "you", label: "You", aside: `#${position.place}`, value: position.row.winnings.toLocaleString(),
        sub: position.gapLabel ?? undefined,
      },
      {
        key: "elo", label: "Elo", aside: progress.tier, value: position.row.rating, tone: "tier", tier: progress.tier,
        sub: progress.nextTier ? `${progress.remaining.toLocaleString()} to ${progress.nextTier}` : "Top tier",
      },
    ];
  })() : null;

  const playerCount = `${rows.length} ranked ${rows.length === 1 ? "player" : "players"}`;

  return (
    <SheetRoot>
      <header className="lb-head sheet-head">
        <div>
          <h1 className="t-title">Leaderboard</h1>
          <MetaLine
            className="lb-sub"
            items={!activeSeason ? [
              { content: <span className="ssn">No season running · all-time standings</span> },
            ] : effectiveScope === "all" ? [
              { content: <span>All seasons · ranked by career winnings</span> },
            ] : [
              { content: <span className="ssn">{activeSeason.name ?? `Season ${activeSeason.number}`} · running</span> },
              ...(seasonStartedOn ? [{ content: <span>since {seasonStartedOn}</span> }] : []),
              { content: <span>{playerCount}</span> },
            ]}
          />
        </div>
        {activeSeason && (
          <div className="seg" role="group" aria-label="Leaderboard scope">
            <button type="button" aria-pressed={effectiveScope === "season"} disabled={loading} onClick={() => onScopeChange("season")}>This season</button>
            <button type="button" aria-pressed={effectiveScope === "all"} disabled={loading} onClick={() => onScopeChange("all")}>All-time</button>
          </div>
        )}
      </header>

      {error && <p role="status" className={`small ${styles.error}`}>{error}</p>}

      {phoneReadouts && (
        <div className={`${styles.phoneOnly} ${styles.phoneReadouts}`}>
          <LpTally items={phoneReadouts} />
        </div>
      )}

      <div className="lb-grid">
        <div style={{ minWidth: 0 }}>
          <div className={styles.deskOnly}>
            <LeaderboardPodium standings={standings} scope={effectiveScope} />
          </div>
          <LeaderboardLedger standings={standings} scope={effectiveScope} position={position} loading={loading} />
          {effectiveScope === "all" && (
            <p className={`small ${styles.note}`}>
              Season records, win rate and streaks live on the season view. The all-time view shows only what is kept across seasons.
            </p>
          )}
        </div>
        <LeaderboardRail position={position} scope={effectiveScope} tiers={tiers} />
      </div>
    </SheetRoot>
  );
}
