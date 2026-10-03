import {
  BASE_MATCH_WIN, OPP_STRENGTH_MIN, OPP_STRENGTH_MAX,
  PLACEMENT_BASE, RANK_THRESHOLDS, placementPoints, rankForRating,
} from "@yugidraft/shared/scoring";

export type LeaderboardScope = "season" | "all";
export interface ActiveSeason {
  number: number;
  name: string | null;
  startedAt: string;
}

export interface LeaderboardRow {
  playerId: number;
  displayName: string;
  winnings: number;
  rating: number;
  rank: string;
  currentStreak: number;
  wins: number;
  losses: number;
  winRate: number;
}

// Preserve the server's winnings/wins/name order; Elo never determines place.
export function getStandings(rows: LeaderboardRow[]) {
  return rows.map((row, index) => ({ row, place: index + 1 }));
}
export type Standing = ReturnType<typeof getStandings>[number];

export function getPlayerPosition(rows: LeaderboardRow[], playerId: number | null) {
  const index = rows.findIndex((row) => row.playerId === playerId);
  if (index < 0) return null;
  const row = rows[index];
  const above = rows[index - 1] ?? null;
  const gap = above ? above.winnings - row.winnings : null;
  return {
    row, place: index + 1, above, gap,
    gapLabel: above ? `${gap!.toLocaleString()} behind ${above.displayName}` : null,
  };
}
export type PlayerPosition = NonNullable<ReturnType<typeof getPlayerPosition>>;

export function getTierProgress(rating: number) {
  const { name: tier, min, nextAt } = rankForRating(rating);
  const nextTier = RANK_THRESHOLDS.find(({ min: threshold }) => threshold === nextAt)?.name ?? null;
  const remaining = nextAt === null ? 0 : nextAt - rating;
  const points = Math.max(0, rating - min);
  const span = nextAt === null ? null : nextAt - min;
  const percent = span === null ? 100 : Math.round(Math.min(1, points / span) * 100);
  return {
    tier, min, nextAt, nextTier, remaining, points, span, percent,
    label: nextTier ? `${remaining.toLocaleString()} Elo to ${nextTier}` : "Top tier",
  };
}

export function getTierCounts(rows: LeaderboardRow[]) {
  const counts = new Map<string, number>();
  for (const { rating } of rows) {
    const { name } = rankForRating(rating);
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return RANK_THRESHOLDS.map((tier) => ({ ...tier, count: counts.get(tier.name) ?? 0 }));
}

export function getWinningsGuide() {
  const placements = Object.keys(PLACEMENT_BASE) as Array<keyof typeof PLACEMENT_BASE>;
  const brackets = [
    { label: "Under 8", participants: 7 }, { label: "8 to 15", participants: 8 },
    { label: "16 to 31", participants: 16 }, { label: "32 and up", participants: 32 },
  ];
  return {
    min: Math.round(BASE_MATCH_WIN * OPP_STRENGTH_MIN),
    max: Math.round(BASE_MATCH_WIN * OPP_STRENGTH_MAX),
    equal: BASE_MATCH_WIN,
    brackets: brackets.map((bracket) => ({
      ...bracket, awards: placements.map((placement) => placementPoints(placement, bracket.participants)),
    })),
  };
}
