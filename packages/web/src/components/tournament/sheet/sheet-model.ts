import { isSeriesOpen } from "../duel-rules";
import type { PlayerRating, PlayerRatings } from "../sheet-contracts";
import type { TournamentDetail } from "../types";
import { deriveMyMatches } from "../use-my-matches";

/** An optional leaderboard must never prevent the tournament from rendering. */
export function buildPlayerRatings(rows: unknown): PlayerRatings {
  const ratings = new Map<number, PlayerRating>();
  if (!Array.isArray(rows)) return ratings;
  for (const row of rows) {
    if (row && typeof row.playerId === "number" && Number.isFinite(row.playerId)
      && typeof row.rating === "number" && Number.isFinite(row.rating) && typeof row.rank === "string") {
      ratings.set(row.playerId, { rating: row.rating, rank: row.rank });
    }
  }
  return ratings;
}

export function statusPresentation(status: string) {
  if (status === "active") return { lamp: "live", label: "In progress" };
  if (status === "completed") return { lamp: "done", label: "Completed" };
  if (status === "cancelled") return { lamp: "off", label: "Cancelled" };
  return { lamp: "off", label: status };
}

export function getTournamentProgress(tournament: TournamentDetail) {
  const mine = new Set(deriveMyMatches(tournament).mine.filter((match) => match.status === "open").map((match) => match.id));
  let done = 0, live = 0, toConfirm = 0, yours = 0, notStarted = 0;
  // Ordered, exclusive buckets: a player's live duel is live, never also "yours".
  for (const match of tournament.matches) {
    if (match.status === "completed") done++;
    else if (isSeriesOpen(match.series)) live++;
    else if (match.status === "pending_approval" || match.status === "pending") toConfirm++;
    else if (mine.has(match.id)) yours++;
    else notStarted++;
  }
  const roundNumbers = tournament.matches.map((match) => match.roundNumber);
  const maxRound = roundNumbers.length > 0 ? Math.max(...roundNumbers) : 0;
  const incompleteRounds = tournament.matches.filter((match) => match.status !== "completed").map((match) => match.roundNumber);
  const hasRounds = tournament.format === "single_elim" && maxRound > 0;
  return {
    done, total: tournament.matches.length, live, toConfirm, yours, notStarted,
    currentRound: hasRounds ? (incompleteRounds.length > 0 ? Math.min(...incompleteRounds) : maxRound) : null,
    totalRounds: hasRounds ? maxRound : null,
  };
}
export type TournamentProgress = ReturnType<typeof getTournamentProgress>;
