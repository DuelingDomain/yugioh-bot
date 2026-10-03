import type { DuelSeriesSummary, Match, TournamentDetail } from "@/components/tournament/types";
import { defaultDuelSettings } from "@yugidraft/shared/duels";

export const sheetPlayers = [
  { playerId: 1, displayName: "Kestrel", deckRegistered: true, deckLocked: true },
  { playerId: 5, displayName: "Imran", deckRegistered: true, deckLocked: true },
  { playerId: 2, displayName: "voidpriest", deckRegistered: true, deckLocked: true },
  { playerId: 4, displayName: "duelist.josh", deckRegistered: true, deckLocked: false },
  { playerId: 6, displayName: "BlueEyesBen", deckRegistered: true, deckLocked: false },
  { playerId: 3, displayName: "Marik_Mains", deckRegistered: false, deckLocked: false },
];
export const sheetRatings = [
  { playerId: 1, rating: 1468, rank: "Platinum" },
  { playerId: 5, rating: 1184, rank: "Gold" },
  { playerId: 2, rating: 1612, rank: "Diamond" },
  { playerId: 4, rating: 1120, rank: "Gold" },
  { playerId: 6, rating: 1291, rank: "Gold" },
  { playerId: 3, rating: 1062, rank: "Silver" },
];
function slot(id: number, one: number, two: number, winner: number | null = null, wins?: [number, number]): Match {
  const playerOneName = sheetPlayers.find((player) => player.playerId === one)!.displayName;
  const playerTwoName = sheetPlayers.find((player) => player.playerId === two)!.displayName;
  const series: DuelSeriesSummary | null = wins ? {
    id: id + 100, bestOf: 3, ranked: true, status: winner === null ? "active" : "completed",
    playerIds: [one, two], displayNames: [playerOneName, playerTwoName], wins, gameNumber: wins[0] + wins[1] + (winner === null ? 1 : 0),
    currentDuelSlug: `duel-${id}`, winnerPlayerId: winner, tournamentId: 12, tournamentSlug: "friday-night-12",
    tournamentMatchId: id, nextGameAt: null, sideReady: [false, false], hasSide: [true, true], firstChooser: null, firstChoice: null, vsBot: false,
  } : null;
  return {
    id, matchId: winner === null ? null : id + 1000, roundNumber: Math.ceil(id / 3),
    playerOneId: one, playerTwoId: two, playerOneName, playerTwoName,
    status: winner === null ? "open" : "completed", winnerId: winner, reporterId: null,
    resolvedAt: winner === null ? null : "2026-09-24T01:42:00Z", metadata: {}, series,
  };
}
// Every pair and result in Board 02; the two own open slots come first.
export const sheetTournament: TournamentDetail = {
  id: 12, name: "Friday Night Duels #12", format: "round_robin", status: "active", createdByUserId: "host",
  participants: sheetPlayers, isParticipant: true, currentUserPlayerId: 5,
  startedAt: "2026-09-26T00:04:00Z", createdAt: "2026-09-25T20:00:00Z", deadlineAt: "2026-10-03T03:00:00Z",
  reportConfirmWindowHours: 24, bestOf: 3, rulesLocked: true,
  duelRules: { bestOf: 3, mode: "normal", masterRule: 5, settings: { ...defaultDuelSettings("normal"), visibility: "public", banlist: "tcg-2026-09", turnSeconds: 180 }, draftId: null },
  matches: [
    slot(1, 5, 3), slot(2, 5, 6), slot(3, 1, 5, 1, [2, 1]),
    slot(4, 1, 2, null, [1, 0]), slot(5, 1, 4), slot(6, 1, 6, 1, [2, 1]),
    slot(7, 1, 3, 1, [2, 0]), slot(8, 5, 2, 5, [2, 0]), slot(9, 5, 4, 5, [2, 1]),
    slot(10, 2, 4, 2, [2, 0]), slot(11, 2, 6), slot(12, 2, 3, 2, [2, 1]),
    { ...slot(13, 4, 3), status: "pending_approval", matchId: 1013, reporterId: 3, winnerId: 3 },
    slot(14, 4, 6, 4, [2, 1]), slot(15, 6, 3, 6),
  ],
};
// The existing progress regression: two decided slots out of three, final round open.
export const threeMatchTournament: TournamentDetail = {
  ...sheetTournament,
  matches: [
    { ...sheetTournament.matches[2], roundNumber: 1 },
    { ...sheetTournament.matches[7], roundNumber: 1 },
    { ...sheetTournament.matches[0], roundNumber: 2 },
  ],
};
