import type { TournamentDetail } from "./types";

/*
 * The live tournament page is one sheet built from three parts with separate owners.
 * The page (sheet/) composes the Standings crosstable (standings/) and the Your match card
 * and Matches queue (matches/). These props and ids are the only coupling between them.
 */

/** Elo and tier for one player, from the all-time leaderboard rows. */
export interface PlayerRating {
  rating: number;
  rank: string;
}

/** Players missing from the map have no rating yet: draw the grey gem and no Elo. */
export type PlayerRatings = ReadonlyMap<number, PlayerRating>;

/** Rating assumed for stakes when a player has no rating row, as the old Your match card did. */
export const UNRATED_ELO = 1000;

interface SheetSectionProps {
  tournament: TournamentDetail;
  tournamentSlug: string;
  currentUserPlayerId: number | null;
  ratings: PlayerRatings;
}

/** Renders `<section id={SECTION_IDS.standings}>` with the accessible name "Standings". */
export type CrosstableProps = SheetSectionProps;

/**
 * Renders a section with the accessible name "Your match", or nothing when the
 * viewer is not a participant.
 */
export interface YourMatchProps extends SheetSectionProps {
  isHost: boolean;
  onChanged: () => void;
}

/** Renders `<section id={SECTION_IDS.matches}>` with the accessible name "Matches". */
export interface MatchQueueProps extends SheetSectionProps {
  isHost: boolean;
  onChanged: () => void;
}

/** Element ids the sections own, for in-page links and the old `?tab=` URLs. */
export const SECTION_IDS = {
  standings: "standings",
  matches: "matches",
  myDeck: "my-deck",
} as const;

/** The id of a match row in the queue. Crosstable "Play" cells link to it. */
export function matchAnchorId(tournamentMatchId: number): string {
  return `match-${tournamentMatchId}`;
}
