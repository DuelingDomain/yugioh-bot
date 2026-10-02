import { describe, expect, it } from "vitest";
import { projectMatch } from "@yugidraft/shared/scoring";
import { decidedPlayers, firstGameWinner, groupMatches, matchProjection, matchScore, matchView, reportNames, tournamentRecord, winnerScore } from "../src/components/tournament/matches/match-model";
import { byeMatch, decidedMatch, liveMatch, matches, openMatch, pendingMatch, ratings, seriesFor, tournament } from "./fixtures/matches";

describe("match viewer model", () => {
  it.each([
    ["your-open", openMatch, 5, false, {}],
    ["open", openMatch, 99, false, {}],
    ["open", openMatch, 99, true, {}],
    ["open", openMatch, null, false, {}],
    ["reporting", openMatch, 5, false, { reporting: true }],
    ["open", openMatch, 99, false, { reporting: true }],
    ["reported", pendingMatch, 6, false, {}],
    ["confirm", pendingMatch, 3, false, {}],
    ["pending", pendingMatch, 5, true, {}],
    ["pending", pendingMatch, null, false, {}],
    ["live", liveMatch, 1, false, {}],
    ["live", liveMatch, 5, true, {}],
    ["between-games", { ...liveMatch, series: seriesFor(liveMatch, { status: "between_games" }) }, 1, false, {}],
    ["decided", decidedMatch, 5, true, {}],
    ["bye", byeMatch, 2, true, {}],
    ["reopening", decidedMatch, 5, true, { reopening: true }],
    ["your-open", { ...pendingMatch, status: "open", reporterId: null, winnerId: null, matchId: null }, 3, false, {}],
  ] as const)("derives %s for the viewer", (state, match, playerId, isHost, ui) => {
    expect(matchView(match, playerId, isHost, tournament(), ui).state).toBe(state);
  });

  it("gives reporting and duel start to players, start and Set result to the organizer", () => {
    expect(matchView(openMatch, 5, false, tournament())).toMatchObject({ canReport: true, canStart: true, canSetResult: false, lamp: "you" });
    expect(matchView(openMatch, 99, true, tournament())).toMatchObject({ canReport: false, canStart: true, canSetResult: true });
    expect(matchView(openMatch, 99, false, tournament())).toMatchObject({ canReport: false, canStart: false, canSetResult: false });
  });

  it("only the reporter's opponent can confirm; organizer overrides are separate", () => {
    expect(matchView(pendingMatch, 3, false, tournament()).canConfirm).toBe(true);
    for (const id of [6, 99, null]) expect(matchView(pendingMatch, id, true, tournament()).canConfirm).toBe(false);
    expect(matchView(pendingMatch, 5, true, tournament()).canSetResult).toBe(true);
  });

  it("suppresses reporting/start during a series and restores them after cancellation", () => {
    expect(matchView(liveMatch, 1, true, tournament())).toMatchObject({ canReport: false, canStart: false, canSetResult: true, canOpen: true });
    expect(matchView({ ...liveMatch, series: seriesFor(liveMatch, { status: "cancelled" }) }, 1, false, tournament())).toMatchObject({ canReport: true, canStart: true, canOpen: false });
  });

  it("limits start/Set result to active events and Reopen to decided round robin", () => {
    for (const status of ["completed", "cancelled"]) {
      expect(matchView(openMatch, 5, true, tournament({ status }))).toMatchObject({ canReport: true, canStart: false, canSetResult: false });
      expect(matchView(decidedMatch, 5, true, tournament({ status })).canReopen).toBe(true);
    }
    expect(matchView(decidedMatch, 5, true, tournament({ format: "single_elim" })).canReopen).toBe(false);
    expect(matchView(byeMatch, 5, true, tournament())).toMatchObject({ canReopen: false, canSetResult: false, canStart: false, canReport: false });
  });

  it("groups all 15 board slots, with own open slots first and newest results first", () => {
    const grouped = groupMatches([...matches].reverse(), 5);
    expect(grouped.live.map(m => m.id)).toEqual([3]);
    expect(grouped.pending.map(m => m.id)).toEqual([4]);
    expect(grouped.open.map(m => m.id)).toEqual([2, 1, 6, 5]);
    expect(grouped.decided.map(m => m.id)).toEqual([7, 8, 9, 10, 11, 12, 13, 14, 15]);
    expect(groupMatches([byeMatch, { ...openMatch, status: "completed", winnerId: null }], 5)).toMatchObject({ decided: [], byes: [byeMatch] });
  });

  it("sorts SQLite UTC times and ISO times as instants, with absent dates last", () => {
    const grouped = groupMatches([
      { ...decidedMatch, id: 1, resolvedAt: null },
      { ...decidedMatch, id: 2, resolvedAt: "2026-09-30 21:42:00" },
      { ...decidedMatch, id: 3, resolvedAt: "2026-09-30T20:42:00-02:00" },
    ], 5);
    expect(grouped.decided.map(m => m.id)).toEqual([3, 2, 1]);
  });

  it("orients scores correctly when series seats swap and the second player wins", () => {
    const match = { ...decidedMatch, winnerId: 3, series: seriesFor(decidedMatch, { status: "completed", playerIds: [3, 5], wins: [2, 1] }) };
    expect(matchScore(match)).toBe("1–2");
    expect(winnerScore(match)).toBe("2–1");
    expect(decidedPlayers(match).winner.name).toBe("duelist.josh");
    expect(matchScore({ ...match, series: null })).toBeNull();
  });

  it("derives first-game and report wording without needing game or denial history", () => {
    expect(firstGameWinner(liveMatch)).toBe("Kestrel");
    expect(firstGameWinner({ ...liveMatch, series: seriesFor(liveMatch, { wins: [1, 1], gameNumber: 3 }) })).toBeNull();
    expect(reportNames(pendingMatch)).toEqual({ reporter: "Marik_Mains", other: "duelist.josh", won: true });
    expect(reportNames({ ...pendingMatch, winnerId: 3 }).won).toBe(false);
  });

  it("computes tournament records from completed non-bye slots alone", () => {
    expect(tournamentRecord([...matches, { ...byeMatch, playerOneId: 5, winnerId: 5 }], 5)).toEqual({ wins: 2, losses: 1 });
    expect(tournamentRecord(matches, 6)).toEqual({ wins: 0, losses: 3 });
  });

  it("uses the supplied ratings or the unrated baseline for stakes", () => {
    expect(matchProjection(openMatch, 5, ratings)).toEqual(projectMatch({ myElo: 1184, oppElo: 1062, seasonMultiplier: 1 }));
    expect(matchProjection(openMatch, 5, new Map())).toEqual(projectMatch({ myElo: 1000, oppElo: 1000, seasonMultiplier: 1 }));
  });
});
