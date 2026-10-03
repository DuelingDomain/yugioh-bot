import { describe, expect, it } from "vitest";
import {
  byeNames, champion, liveElsewhere, confirmLine, currentRound, finishedSeries, finishLine, heroCase, heroMatch, initials, nameList, ordinal,
  pageRound, pickMoment, rangeText, recordLine, resultsFeed, roundName, roundWindow, signed, stakesFor, tableNumber, tableStatus, totalRounds,
  tournamentEnding, waitingList, zoneFor, zonesFor, zoneLabel,
} from "@/components/tournament/floor/floor-model";
import type { Match, TournamentDetail } from "@/components/tournament/types";
import { seriesFor, slot, tournament } from "./fixtures/matches";

const done = (id: number, round: number, one: number, two: number, winner: number, extra: Partial<Match> = {}) =>
  slot(id, one, two, { roundNumber: round, status: "completed", winnerId: winner, matchId: id + 100, resolvedAt: `2026-09-2${round}T20:00:00Z`, ...extra });

// Players: 1 Kestrel, 5 Imran, 2 voidpriest, 3 duelist.josh. Round robin of four: three rounds.
function fourPlayers(overrides: Partial<TournamentDetail> = {}): TournamentDetail {
  return tournament({
    participants: [1, 5, 2, 3].map((playerId) => ({ playerId, displayName: ({ 1: "Kestrel", 5: "Imran", 2: "voidpriest", 3: "duelist.josh" } as Record<number, string>)[playerId] })),
    matches: [
      done(1, 1, 5, 1, 5), done(2, 1, 2, 3, 2),
      slot(3, 5, 2, { roundNumber: 2 }), slot(4, 1, 3, { roundNumber: 2 }),
      slot(5, 5, 3, { roundNumber: 3 }), slot(6, 1, 2, { roundNumber: 3 }),
    ],
    ...overrides,
  });
}

describe("rounds", () => {
  it("counts round robin rounds from the matches and the current round from the first unfinished match", () => {
    const t = fourPlayers();
    expect(totalRounds(t)).toBe(3);
    expect(currentRound(t)).toBe(2);
    expect(roundName(t, 2)).toBe("Round 2");
  });

  it("falls to the last round when everything is decided", () => {
    const t = fourPlayers({ matches: [done(1, 1, 5, 1, 5), done(2, 2, 5, 2, 5)] });
    expect(currentRound(t)).toBe(2);
  });

  it("does not let a bye hold the round open", () => {
    const t = fourPlayers({ matches: [slot(1, 5, null, { roundNumber: 1, status: "completed", metadata: { bye: true } }), slot(2, 1, 2, { roundNumber: 2 })] });
    expect(currentRound(t)).toBe(2);
  });

  it("derives single elimination rounds from the field, before later rounds exist, and names the final", () => {
    const t = tournament({ format: "single_elim", participants: [1, 5, 2, 3].map((playerId) => ({ playerId, displayName: `P${playerId}` })), matches: [slot(1, 5, 1), slot(2, 2, 3)] });
    expect(totalRounds(t)).toBe(2);
    expect(roundName(t, 1)).toBe("Round 1");
    expect(roundName(t, 2)).toBe("Final");
  });

  it("numbers tables in id order and skips byes", () => {
    const t = fourPlayers({ matches: [slot(9, 1, 2), slot(7, 5, 3), slot(8, 4, null, { status: "completed", metadata: { bye: true } })] });
    expect(tableNumber(t, t.matches[1])).toBe(1);
    expect(tableNumber(t, t.matches[0])).toBe(2);
    expect(byeNames(t, 1)).toEqual(["BlueEyesBen"]);
    expect(byeNames(t, 1, 4)).toEqual([]);
  });

  it("joins names", () => {
    expect(nameList([])).toBe("");
    expect(nameList(["Kes"])).toBe("Kes");
    expect(nameList(["Kes", "Dara"])).toBe("Kes and Dara");
    expect(nameList(["Kes", "Dara", "Mo"])).toBe("Kes, Dara and Mo");
  });
});

