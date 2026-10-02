import { describe, expect, it } from "vitest";
import {
  betweenGamesInfo,
  opponentFirstStatus,
  viewerChoosesFirst,
  canCancelInterrupted,
  formatCountdown,
  isBetweenGames,
  nextGameTarget,
  opponentSideStatus,
  secondsUntil,
  seriesCompactScore,
  seriesGameLabel,
  seriesKindLabel,
  seriesOutcome,
  seriesPlayerIndex,
  seriesReadyRows,
  seriesRecordLabel,
  seriesScoreForViewer,
  seriesScoreText,
  spectatorSeriesStatus,
  seriesWinnerIndex,
} from "../src/components/duel/series-model";
import { makeSeries, makeSeriesRoom } from "./helpers/duel-series";

describe("series index", () => {
  it("uses the player id position in playerIds, not the seat", () => {
    const series = makeSeries({ playerIds: [2, 1] });
    expect(seriesPlayerIndex(makeSeriesRoom({ series, mySeat: 0 }), series)).toBe(1);
    expect(seriesPlayerIndex(makeSeriesRoom({ series, mySeat: 1 }), series)).toBe(0);
  });

  it("is null for a spectator", () => {
    const series = makeSeries();
    expect(seriesPlayerIndex(makeSeriesRoom({ series, mySeat: null }), series)).toBeNull();
  });
});

describe("score and labels", () => {
  it("shows the score in playerIds order, or from the viewer's side", () => {
    const series = makeSeries({ wins: [2, 1] });
    expect(seriesScoreText(series)).toBe("2 – 1");
    expect(seriesScoreForViewer(series, 0)).toBe("2 – 1");
    expect(seriesScoreForViewer(series, 1)).toBe("1 – 2");
    expect(seriesScoreForViewer(series, null)).toBe("2 – 1");
  });

  it("names the kind of match", () => {
    expect(seriesKindLabel({ tournamentId: 4, ranked: false })).toBe("Tournament");
    expect(seriesKindLabel({ tournamentId: null, ranked: true })).toBe("Ranked");
    expect(seriesKindLabel({ tournamentId: null, ranked: false })).toBe("Unranked");
  });

  it("says what the finished series recorded", () => {
    const done = { status: "completed" as const, winnerPlayerId: 1 };
    expect(seriesRecordLabel(makeSeries({ status: "active" }))).toBeNull();
    expect(seriesRecordLabel(makeSeries({ ...done, tournamentId: 3 }))).toBe("Recorded to the bracket");
    expect(seriesRecordLabel(makeSeries({ ...done, ranked: true }))).toBe("Ranked result recorded");
    expect(seriesRecordLabel(makeSeries(done))).toBe("Unranked");
    expect(seriesRecordLabel(makeSeries({ status: "completed", winnerPlayerId: null }))).toMatch(/Draw/);
  });
});

describe("seriesOutcome", () => {
  it("tells the winner and the final score from the viewer's side", () => {
    const series = makeSeries({ status: "completed", winnerPlayerId: 2, wins: [1, 2] });
    expect(seriesOutcome(series, 1)).toEqual({ headline: "You win the series", detail: "Final score 2 – 1" });
    expect(seriesOutcome(series, 0)).toEqual({ headline: "Imran wins the series", detail: "Final score 1 – 2" });
    expect(seriesOutcome(series, null)?.headline).toBe("Imran wins the series");
  });

  it("is null while the series is open", () => {
    expect(seriesOutcome(makeSeries({ status: "between_games" }), 0)).toBeNull();
  });

  it("handles a cancelled series", () => {
    expect(seriesOutcome(makeSeries({ status: "cancelled" }), 0)?.headline).toBe("Series cancelled");
  });
});

describe("countdown", () => {
  it("rounds up and never goes below zero", () => {
    const now = Date.parse("2026-01-01T00:00:00Z");
    expect(secondsUntil("2026-01-01T00:00:42.200Z", now)).toBe(43);
    expect(secondsUntil("2025-12-31T23:59:00Z", now)).toBe(0);
    expect(secondsUntil(null, now)).toBeNull();
    expect(secondsUntil("not a date", now)).toBeNull();
  });

  it("formats minutes and seconds", () => {
    expect(formatCountdown(42)).toBe("0:42");
    expect(formatCountdown(75)).toBe("1:15");
    expect(formatCountdown(-3)).toBe("0:00");
  });
});

