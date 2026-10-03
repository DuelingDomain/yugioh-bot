import { describe, expect, it } from "vitest";
import { generateSingleElimFirstRound } from "@yugidraft/shared/tournaments";
import { buildPlayerRatings, getTournamentProgress, statusPresentation } from "@/components/tournament/sheet/sheet-model";
import type { TournamentDetail } from "@/components/tournament/types";
import { sheetRatings, sheetTournament, threeMatchTournament } from "./fixtures/tournament-sheet";

function eliminationTournament(count: number): TournamentDetail {
  const participants = Array.from({ length: count }, (_, i) => ({ playerId: i + 1, displayName: `Player ${i + 1}` }));
  const { byes, pairings } = generateSingleElimFirstRound(participants.map((player) => player.playerId));
  return {
    ...sheetTournament, format: "single_elim", participants,
    matches: [
      ...byes.map((playerOneId) => ({ playerOneId, playerTwoId: null })),
      ...pairings,
    ].map((pairing, i) => ({
      ...sheetTournament.matches[0], ...pairing, id: i + 1, roundNumber: 1,
      playerOneName: `Player ${pairing.playerOneId}`, playerTwoName: pairing.playerTwoId === null ? null : `Player ${pairing.playerTwoId}`,
      status: pairing.playerTwoId === null ? "completed" : "open", winnerId: pairing.playerTwoId === null ? pairing.playerOneId : null,
      metadata: pairing.playerTwoId === null ? { bye: true, winnerId: pairing.playerOneId } : {},
    })),
  };
}

describe("tournament sheet model", () => {
  it("maps all-time leaderboard rows by player id", () => {
    const ratings = buildPlayerRatings(sheetRatings);
    expect(ratings.size).toBe(6);
    expect(ratings.get(5)).toEqual({ rating: 1184, rank: "Gold" });
    expect(ratings.get(2)).toEqual({ rating: 1612, rank: "Diamond" });
    expect(ratings.get(99)).toBeUndefined();
  });
  it("makes missing or malformed ratings safe for grey gems", () => {
    expect(buildPlayerRatings(undefined).size).toBe(0);
    expect(buildPlayerRatings({}).size).toBe(0);
    expect(buildPlayerRatings([null, { playerId: 5, rating: NaN, rank: "Gold" }, { playerId: 1 }]).size).toBe(0);
  });
  it("counts the reference's exclusive progress segments", () => {
    expect(getTournamentProgress(sheetTournament)).toEqual({ done: 9, total: 15, live: 1, toConfirm: 1, yours: 2, notStarted: 2, currentRound: null, totalRounds: null });
  });
  it("does not count your live duel or your pending report twice", () => {
    const progress = getTournamentProgress({ ...sheetTournament, currentUserPlayerId: 1 });
    expect(progress).toMatchObject({ done: 9, live: 1, toConfirm: 1, yours: 1, notStarted: 3 });
    expect(getTournamentProgress({ ...sheetTournament, currentUserPlayerId: 3 })).toMatchObject({ live: 1, toConfirm: 1, yours: 1, notStarted: 3 });
  });
  it("counts between-games as live and a cancelled series as open", () => {
    const match = sheetTournament.matches[3];
    expect(getTournamentProgress({ ...sheetTournament, matches: [{ ...match, series: { ...match.series!, status: "between_games" } }] })).toMatchObject({ live: 1, yours: 0, notStarted: 0 });
    expect(getTournamentProgress({ ...sheetTournament, currentUserPlayerId: 1, matches: [{ ...match, series: { ...match.series!, status: "cancelled" } }] })).toMatchObject({ live: 0, yours: 1, notStarted: 0 });
  });
  it("treats spectators' open slots as not started", () => {
    expect(getTournamentProgress({ ...sheetTournament, currentUserPlayerId: null })).toMatchObject({ yours: 0, notStarted: 4 });
  });
  it("preserves completed bye counting and handles no matches", () => {
    const bye = { ...sheetTournament.matches[0], status: "completed", playerTwoId: null, metadata: { bye: true } };
    expect(getTournamentProgress({ ...sheetTournament, matches: [bye] })).toMatchObject({ done: 1, total: 1, yours: 0 });
    expect(getTournamentProgress({ ...sheetTournament, matches: [] })).toMatchObject({ done: 0, total: 0, live: 0, toConfirm: 0, yours: 0, notStarted: 0 });
  });
  it("keeps round numbers only for single elimination and uses the first incomplete round", () => {
    const elimination = { ...threeMatchTournament, format: "single_elim", participants: threeMatchTournament.participants.filter((player) => [1, 5, 2, 3].includes(player.playerId)) };
    expect(getTournamentProgress(threeMatchTournament)).toMatchObject({ done: 2, total: 3, currentRound: null });
    expect(getTournamentProgress(elimination)).toMatchObject({ currentRound: 2, totalRounds: 2 });
    expect(getTournamentProgress({ ...elimination, matches: elimination.matches.map((match) => ({ ...match, status: "completed" })) })).toMatchObject({ currentRound: 2, totalRounds: 2 });
  });
  it.each([
    { players: 8, done: 0, total: 7, totalRounds: 3 },
    { players: 5, done: 1, total: 6, totalRounds: 3 },
  ])("uses full bracket totals for $players players before later rounds are generated", ({ players, done, total, totalRounds }) => {
    expect(getTournamentProgress(eliminationTournament(players))).toMatchObject({ done, total, currentRound: 1, totalRounds });
  });
  it("keeps elimination totals stable when the next round is generated", () => {
    const tournament = eliminationTournament(8);
    const firstRound = tournament.matches.map((match) => ({ ...match, status: "completed", winnerId: match.playerOneId }));
    const { pairings } = generateSingleElimFirstRound(firstRound.map((match) => match.winnerId));
    const secondRound = pairings.map((pairing, i) => ({ ...tournament.matches[0], ...pairing, id: i + 5, roundNumber: 2 }));
    expect(getTournamentProgress({ ...tournament, matches: [...firstRound, ...secondRound] })).toMatchObject({ done: 4, total: 7, currentRound: 2, totalRounds: 3 });
  });
  it.each([
    ["active", "live", "In progress"], ["completed", "done", "Completed"], ["cancelled", "off", "Cancelled"],
  ])("presents %s with the approved lamp and copy", (status, lamp, label) => {
    expect(statusPresentation(status)).toEqual({ lamp, label });
  });
});
