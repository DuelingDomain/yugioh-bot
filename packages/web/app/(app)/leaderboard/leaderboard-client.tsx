"use client";

import { useState } from "react";
import { LeaderboardView } from "@/components/leaderboard/leaderboard-view";
import type { ActiveSeason, LeaderboardRow, LeaderboardScope } from "@/components/leaderboard/leaderboard-model";

interface LeaderboardClientProps {
  initialRows: LeaderboardRow[];
  currentPlayerId: number | null;
  activeSeason: ActiveSeason | null;
  seasonStartedOn: string | null;
  liveDuels?: Record<number, string>;
}

export function LeaderboardClient({ initialRows, currentPlayerId, activeSeason, seasonStartedOn, liveDuels }: LeaderboardClientProps) {
  const [standings, setStandings] = useState<{ rows: LeaderboardRow[]; scope: LeaderboardScope }>({ rows: initialRows, scope: "season" });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleScopeChange = async (next: LeaderboardScope) => {
    if (next === standings.scope || loading) return;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/leaderboard?scope=${next}`);
      if (!response.ok) throw new Error("Leaderboard request failed");
      const data = await response.json() as { rows?: LeaderboardRow[] };
      // Commit scope and its data together; pending career rows must never be
      // presented as season records while the request is still running.
      setStandings({ scope: next, rows: data.rows ?? [] });
    } catch {
      setError("Couldn't load the standings. Try again.");
    } finally {
      setLoading(false);
    }
  };

  return <LeaderboardView
    {...standings}
    currentPlayerId={currentPlayerId}
    activeSeason={activeSeason}
    seasonStartedOn={seasonStartedOn}
    liveDuels={liveDuels}
    onScopeChange={handleScopeChange}
    loading={loading}
    error={error}
  />;
}