describe("following the series", () => {
  it("sends a seated player to the latest game of an open series", () => {
    const series = makeSeries({ status: "active", currentDuelSlug: "game-2" });
    expect(nextGameTarget(makeSeriesRoom({ series }), "game-1")).toBe("game-2");
    expect(nextGameTarget(makeSeriesRoom({ series }), "game-2")).toBeNull();
  });

  it("moves a spectator who watched this game while it was the series' current game", () => {
    const open = makeSeries({ status: "active", currentDuelSlug: "game-2" });
    const room = makeSeriesRoom({ series: open, mySeat: null });
    expect(nextGameTarget(room, "game-1", { followAsSpectator: true })).toBe("game-2");
    expect(nextGameTarget(room, "game-2", { followAsSpectator: true })).toBeNull();
  });

  it("leaves a spectator who opened an older game of an open series where they are", () => {
    const open = makeSeries({ status: "active", currentDuelSlug: "game-2" });
    expect(nextGameTarget(makeSeriesRoom({ series: open, mySeat: null }), "game-1")).toBeNull();
    expect(nextGameTarget(makeSeriesRoom({ series: open, mySeat: null }), "game-1", { followAsSpectator: false })).toBeNull();
  });

  it("moves a spectator of a private table to the next game", () => {
    const room = makeSeriesRoom({ series: makeSeries({ status: "active", currentDuelSlug: "game-2" }), mySeat: null });
    room.session.settings = { visibility: "private" } as typeof room.session.settings;
    expect(nextGameTarget(room, "game-1", { followAsSpectator: true })).toBe("game-2");
    expect(nextGameTarget(room, "game-1")).toBeNull();
  });

  it("moves nobody once the series is over", () => {
    const done = makeSeries({ status: "completed", currentDuelSlug: "game-2" });
    expect(nextGameTarget(makeSeriesRoom({ series: done }), "game-1")).toBeNull();
    expect(nextGameTarget(makeSeriesRoom({ series: done, mySeat: null }), "game-1", { followAsSpectator: true })).toBeNull();
    const cancelled = makeSeries({ status: "cancelled", currentDuelSlug: "game-2" });
    expect(nextGameTarget(makeSeriesRoom({ series: cancelled, mySeat: null }), "game-1", { followAsSpectator: true })).toBeNull();
  });

  it("finds the side deck window for this game only", () => {
    const between = makeSeries({ status: "between_games" });
    expect(isBetweenGames(makeSeriesRoom({ series: between }), "game-1")).toBe(true);
    expect(isBetweenGames(makeSeriesRoom({ series: between }), "game-0")).toBe(false);
    expect(isBetweenGames(makeSeriesRoom({ series: makeSeries({ status: "active" }) }), "game-1")).toBe(false);
  });

  it("offers Cancel series only for an interrupted casual series", () => {
    expect(canCancelInterrupted(makeSeries({ status: "between_games", nextGameAt: null }))).toBe(true);
    expect(canCancelInterrupted(makeSeries({ status: "between_games", nextGameAt: "2026-01-01T00:00:00Z" }))).toBe(false);
    expect(canCancelInterrupted(makeSeries({ status: "between_games", tournamentId: 1 }))).toBe(false);
  });
});

