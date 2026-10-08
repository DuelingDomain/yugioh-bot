import type { DuelBestOf, DuelSeriesSummary } from "@yugidraft/shared/duels";
import type { TournamentDuelRules } from "@yugidraft/shared/services";
import type { TournamentVisibility } from "@yugidraft/shared/types";

export type { DuelBestOf, DuelSeriesSummary, TournamentDuelRules };

export interface Participant {
  playerId: number;
  displayName: string;
  /** Older payloads (and tests) omit the deck fields. */
  deckRegistered?: boolean;
  deckLocked?: boolean;
}

export interface Match {
  id: number;
  matchId: number | null;
  roundNumber: number;
  playerOneId: number;
  playerTwoId: number | null;
  playerOneName: string;
  playerTwoName: string | null;
  status: string;
  winnerId: number | null;
  reporterId: number | null;
  resolvedAt: string | null;
  metadata: Record<string, unknown>;
  /** The open online series of the slot, else the latest one. */
  series?: DuelSeriesSummary | null;
}

/** Elo swing for the viewer's current or next match; null unless the tournament is active and one is waiting. */
export interface ViewerStakes {
  tournamentMatchId: number;
  opponentId: number;
  win: number;
  loss: number;
}

/** A size note for a draft deck. `optional`: it plays as it is. `required`: the duel start would refuse it. */
export interface DeckNote {
  level: "optional" | "required";
  mainCount: number;
  message: string;
}

export interface TournamentDetail {
  id: number;
  name: string;
  format: string;
  status: string;
  createdByUserId: number;
  participants: Participant[];
  matches: Match[];
  isParticipant: boolean;
  currentUserPlayerId: number | null;
  startedAt: string | null;
  createdAt: string;
  deadlineAt?: string;
  reportConfirmWindowHours?: number;
  bestOf?: DuelBestOf;
  duelRules?: TournamentDuelRules;
  /** The server refuses rule changes: the tournament is closed or a game has started. */
  rulesLocked?: boolean;
  /** Set for a tournament made from a draft. */
  draftId?: number | null;
  draftSlug?: string | null;
  /** How the viewer's draft deck stands against the size rules; null when it needs no note. */
  deckNote?: DeckNote | null;
  /** The viewer's Elo stakes. Older payloads (and tests) omit it. */
  stakes?: ViewerStakes | null;
  /** Who can see and join. Older payloads (and tests) omit it. */
  visibility?: TournamentVisibility;
  /** The server says this viewer may join now: entries are open, they are not in it, and they are allowed. Older payloads omit it. */
  canJoin?: boolean;
  /** Sent only to the host: the invite link, the Private/Open switch and Reset are theirs to use. */
  canManageInvite?: true;
  /** The server can post to Discord (the bot is enabled). Absent or false hides the Announce button and the /event hint. */
  discordEnabled?: boolean;
}

export interface StandingsRow {
  playerId: number;
  displayName: string;
  wins: number;
  losses: number;
}
