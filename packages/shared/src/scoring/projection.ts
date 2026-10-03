import { eloStakes } from "./elo.js";
import { matchWinPoints } from "./winnings.js";

export type MatchProjection = {
  winWinnings: number;
  winRating: number; // positive delta
  loseWinnings: 0;
  loseRating: number; // negative delta
};

export function projectMatch(opts: {
  myElo: number;
  oppElo: number;
  seasonMultiplier: number;
}): MatchProjection {
  const stakes = eloStakes(opts.myElo, opts.oppElo);
  return {
    winWinnings: matchWinPoints(opts),
    winRating: stakes.win,
    loseWinnings: 0,
    loseRating: stakes.loss,
  };
}