describe("seriesGameLabel", () => {
  it("names the game and the score of a Best of 3, the viewer's wins first", () => {
    const room = makeSeriesRoom({ series: makeSeries({ wins: [1, 0], gameNumber: 2 }), status: "active" });
    room.session.gameNumber = 2;
    expect(seriesGameLabel(room)).toEqual({ game: "Game 2 of 3", score: "1–0", title: "You 1 – 0 Imran" });
    const other = makeSeriesRoom({ series: makeSeries({ wins: [1, 0], gameNumber: 2 }), mySeat: 1, status: "active" });
    other.session.gameNumber = 2;
    expect(seriesGameLabel(other)).toEqual({ game: "Game 2 of 3", score: "0–1", title: "You 0 – 1 Sulman" });
  });

  it("uses the game of the duel on screen, not the latest game of the series", () => {
    const room = makeSeriesRoom({ series: makeSeries({ status: "completed", wins: [2, 1], gameNumber: 3 }) });
    room.session.gameNumber = 1;
    expect(seriesGameLabel(room)?.game).toBe("Game 1 of 3");
  });

  it("shows a spectator the names in player order", () => {
    const room = makeSeriesRoom({ series: makeSeries({ wins: [1, 0] }), mySeat: null, status: "active" });
    expect(seriesGameLabel(room)?.title).toBe("Sulman 1 – 0 Imran");
    expect(seriesGameLabel(room)?.score).toBe("1–0");
  });

  it("is null for a single game, a Best of 1 and a cancelled series", () => {
    expect(seriesGameLabel(makeSeriesRoom({ series: null }))).toBeNull();
    expect(seriesGameLabel(makeSeriesRoom({ series: makeSeries({ bestOf: 1 }) }))).toBeNull();
    expect(seriesGameLabel(makeSeriesRoom({ series: makeSeries({ status: "cancelled" }) }))).toBeNull();
  });

  it("writes the compact score", () => {
    expect(seriesCompactScore({ wins: [2, 1] }, 0)).toBe("2–1");
    expect(seriesCompactScore({ wins: [2, 1] }, 1)).toBe("1–2");
    expect(seriesCompactScore({ wins: [2, 1] }, null)).toBe("2–1");
  });
});

describe("betweenGamesInfo", () => {
  const between = (overrides: Parameters<typeof makeSeries>[0] = {}) =>
    makeSeries({ status: "between_games", wins: [1, 0], ...overrides });

  it("says who won, the score, the next game and that the opponent is choosing", () => {
    const room = makeSeriesRoom({ series: between({ firstChooser: 1 }) });
    room.session.winnerSeat = 0;
    expect(betweenGamesInfo(room, "game-1")).toEqual({
      result: "Game 1 won by you · 1–0",
      next: "Game 2 of 3",
      first: "Opponent is choosing to go first or second…",
    });
  });

  it("tells the loser that they choose, and what they chose", () => {
    const room = makeSeriesRoom({ series: between({ wins: [0, 1], firstChooser: 0 }) });
    room.session.winnerSeat = 1;
    expect(betweenGamesInfo(room, "game-1")).toEqual({
      result: "Game 1 won by Imran · 0–1",
      next: "Game 2 of 3",
      first: "You choose to go first or second",
    });
    const chose = makeSeriesRoom({ series: between({ wins: [0, 1], firstChooser: 0, firstChoice: "second" }) });
    chose.session.winnerSeat = 1;
    expect(betweenGamesInfo(chose, "game-1")?.first).toBe("Imran goes first (you chose to go second)");
    const first = makeSeriesRoom({ series: between({ wins: [0, 1], firstChooser: 0, firstChoice: "first" }) });
    first.session.winnerSeat = 1;
    expect(betweenGamesInfo(first, "game-1")?.first).toBe("You go first (you chose to go first)");
  });

  it("tells the winner what the opponent chose", () => {
    const room = makeSeriesRoom({ series: between({ firstChooser: 1, firstChoice: "second" }) });
    room.session.winnerSeat = 0;
    expect(betweenGamesInfo(room, "game-1")?.first).toBe("You go first (the opponent chose to go second)");
  });

  it("labels the default order for a series saved before the choice existed", () => {
    const room = makeSeriesRoom({ series: between({ wins: [0, 1] }) });
    room.session.winnerSeat = 1;
    expect(betweenGamesInfo(room, "game-1")?.first).toBe("You go first (default order)");
  });

  it.each(["first", "second"] as const)("names who goes first for a spectator after the loser chooses %s", (choice) => {
    const room = makeSeriesRoom({ series: between({ firstChooser: 1, firstChoice: choice }), mySeat: null });
    expect(betweenGamesInfo(room, "game-1")?.first).toBe(
      `${choice === "first" ? "Imran" : "Sulman"} goes first (Imran chose to go ${choice})`,
    );
  });

  it("names the chooser to a spectator without announcing the order before the choice", () => {
    const room = makeSeriesRoom({ series: between({ firstChooser: 1 }), mySeat: null });
    expect(betweenGamesInfo(room, "game-1")?.first).toBe("Imran is choosing to go first or second…");
  });

  it("uses the winner's player id when the session has one", () => {
    const room = makeSeriesRoom({ series: between({ wins: [0, 1] }) });
    room.session.winnerPlayerId = 2;
    room.session.winnerSeat = null;
    expect(betweenGamesInfo(room, "game-1")?.result).toBe("Game 1 won by Imran · 0–1");
  });

  it("swaps the seats after a draw or an interrupted game", () => {
    const draw = makeSeriesRoom({ series: between({ wins: [0, 0] }) });
    draw.session.winnerSeat = null;
    expect(betweenGamesInfo(draw, "game-1")).toMatchObject({ result: "Game 1 was a draw · 0–0", first: "Imran goes first (the seats swap)" });
    const cut = makeSeriesRoom({ series: between({ wins: [0, 0], nextGameAt: null }), status: "interrupted" });
    cut.session.winnerSeat = null;
    expect(betweenGamesInfo(cut, "game-1")).toMatchObject({ result: "Game 1 did not finish · 0–0" });
  });

  it("counts the game number from the duel on screen", () => {
    const room = makeSeriesRoom({ series: between({ wins: [1, 1], gameNumber: 2 }) });
    room.session.gameNumber = 2;
    room.session.winnerSeat = 1;
    expect(betweenGamesInfo(room, "game-1")).toMatchObject({ result: "Game 2 won by Imran · 1–1", next: "Game 3 of 3" });
  });

  it("is null unless the series waits between games on this duel", () => {
    expect(betweenGamesInfo(makeSeriesRoom({ series: makeSeries({ status: "active" }) }), "game-1")).toBeNull();
    expect(betweenGamesInfo(makeSeriesRoom({ series: makeSeries({ status: "completed" }) }), "game-1")).toBeNull();
    expect(betweenGamesInfo(makeSeriesRoom({ series: between() }), "another-game")).toBeNull();
    expect(betweenGamesInfo(makeSeriesRoom({ series: null }), "game-1")).toBeNull();
  });
});