describe("the viewer", () => {
  it("features a match that owes a reply, then a live one, then an open one", () => {
    const open = slot(1, 5, 1, { roundNumber: 1 });
    const live = slot(2, 5, 2, { roundNumber: 2 });
    live.series = seriesFor(live);
    const owes = slot(3, 5, 3, { roundNumber: 3, status: "pending_approval", reporterId: 3, winnerId: 3, matchId: 103 });
    expect(heroMatch(fourPlayers({ matches: [open, live, owes] }), 5)?.id).toBe(3);
    expect(heroMatch(fourPlayers({ matches: [open, live] }), 5)?.id).toBe(2);
    expect(heroMatch(fourPlayers({ matches: [open] }), 5)?.id).toBe(1);
  });

  it("puts a report the viewer made last, since it waits on the opponent", () => {
    const reported = slot(1, 5, 1, { roundNumber: 1, status: "pending_approval", reporterId: 5, winnerId: 5, matchId: 101 });
    const open = slot(2, 5, 2, { roundNumber: 2 });
    expect(heroMatch(fourPlayers({ matches: [reported, open] }), 5)?.id).toBe(2);
    expect(heroMatch(fourPlayers({ matches: [reported] }), 5)?.id).toBe(1);
  });

  it("gives non-participants and spectators no field", () => {
    expect(heroCase(fourPlayers({ isParticipant: false, currentUserPlayerId: null }), null)).toEqual({ kind: "spectator" });
    expect(heroMatch(fourPlayers({ isParticipant: false }), 5)).toBeNull();
  });

  it("explains a bye while the rest of the round plays", () => {
    const t = fourPlayers({ matches: [slot(1, 5, null, { status: "completed", metadata: { bye: true } }), slot(2, 1, 2), slot(3, 5, 1, { roundNumber: 2, status: "completed", winnerId: 5 })] });
    const lone = fourPlayers({ matches: [slot(1, 5, null, { status: "completed", metadata: { bye: true } }), slot(2, 1, 2)] });
    expect(heroCase(lone, 5)).toEqual({ kind: "bye", round: 1, rivals: ["Kestrel", "voidpriest"] });
    expect(heroCase(t, 5).kind).toBe("none");
  });

  it("says a single elimination winner waits to be drawn", () => {
    const t = fourPlayers({ format: "single_elim", matches: [done(1, 1, 5, 1, 5), slot(2, 2, 3)] });
    expect(heroCase(t, 5)).toMatchObject({ kind: "waitdraw", won: true, waiting: ["voidpriest", "duelist.josh"] });
  });

  it("returns none for a player with nothing left", () => {
    expect(heroCase(fourPlayers({ matches: [done(1, 1, 5, 1, 5)] }), 5)).toEqual({ kind: "none" });
    expect(heroCase(fourPlayers({ matches: [] }), 5)).toEqual({ kind: "none" });
  });

  it("shows stakes only for the match the server picked", () => {
    const t = fourPlayers({ stakes: { tournamentMatchId: 3, opponentId: 2, win: 18, loss: -14 } });
    expect(stakesFor(t, t.matches[2])?.win).toBe(18);
    expect(stakesFor(t, t.matches[3])).toBeNull();
    expect(stakesFor(fourPlayers(), t.matches[2])).toBeNull();
    expect(signed(18)).toBe("+18");
    expect(signed(-14)).toBe("−14");
  });
});

