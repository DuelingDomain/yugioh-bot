import type { DuelSeriesSummary, Match, TournamentDetail } from "../../src/components/tournament/types";
import { defaultDuelSettings } from "@yugidraft/shared/duels";
import type { PlayerRatings } from "../../src/components/tournament/sheet-contracts";

export const ratings: PlayerRatings = new Map([
  [1, { rating: 1468, rank: "Platinum" }],
  [5, { rating: 1184, rank: "Gold" }],
  [2, { rating: 1612, rank: "Diamond" }],
  [3, { rating: 1120, rank: "Gold" }],
  [4, { rating: 1291, rank: "Gold" }],
  [6, { rating: 1062, rank: "Silver" }],
]);
const names: Record<number, string> = { 1: "Kestrel", 5: "Imran", 2: "voidpriest", 3: "duelist.josh", 4: "BlueEyesBen", 6: "Marik_Mains" };

export function slot(id: number, one: number, two: number | null, overrides: Partial<Match> = {}): Match {
  return { id, matchId: null, roundNumber: 1, playerOneId: one, playerTwoId: two, playerOneName: names[one], playerTwoName: two === null ? null : names[two], status: "open", winnerId: null, reporterId: null, resolvedAt: null, metadata: {}, series: null, ...overrides };
}

export function seriesFor(match: Match, overrides: Partial<DuelSeriesSummary> = {}): DuelSeriesSummary {
  return { id: match.id, bestOf: 3, ranked: false, status: "active", playerIds: [match.playerOneId, match.playerTwoId!], displayNames: [match.playerOneName, match.playerTwoName!], wins: [1, 0], gameNumber: 2, currentDuelSlug: `duel-${match.id}`, winnerPlayerId: null, tournamentId: 12, tournamentSlug: "friday-night-duels-12", tournamentMatchId: match.id, nextGameAt: null, sideReady: [false, false], hasSide: [true, true], firstChooser: null, firstChoice: null, vsBot: false, ...overrides };
}

function completed(id: number, one: number, two: number, wins: [number, number], resolvedAt: string): Match {
  const match = slot(id, one, two, { status: "completed", winnerId: wins[0] > wins[1] ? one : two, matchId: id + 100, resolvedAt });
  return { ...match, series: seriesFor(match, { status: "completed", wins, winnerPlayerId: match.winnerId, gameNumber: wins[0] + wins[1] }) };
}

export const openMatch = slot(1, 5, 6);
export const liveMatch = slot(3, 1, 2);
liveMatch.series = seriesFor(liveMatch);
export const pendingMatch = slot(4, 6, 3, { status: "pending_approval", matchId: 104, reporterId: 6, winnerId: 6 });
export const decidedMatch = completed(7, 5, 3, [2, 1], "2026-09-30T21:42:00Z");
export const byeMatch = slot(16, 2, null, { status: "completed", metadata: { bye: true, winnerId: 2 } });

export const matches: Match[] = [
  openMatch, slot(2, 5, 4), liveMatch, pendingMatch, slot(5, 1, 3), slot(6, 2, 4),
  decidedMatch,
  completed(8, 3, 4, [2, 1], "2026-09-30T20:15:00Z"),
  slot(9, 4, 6, { status: "completed", matchId: 109, winnerId: 4, reporterId: 4, resolvedAt: "2026-09-29T22:03:00Z" }),
  completed(10, 1, 5, [2, 1], "2026-09-28T20:00:00Z"),
  completed(11, 1, 4, [2, 1], "2026-09-28T19:00:00Z"),
  completed(12, 1, 6, [2, 0], "2026-09-27T20:00:00Z"),
  completed(13, 5, 2, [2, 0], "2026-09-27T19:00:00Z"),
  completed(14, 2, 3, [2, 0], "2026-09-26T20:00:00Z"),
  completed(15, 2, 6, [2, 1], "2026-09-26T19:00:00Z"),
];

export function tournament(overrides: Partial<TournamentDetail> = {}): TournamentDetail {
  return {
    id: 12, name: "Friday Night Duels #12", format: "round_robin", status: "active", createdByUserId: "organizer", isParticipant: true, currentUserPlayerId: 5,
    participants: [1, 5, 2, 3, 4, 6].map(playerId => ({ playerId, displayName: names[playerId], deckRegistered: playerId !== 6, deckLocked: [1, 5, 2].includes(playerId) })),
    matches: [...matches], bestOf: 3,
    duelRules: { bestOf: 3, mode: "normal", masterRule: 5, settings: { ...defaultDuelSettings("normal"), turnSeconds: 180 }, draftId: null },
    startedAt: "2026-09-25T20:04:00Z", createdAt: "2026-09-25T19:00:00Z", reportConfirmWindowHours: 24,
    ...overrides,
  };
}

export const matchProps = { tournament: tournament(), tournamentSlug: "friday-night-duels-12", currentUserPlayerId: 5, isHost: true, ratings, onChanged: () => {} };

export function deckResponse(locked = true) {
  return {
    registration: { savedDeckId: 8, deck: { main: Array(40).fill(1), extra: Array(15).fill(2), side: Array(15).fill(3) }, lockedAt: locked ? "2026-09-25T20:10:00Z" : null },
    savedDeckOptions: [{ id: 8, name: "Branded Despia", mainCount: 40 }], draft: null,
  };
}