describe("opponentSideStatus", () => {
  it("says the opponent is siding until they click Ready", () => {
    const series = makeSeries({ status: "between_games", nextGameAt: "2026-10-01T10:00:00.000Z", sideReady: [false, false] });
    expect(opponentSideStatus(series, 0)).toEqual({ text: "Opponent is siding…", ready: false });
    expect(opponentSideStatus({ ...series, sideReady: [false, true] }, 0)).toEqual({ text: "Opponent ready", ready: true });
    expect(opponentSideStatus({ ...series, sideReady: [true, false] }, 1)).toEqual({ text: "Opponent ready", ready: true });
  });

  it("does not say siding when no deadline runs, and is null for a spectator", () => {
    const series = makeSeries({ status: "between_games", nextGameAt: null });
    expect(opponentSideStatus(series, 0)).toEqual({ text: "Opponent is not ready", ready: false });
    expect(opponentSideStatus(series, null)).toBeNull();
  });
});

describe("seriesReadyRows", () => {
  it("lists both players by name with their Ready state while the side deck window runs", () => {
    const series = makeSeries({ status: "between_games", nextGameAt: "2026-10-01T10:00:00.000Z", sideReady: [true, false] });
    expect(seriesReadyRows(series)).toEqual([
      { name: "Sulman", ready: true, text: "Ready" },
      { name: "Imran", ready: false, text: "Side decking…" },
    ]);
  });

  it("says not ready instead of side decking when no deadline runs", () => {
    const series = makeSeries({ status: "between_games", nextGameAt: null, sideReady: [false, true] });
    expect(seriesReadyRows(series)).toEqual([
      { name: "Sulman", ready: false, text: "Not ready" },
      { name: "Imran", ready: true, text: "Ready" },
    ]);
  });
});

