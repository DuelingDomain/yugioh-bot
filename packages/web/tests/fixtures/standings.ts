import { defaultDuelSettings } from "@yugidraft/shared/duels";
import type { PlayerRatings } from "@/components/tournament/sheet-contracts";
import type { DuelSeriesSummary, Match, Participant, TournamentDetail } from "@/components/tournament/types";

export const standingsPlayers: Participant[] = [
  { playerId: 1, displayName: "Kestrel", deckRegistered: true, deckLocked: true },
  { playerId: 5, displayName: "Imran", deckRegistered: true, deckLocked: true },
  { playerId: 2, displayName: "voidpriest", deckRegistered: true, deckLocked: true },
  { playerId: 3, displayName: "duelist.josh", deckRegistered: true },
  { playerId: 4, displayName: "BlueEyesBen", deckRegistered: true },
  { playerId: 6, displayName: "Marik_Mains", deckRegistered: false },
];

export const standingsRatings: PlayerRatings = new Map([
  [1, { rating: 1468, rank: "Platinum" }],
  [5, { rating: 1184, rank: "Gold" }],
  [2, { rating: 1612, rank: "Diamond" }],
  [3, { rating: 1120, rank: "Gold" }],
  [4, { rating: 1291, rank: "Gold" }],
  [6, { rating: 1062, rank: "Silver" }],
]);

export function standingsMatch(id: number, one: number, two: number | null, changes: Partial<Match> = {}): Match {
  return {
    id, matchId: null, roundNumber: 1, playerOneId: one, playerTwoId: two,
    playerOneName: standingsPlayers.find((p) => p.playerId === one)?.displayName ?? `Player ${one}`,
    playerTwoName: two == null ? null : standingsPlayers.find((p) => p.playerId === two)?.displayName ?? `Player ${two}`,
    status: "open", winnerId: null, reporterId: null, resolvedAt: null, metadata: {},
    ...changes,
  };
}

export function standingsSeries(slot: Match, changes: Partial<DuelSeriesSummary> = {}): DuelSeriesSummary {
  return {
    id: slot.id, bestOf: 3, ranked: true, status: "active",
    playerIds: [slot.playerOneId, slot.playerTwoId!], displayNames: [slot.playerOneName, slot.playerTwoName!],
    wins: [1, 0], gameNumber: 2, currentDuelSlug: `duel-${slot.id}`, winnerPlayerId: null,
    tournamentId: 12, tournamentSlug: "friday-night-duels-12", tournamentMatchId: slot.id,
    nextGameAt: null, sideReady: [false, false], hasSide: [true, true],
    ...changes,
  };
}

function decided(id: number, one: number, two: number, winner: number, score?: [number, number]): Match {
  const slot = standingsMatch(id, one, two, {
    matchId: 100 + id, status: "completed", winnerId: winner,
    reporterId: score ? null : winner, resolvedAt: "2026-09-30 21:42:00",
  });
  return score ? { ...slot, series: standingsSeries(slot, {
    status: "completed", wins: score, gameNumber: score[0] + score[1], winnerPlayerId: winner,
  }) } : slot;
}

const live = standingsMatch(2, 1, 2);

export const standingsTournament: TournamentDetail = {
  id: 12, name: "Friday Night Duels #12", format: "round_robin", status: "active",
  createdByUserId: "imran-discord", isParticipant: true, currentUserPlayerId: 5,
  startedAt: "2026-09-25 20:04:00", createdAt: "2026-09-25 19:00:00",
  deadlineAt: "2026-10-02 23:00:00", reportConfirmWindowHours: 24, bestOf: 3,
  duelRules: { bestOf: 3, mode: "normal", masterRule: 5, draftId: null, settings: {
    ...defaultDuelSettings("normal"), banlist: "tcg-2026-09", turnSeconds: 180,
  } },
  participants: standingsPlayers,
  matches: [
    decided(1, 1, 5, 1, [2, 1]),
    { ...live, series: standingsSeries(live) },
    standingsMatch(3, 1, 3),
    decided(4, 1, 4, 1, [2, 1]),
    decided(5, 1, 6, 1, [2, 0]),
    decided(6, 5, 2, 5, [2, 0]),
    decided(7, 5, 3, 5, [2, 1]),
    standingsMatch(8, 5, 4),
    standingsMatch(9, 5, 6),
    decided(10, 2, 3, 2, [2, 0]),
    standingsMatch(11, 2, 4),
    decided(12, 2, 6, 2, [2, 1]),
    decided(13, 3, 4, 3, [2, 1]),
    standingsMatch(14, 3, 6, { matchId: 114, status: "pending_approval", winnerId: 6, reporterId: 6 }),
    decided(15, 4, 6, 4),
  ],
};

export function largeStandingsTournament(count = 13): TournamentDetail {
  return { ...standingsTournament, matches: [], participants: Array.from({ length: count }, (_, i) => ({
    playerId: i + 1, displayName: `Player ${i + 1}`,
  })) };
}
