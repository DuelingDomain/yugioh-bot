import { ELO_K } from "./constants.js";

export function expectedScore(rating: number, opponent: number): number {
  return 1 / (1 + 10 ** ((opponent - rating) / 400));
}

// actual: 1 for a win, 0 for a loss
export function nextRating(rating: number, opponent: number, actual: 0 | 1, k = ELO_K): number {
  return Math.round(rating + k * (actual - expectedScore(rating, opponent)));
}

/**
 * Elo change a rated match applies to a player, before it happens. `win` is
 * positive, `loss` negative or zero. Uses the same `nextRating` the real
 * update (scoring.recordMatchResult) uses: one K for everyone, no provisional
 * K, no draw (a rated match always has a winner), rounded to whole points.
 */
export function eloStakes(myElo: number, oppElo: number): { win: number; loss: number } {
  return {
    win: nextRating(myElo, oppElo, 1) - myElo,
    loss: nextRating(myElo, oppElo, 0) - myElo,
  };
}