describe("spectatorSeriesStatus", () => {
  const spectator = (overrides: Parameters<typeof makeSeries>[0], slug = "game-1") =>
    spectatorSeriesStatus(makeSeriesRoom({ series: makeSeries(overrides), mySeat: null }), slug);

  it("tells a spectator that the players are side decking, with both Ready states", () => {
    const status = spectator({ status: "between_games", wins: [1, 0], nextGameAt: "2026-10-01T10:00:00.000Z", sideReady: [false, true] });
    expect(status).toEqual({
      kind: "siding",
      headline: "Side decking in progress",
      detail: "Game 2 of 3 starts when both players are ready or the timer runs out.",
      players: [
        { name: "Sulman", ready: false, text: "Side decking…" },
        { name: "Imran", ready: true, text: "Ready" },
      ],
      follow: true,
    });
  });

  it("waits for both players after an interrupted game", () => {
    const status = spectator({ status: "between_games", nextGameAt: null });
    expect(status).toMatchObject({
      kind: "siding",
      headline: "Waiting for both players",
      detail: "Game 2 of 3 starts when both players click Ready.",
    });
  });

  it("waits for the first/second choice even when both players are ready", () => {
    expect(spectator({ status: "between_games", nextGameAt: "2030-01-01T00:00:00.000Z", sideReady: [true, true], firstChooser: 1 })).toMatchObject({
      detail: "Game 2 of 3 starts when both players are ready and the first/second choice is made, or the timer runs out.",
    });
    expect(spectator({ status: "between_games", nextGameAt: "2030-01-01T00:00:00.000Z", sideReady: [true, true], firstChooser: 1, firstChoice: "second" })).toMatchObject({
      detail: "Game 2 of 3 starts when both players are ready or the timer runs out.",
    });
  });

  it("points at the next game once it is being played", () => {
    expect(spectator({ status: "active", wins: [1, 0], gameNumber: 2, currentDuelSlug: "game-2" })).toEqual({
      kind: "next-live",
      headline: "Game 2 of 3 is live",
      nextSlug: "game-2",
      follow: true,
    });
  });

  it("offers to follow into the next private game", () => {
    const room = makeSeriesRoom({ series: makeSeries({ status: "active", gameNumber: 2, currentDuelSlug: "game-2" }), mySeat: null });
    room.session.settings = { visibility: "private" } as typeof room.session.settings;
    expect(spectatorSeriesStatus(room, "game-1")).toMatchObject({ kind: "next-live", follow: true });
  });

  it("tells a private spectator they will follow after side decking", () => {
    const room = makeSeriesRoom({ series: makeSeries({ status: "between_games", nextGameAt: "2026-10-01T10:00:00.000Z" }), mySeat: null });
    room.session.settings = { visibility: "private" } as typeof room.session.settings;
    expect(spectatorSeriesStatus(room, "game-1")).toMatchObject({ kind: "siding", follow: true });
  });

  it("is null for a player, a decided series and a game still in play", () => {
    const between = makeSeries({ status: "between_games", nextGameAt: "2026-10-01T10:00:00.000Z" });
    expect(spectatorSeriesStatus(makeSeriesRoom({ series: between }), "game-1")).toBeNull();
    expect(spectator({ status: "completed", winnerPlayerId: 1, wins: [2, 1] })).toBeNull();
    expect(spectator({ status: "cancelled" })).toBeNull();
    expect(spectator({ status: "active", currentDuelSlug: "game-1" })).toBeNull();
    expect(spectatorSeriesStatus(makeSeriesRoom({ series: null, mySeat: null }), "game-1")).toBeNull();
  });
});