describe("zones", () => {
  const t = fourPlayers({
    matches: [
      done(1, 1, 5, 1, 5), done(2, 1, 2, 3, 3),
      slot(3, 5, 2, { roundNumber: 2, status: "pending_approval", reporterId: 2, winnerId: 2, matchId: 103 }),
      slot(5, 5, 3, { roundNumber: 3 }),
      slot(6, 5, null, { roundNumber: 4, status: "completed", metadata: { bye: true } }),
    ],
  });

  it("marks wins, losses, pending results, the featured match and byes", () => {
    expect(zoneFor(t, 5, 1, 5).kind).toBe("win");
    expect(zoneFor(t, 1, 1, 5).kind).toBe("loss");
    expect(zoneFor(t, 5, 2, 5).kind).toBe("ploss");
    expect(zoneFor(t, 2, 2, 5).kind).toBe("pwin");
    expect(zoneFor(t, 5, 3, 5).kind).toBe("now");
    expect(zoneFor(t, 5, 3, null).kind).toBe("open");
    expect(zoneFor(t, 5, 4, 5).kind).toBe("bye");
    expect(zoneFor(t, 1, 3, 5).kind).toBe("none");
  });

  it("calls a live match now even when it is not featured", () => {
    const live = slot(7, 1, 2, { roundNumber: 3 });
    live.series = seriesFor(live);
    expect(zoneFor({ matches: [live] }, 1, 3, null).kind).toBe("now");
  });

  it("builds one zone per round and labels them in plain words", () => {
    const zones = zonesFor(t, 5, 4, 5);
    expect(zones.map((z) => z.kind)).toEqual(["win", "ploss", "now", "bye"]);
    expect(zoneLabel(t, zones[0], 5)).toBe("Round 1, beat Kestrel");
    expect(zoneLabel(t, zones[1], 5)).toBe("Round 2, waiting for you to confirm");
    expect(zoneLabel(t, zones[2], 5)).toBe("Round 3, plays duelist.josh");
    expect(zoneLabel(t, zones[3], 5)).toBe("Round 4, bye");
  });

  it("windows long rows to five zones with counters for the rest", () => {
    expect(roundWindow(5, 3)).toBeNull();
    expect(roundWindow(11, 1)).toEqual({ lo: 1, hi: 5 });
    expect(roundWindow(11, 6)).toEqual({ lo: 4, hi: 8 });
    expect(roundWindow(11, 11)).toEqual({ lo: 7, hi: 11 });
    const zones = zonesFor(t, 5, 4, 5);
    expect(rangeText(zones, 1, 2)).toEqual({ full: "Rounds 1 to 2: 1 win", short: "1 win" });
    expect(rangeText(zones, 3, 3)).toEqual({ full: "Round 3: 1 to play", short: "1 to play" });
  });
});

// Rounds of a round robin are not gated: rounds 1, 4 and 5 can have open matches at once.
describe("the round the page is about", () => {
  const open = (id: number, one: number, two: number, round: number) => slot(id, one, two, { roundNumber: round });
  function scattered(): TournamentDetail {
    return tournament({
      participants: [1, 5, 2, 3].map((playerId) => ({ playerId, displayName: `P${playerId}` })),
      matches: [
        open(1, 2, 3, 1),
        done(2, 2, 5, 1, 5, { roundNumber: 2 }), done(3, 3, 5, 3, 5, { roundNumber: 3 }),
        open(4, 5, 1, 4), open(5, 2, 3, 4),
        open(6, 5, 2, 5), open(7, 1, 3, 5),
      ],
    });
  }

  it("is the lowest round among a player's own open matches", () => {
    const t = scattered();
    expect(currentRound(t)).toBe(1);
    expect(pageRound(t, 5)).toBe(4);
  });

  it("is the lowest round with an open match for a spectator or someone not in the event", () => {
    expect(pageRound({ ...scattered(), isParticipant: false, currentUserPlayerId: null }, null)).toBe(1);
    expect(pageRound({ ...scattered(), isParticipant: false }, 5)).toBe(1);
  });

  it("is the lowest open round for a player with nothing open of their own", () => {
    const t = scattered();
    t.matches = t.matches.filter((m) => m.playerOneId !== 5 || m.status === "completed");
    expect(pageRound(t, 5)).toBe(1);
  });

  it("is the last round once everything is decided", () => {
    const t = fourPlayers({ matches: [done(1, 1, 5, 1, 5), done(2, 2, 5, 2, 5)] });
    expect(pageRound(t, 5)).toBe(2);
    expect(pageRound(t, null)).toBe(2);
  });

  it("follows the match on the field when a reply owed comes before an earlier open match", () => {
    const t = scattered();
    t.matches = t.matches.map((m) => (m.id === 6 ? { ...m, status: "pending_approval", reporterId: 2, winnerId: 2 } : m));
    expect(heroMatch(t, 5)?.roundNumber).toBe(5);
    expect(pageRound(t, 5)).toBe(5);
  });
});

describe("record line", () => {
  it("counts decided matches only", () => {
    expect(recordLine(fourPlayers(), 5)).toBe("1–0 so far");
    expect(recordLine(fourPlayers(), 1)).toBe("0–1 so far");
  });
});

