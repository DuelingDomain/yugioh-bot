import { describe, expect, it } from "vitest";
import {
  canCancelInterrupted,
  formatCountdown,
  isBetweenGames,
  nextGameTarget,
  secondsUntil,
  seriesKindLabel,
  seriesOutcome,
  seriesPlayerIndex,
  seriesRecordLabel,
  seriesScoreForViewer,
  seriesScoreText,
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

  it("does not move a spectator, nor anyone once the series is over", () => {
    const open = makeSeries({ currentDuelSlug: "game-2" });
    expect(nextGameTarget(makeSeriesRoom({ series: open, mySeat: null }), "game-1")).toBeNull();
    const done = makeSeries({ status: "completed", currentDuelSlug: "game-2" });
    expect(nextGameTarget(makeSeriesRoom({ series: done }), "game-1")).toBeNull();
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