describe("the first or second choice", () => {
  const between = (overrides: Parameters<typeof makeSeries>[0] = {}) =>
    makeSeries({ status: "between_games", wins: [0, 1], nextGameAt: "2030-01-01T00:00:00.000Z", ...overrides });

  it("says that the viewer chooses only when they are the chooser between games", () => {
    expect(viewerChoosesFirst(between({ firstChooser: 0 }), 0)).toBe(true);
    expect(viewerChoosesFirst(between({ firstChooser: 0 }), 1)).toBe(false);
    expect(viewerChoosesFirst(between({ firstChooser: null }), 0)).toBe(false);
    expect(viewerChoosesFirst(between({ firstChooser: 0 }), null)).toBe(false);
    expect(viewerChoosesFirst(makeSeries({ status: "active", firstChooser: 0 }), 0)).toBe(false);
  });

  it("shows the opponent's choosing state and then the result", () => {
    expect(opponentFirstStatus(between({ firstChooser: 1 }), 0)).toEqual({ text: "Opponent is choosing to go first or second…", done: false });
    expect(opponentFirstStatus(between({ firstChooser: 1, firstChoice: "second" }), 0)).toEqual({ text: "Opponent chose to go second", done: true });
    expect(opponentFirstStatus(between({ firstChooser: 0 }), 0)).toBeNull();
    expect(opponentFirstStatus(between({ firstChooser: null }), 0)).toBeNull();
  });

  it("names the chooser to a spectator", () => {
    expect(opponentFirstStatus(between({ firstChooser: 0 }), null)).toEqual({ text: "Sulman is choosing to go first or second…", done: false });
    expect(opponentFirstStatus(between({ firstChooser: 0, firstChoice: "first" }), null)).toEqual({ text: "Sulman chose to go first", done: true });
  });
});

describe("a series against the practice bot", () => {
  const botSeries = (overrides: Parameters<typeof makeSeries>[0] = {}) =>
    makeSeries({ vsBot: true, playerIds: [1, 0], displayNames: ["Sulman", "Practice Bot"], ...overrides });
  const botRoom = (series: ReturnType<typeof makeSeries>, winnerSeat: number | null) => {
    const room = makeSeriesRoom({ series });
    room.session.seats[1] = { seat: 1, playerId: null, displayName: "Practice Bot", ready: true, isBot: true } as never;
    room.session.winnerSeat = winnerSeat;
    return room;
  };

  it("finds the human at index 0", () => {
    const series = botSeries();
    expect(seriesPlayerIndex(makeSeriesRoom({ series, mySeat: 0 }), series)).toBe(0);
  });

  it("counts the bot as the winner of a finished series, and no one as a draw winner", () => {
    expect(seriesWinnerIndex(botSeries({ status: "completed", wins: [1, 2] }))).toBe(1);
    expect(seriesWinnerIndex(botSeries({ status: "completed", wins: [2, 1], winnerPlayerId: 1 }))).toBe(0);
    expect(seriesWinnerIndex(botSeries({ status: "active", wins: [0, 1] }))).toBeNull();
  });

  it("names the bot as the series winner and says nothing is recorded", () => {
    const lost = botSeries({ status: "completed", wins: [1, 2] });
    expect(seriesOutcome(lost, 0)).toEqual({ headline: "Practice Bot wins the series", detail: "Final score 1 – 2" });
    expect(seriesOutcome(botSeries({ status: "completed", wins: [2, 0], winnerPlayerId: 1 }), 0)?.headline).toBe("You win the series");
    expect(seriesRecordLabel(lost)).toBe("Practice match. No result recorded");
    expect(seriesKindLabel(lost)).toBe("Practice");
  });

  it("names the bot as the winner of a game, and lets the beaten human choose", () => {
    const room = botRoom(botSeries({ status: "between_games", wins: [0, 1], firstChooser: 0 }), 1);
    expect(betweenGamesInfo(room, "game-1")).toEqual({
      result: "Game 1 won by Practice Bot · 0–1",
      next: "Game 2 of 3",
      first: "You choose to go first or second",
    });
  });

  it("shows that the beaten bot goes first by itself", () => {
    const room = botRoom(botSeries({ status: "between_games", wins: [1, 0], firstChooser: 1, firstChoice: "first" }), 0);
    expect(betweenGamesInfo(room, "game-1")).toMatchObject({
      result: "Game 1 won by you · 1–0",
      first: "Practice Bot goes first (the opponent chose to go first)",
    });
  });

  it("swaps the seats after a draw with the bot in seat 1", () => {
    const room = botRoom(botSeries({ status: "between_games", wins: [0, 0] }), null);
    expect(betweenGamesInfo(room, "game-1")?.first).toBe("Practice Bot goes first (the seats swap)");
  });
});