describe("table status", () => {
  it("reads the series, the report, and the result", () => {
    const live = slot(1, 5, 1, { roundNumber: 1 });
    live.series = seriesFor(live, { gameNumber: 2 });
    const t = fourPlayers({ matches: [live] });
    expect(tableStatus(t, live, 5)).toBe("Game 2 in progress");
    live.series = seriesFor(live, { status: "between_games", gameNumber: 2 });
    expect(tableStatus(t, live, 5)).toBe("Between games. Game 3 next.");
    const reported = slot(2, 5, 1, { status: "pending_approval", reporterId: 1, winnerId: 1 });
    expect(tableStatus(t, reported, 5)).toBe("Reported by Kestrel. Waiting for you.");
    expect(tableStatus(t, reported, 9)).toBe("Reported by Kestrel. Waiting for Imran.");
    expect(tableStatus(t, done(3, 1, 5, 1, 5), 5)).toBe("Imran won.");
    const played = done(5, 1, 5, 1, 1);
    played.series = seriesFor(played, { status: "completed", wins: [1, 2] });
    expect(tableStatus(t, played, 5)).toMatch(/^Kestrel won 2–1\.$/);
    expect(tableStatus(t, slot(4, 5, 1), 5)).toBe("Not started");
  });
});

describe("confirm and waiting", () => {
  const reported = slot(3, 5, 2, { roundNumber: 2, status: "pending_approval", reporterId: 2, winnerId: 2, matchId: 103 });

  it("finds the report the viewer must answer and states it without a score", () => {
    const t = fourPlayers({ matches: [reported] });
    expect(confirmLine(t, 5)).toMatchObject({ reporterName: "voidpriest", text: "voidpriest reported by hand that they won." });
    expect(confirmLine(t, 2)).toBeNull();
    expect(confirmLine(t, 1)).toBeNull();
    expect(confirmLine(t, null)).toBeNull();
  });

  it("says the viewer won when the reporter reported a loss", () => {
    const t = fourPlayers({ matches: [{ ...reported, winnerId: 5 }] });
    expect(confirmLine(t, 5)?.text).toBe("voidpriest reported by hand that you won.");
  });

  it("lists waiting reports with the configured window", () => {
    const t = fourPlayers({ matches: [reported], reportConfirmWindowHours: 12 });
    expect(waitingList(t)).toEqual([{ matchId: 3, text: "voidpriest reported beating Imran. Imran confirms within 12 hours, or it approves itself." }]);
  });
});

describe("results feed", () => {
  it("sorts decided matches newest first and ends with the start", () => {
    const t = fourPlayers({
      startedAt: "2026-09-20T18:00:00Z",
      matches: [done(1, 1, 5, 1, 5, { resolvedAt: "2026-09-21T20:00:00Z" }), done(2, 2, 2, 3, 2, { resolvedAt: "2026-09-22T20:00:00Z" }), slot(3, 5, 2)],
    });
    expect(resultsFeed(t).map((f) => f.key)).toEqual(["m2", "m1", "start"]);
    expect(resultsFeed(t)[0].text).toBe("voidpriest beat duelist.josh");
    expect(resultsFeed(t)[2].text).toBe("The tournament started.");
  });

  it("puts matches with no time after the dated ones by id, and drops the start row without a start time", () => {
    const t = fourPlayers({
      startedAt: null,
      matches: [done(1, 1, 5, 1, 5, { resolvedAt: null }), done(2, 2, 2, 3, 2, { resolvedAt: "2026-09-22T20:00:00Z" }), done(3, 3, 5, 2, 5, { resolvedAt: null })],
    });
    expect(resultsFeed(t).map((f) => f.key)).toEqual(["m2", "m3", "m1"]);
  });

  it("adds the game score when an online series backs the result", () => {
    const m = done(1, 1, 5, 1, 5);
    m.series = seriesFor(m, { status: "completed", wins: [2, 1], winnerPlayerId: 5 });
    expect(resultsFeed(fourPlayers({ matches: [m], startedAt: null }))[0].text).toBe("Imran beat Kestrel 2–1");
  });
});

