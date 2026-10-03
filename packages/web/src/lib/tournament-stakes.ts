import type Database from "better-sqlite3";
import { ELO_DEFAULT, eloStakes } from "@yugidraft/shared/scoring";

/** What the viewer's current or next match is worth in Elo. */
export interface ViewerStakes {
  /** The tournament match (tournament_matches.id) these numbers are for. */
  tournamentMatchId: number;
  opponentId: number;
  /** Elo change if the viewer wins. Positive. */
  win: number;
  /** Elo change if the viewer loses. Negative or zero. */
  loss: number;
}

export interface StakesMatch {
  id: number;
  playerOneId: number;
  playerTwoId: number | null;
  status: string;
  reporterId: number | null;
}

/**
 * The match the viewer should see stakes for, in the order the tournament page
 * features matches: the first one that waits on them (open, or reported by the
 * opponent), else the first one they reported that waits on the opponent.
 * `matches` is in round order. Byes and finished matches never qualify.
 */
export function pickStakesMatch<T extends StakesMatch>(matches: readonly T[], playerId: number): T | null {
  const mine = matches.filter((m) => m.playerTwoId !== null && (m.playerOneId === playerId || m.playerTwoId === playerId));
  const waitingOnMe = mine.find(
    (m) => m.status === "open" || (m.status === "pending_approval" && m.reporterId !== null && m.reporterId !== playerId),
  );
  return waitingOnMe ?? mine.find((m) => m.status === "pending_approval") ?? null;
}

function ratingOf(db: Database.Database, guildId: string, playerId: number): number {
  const row = db
    .prepare("select elo from player_ratings where guild_id = ? and player_id = ?")
    .get(guildId, playerId) as { elo: number } | undefined;
  return row?.elo ?? ELO_DEFAULT;
}

/**
 * Elo stakes for the viewer's current or next match, or null when they have
 * none or the tournament is not running. Every approved match with a winner is
 * rated, tournament matches included, so there is no unrated case to return.
 */
export function viewerStakes(input: {
  db: Database.Database;
  guildId: string;
  tournamentStatus: string;
  matches: readonly StakesMatch[];
  playerId: number | null;
}): ViewerStakes | null {
  if (input.playerId === null || input.tournamentStatus !== "active") return null;
  const match = pickStakesMatch(input.matches, input.playerId);
  if (!match || match.playerTwoId === null) return null;
  const opponentId = match.playerOneId === input.playerId ? match.playerTwoId : match.playerOneId;
  const { win, loss } = eloStakes(
    ratingOf(input.db, input.guildId, input.playerId),
    ratingOf(input.db, input.guildId, opponentId),
  );
  return { tournamentMatchId: match.id, opponentId, win, loss };
}