describe("champion and endings", () => {
  const finished = (extra: Partial<TournamentDetail> = {}) => fourPlayers({
    status: "completed",
    matches: [done(1, 1, 5, 1, 5), done(2, 1, 2, 3, 2), done(3, 2, 5, 2, 5), done(4, 2, 1, 3, 1)],
    ...extra,
  });

  it("crowns first place only when it finished", () => {
    expect(tournamentEnding(finished())).toBe("finished");
    expect(champion(finished())).toMatchObject({ playerId: 5, name: "Imran", wins: 2, losses: 0 });
    const early = finished({ matches: [...finished().matches, slot(9, 1, 2, { roundNumber: 3 })] });
    expect(tournamentEnding(early)).toBe("ended-early");
    expect(champion(early)).toBeNull();
    expect(champion(fourPlayers())).toBeNull();
    expect(tournamentEnding(fourPlayers({ status: "cancelled" }))).toBe("cancelled");
  });

  it("takes the final's winner in single elimination", () => {
    const t = finished({ format: "single_elim", matches: [done(1, 1, 5, 1, 5), done(2, 1, 2, 3, 2), done(3, 2, 5, 2, 2)] });
    expect(champion(t)?.playerId).toBe(2);
  });

  it("writes a finish line and ordinals", () => {
    expect(finishLine(finished(), 5)).toBe("You finished 1st with 2–0.");
    expect(finishLine(finished(), 3)).toBe("You finished 4th with 0–2.");
    expect(finishLine(finished({ isParticipant: false }), null)).toBeNull();
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22].map(ordinal)).toEqual(["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd"]);
  });

  it("says a single elimination loser in the final was the runner-up", () => {
    const t = finished({ format: "single_elim", matches: [done(1, 1, 5, 1, 5), done(2, 1, 2, 3, 2), done(3, 2, 5, 2, 2)] });
    expect(finishLine(t, 5)).toBe("You were the runner-up.");
    expect(finishLine(t, 1)).toBe("Your tournament is over.");
  });
});

describe("finished series", () => {
  const before = fourPlayers({ matches: [slot(1, 5, 1), slot(2, 2, 3), done(3, 1, 5, 2, 5)] });

  it("lists matches that became decided and ignores the rest", () => {
    const after = fourPlayers({ matches: [done(1, 1, 5, 1, 5), slot(2, 2, 3), done(3, 1, 5, 2, 5)] });
    expect(finishedSeries(before, after)).toEqual([{ matchId: 1, winnerId: 5, loserId: 1, roundNumber: 1 }]);
    expect(finishedSeries(after, after)).toEqual([]);
  });

  it("counts a match that was not in the earlier payload, but never a bye", () => {
    const after = fourPlayers({ matches: [...before.matches, done(9, 2, 1, 2, 2), slot(10, 5, null, { status: "completed", metadata: { bye: true }, winnerId: 5 })] });
    expect(finishedSeries(before, after).map((f) => f.matchId)).toEqual([9]);
  });

  it("plays the viewer's own result, and for a spectator the first table", () => {
    const finished = [
      { matchId: 7, winnerId: 2, loserId: 3, roundNumber: 2 },
      { matchId: 1, winnerId: 5, loserId: 1, roundNumber: 1 },
    ];
    expect(pickMoment(finished, 5, true)?.matchId).toBe(1);
    expect(pickMoment(finished, 4, true)).toBeNull();
    expect(pickMoment(finished, null, false)?.matchId).toBe(1);
    expect(pickMoment([], 5, true)).toBeNull();
  });
});

describe("initials", () => {
  it("takes two characters and capitalises the first", () => {
    expect(initials("Marik_Mains")).toBe("Ma");
    expect(initials("duelist.josh")).toBe("Du");
    expect(initials("  ")).toBe("?");
  });
});

describe("liveElsewhere", () => {
  it("returns open series outside the shown round, in round order, and skips finished, byes and series without a duel", () => {
    const m = (id: number, round: number, a: number, b: number | null, extra: Partial<Match> = {}) => slot(id, a, b, { roundNumber: round, ...extra });
    const live = (match: Match, extra = {}) => ({ ...match, series: seriesFor(match, extra) });
    const t = tournament({
      matches: [
        m(1, 1, 5, 1),
        live(m(2, 3, 2, 3)),
        live(m(3, 2, 4, 6)),
        live(m(4, 1, 5, 2)),
        live(m(5, 4, 1, 2, { status: "completed", winnerId: 1 })),
        live(m(6, 5, 3, 4), { currentDuelSlug: null }),
        m(7, 2, 6, null, { metadata: { bye: true } }),
      ],
    });
    expect(liveElsewhere(t, 1).map((x) => x.id)).toEqual([3, 2]);
    expect(liveElsewhere(t, 2).map((x) => x.id)).toEqual([4, 2]);
  });
});
