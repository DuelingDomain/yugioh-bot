import { describe, expect, it } from "vitest";
import {
  buildRulesPayload,
  defaultDuelRulesValue,
  isSeriesOpen,
  rulesLocked,
  rulesValueFromTournament,
  seriesScoreLabel,
  startDuelErrorText,
  turnSecondsChoices,
  withMode,
} from "../src/components/tournament/duel-rules";
import { deckSummaryText, parseMyDeckState, registerErrorText } from "../src/components/tournament/my-deck-model";
import type { DuelSeriesSummary } from "../src/components/tournament/types";

function series(overrides: Partial<DuelSeriesSummary> = {}): DuelSeriesSummary {
  return {
    id: 1, bestOf: 3, ranked: false, status: "active", playerIds: [10, 20], displayNames: ["Me", "Bob"],
    wins: [1, 0], gameNumber: 2, currentDuelSlug: "duel-2", winnerPlayerId: null,
    tournamentId: 1, tournamentSlug: "cup", tournamentMatchId: 5, nextGameAt: null,
    sideReady: [false, false], hasSide: [false, false], firstChooser: null, firstChoice: null, vsBot: false,
    ...overrides,
  };
}

describe("duel rules payload", () => {
  it("defaults to Best of 3, normal mode, the TCG banlist and a turn timer", () => {
    const value = defaultDuelRulesValue();
    expect(value.bestOf).toBe(3);
    expect(value.mode).toBe("normal");
    expect(value.banlist).toBe("tcg-2026-09");
    expect(value.turnSeconds).toBe(240);
  });

  it("builds the bestOf + duelRules body", () => {
    expect(buildRulesPayload({ bestOf: 1, mode: "domain", banlist: "none", turnSeconds: 0 })).toEqual({
      bestOf: 1,
      duelRules: { mode: "domain", masterRule: 5, settings: { banlist: "none", turnSeconds: 0 } },
    });
  });

  it("moves the banlist to the mode default when the mode changes", () => {
    const domain = withMode(defaultDuelRulesValue(), "domain");
    expect(domain.mode).toBe("domain");
    expect(domain.banlist).toBe("none");
    expect(withMode(domain, "domain")).toBe(domain);
  });

  it("reads the form value from the tournament, with defaults for missing data", () => {
    expect(rulesValueFromTournament({})).toEqual(defaultDuelRulesValue());
    expect(rulesValueFromTournament({ bestOf: 1 }).bestOf).toBe(1);
  });

  it("keeps a stored turn time that is not in the list", () => {
    expect(turnSecondsChoices(45).map((c) => c.value)).toContain(45);
    expect(turnSecondsChoices(240).map((c) => c.value)).not.toContain(45);
  });

  it("locks the rules when any match has a series", () => {
    expect(rulesLocked([{ series: null }, {}])).toBe(false);
    expect(rulesLocked([{ series: null }, { series: series() }])).toBe(true);
  });
});

describe("series labels", () => {
  const match = { playerOneId: 10, status: "open" };

  it("treats active and between_games as open", () => {
    expect(isSeriesOpen(series({ status: "active" }))).toBe(true);
    expect(isSeriesOpen(series({ status: "between_games" }))).toBe(true);
    expect(isSeriesOpen(series({ status: "completed" }))).toBe(false);
    expect(isSeriesOpen(null)).toBe(false);
  });

  it("shows the game number and score for an open series", () => {
    expect(seriesScoreLabel(series(), match)).toBe("Game 2 · 1–0");
    expect(seriesScoreLabel(series({ status: "between_games", gameNumber: 1 }), match)).toBe("Between games · 1–0");
  });

  it("orders the score like the match card players", () => {
    expect(seriesScoreLabel(series({ playerIds: [20, 10], wins: [0, 1] }), match)).toBe("Game 2 · 1–0");
  });

  it("shows the final score only for a completed match", () => {
    const done = series({ status: "completed", wins: [2, 1] });
    expect(seriesScoreLabel(done, { playerOneId: 10, status: "completed" })).toBe("Final · 2–1");
    expect(seriesScoreLabel(done, match)).toBeNull();
    expect(seriesScoreLabel(series({ status: "cancelled" }), match)).toBeNull();
    expect(seriesScoreLabel(null, match)).toBeNull();
  });
});

describe("start duel errors", () => {
  it("points a missing deck at My deck", () => {
    const text = startDuelErrorText(409, "Both players need a registered deck.");
    expect(text).toContain("Both players need a registered deck");
    expect(text).toContain("My deck");
  });

  it("passes other errors through", () => {
    expect(startDuelErrorText(403, "Not your match")).toBe("Not your match");
    expect(startDuelErrorText(409, "Tournament is not active")).toBe("Tournament is not active");
  });
});

describe("my deck response", () => {
  it("parses a registration, the draft and the deck options", () => {
    const state = parseMyDeckState({
      registration: { savedDeckId: 4, deck: { main: [1, 2], extra: [3], side: [] }, lockedAt: null },
      draft: { id: 9, slug: "abc" },
      savedDeckOptions: [{ id: 4, name: "Goat", mainCount: 40 }, { id: 5 }, { name: "bad" }],
    });
    expect(state?.registration?.savedDeckId).toBe(4);
    expect(state?.draft).toEqual({ id: 9, slug: "abc" });
    expect(state?.savedDeckOptions).toEqual([
      { id: 4, name: "Goat", mainCount: 40 },
      { id: 5, name: "Deck 5", mainCount: null },
    ]);
  });

  it("gives null for an unusable response", () => {
    expect(parseMyDeckState([])).toBeNull();
    expect(parseMyDeckState(null)).toBeNull();
  });

  it("summarizes deck counts and joins validation issues to the error", () => {
    expect(deckSummaryText("Goat", { main: [1, 2], extra: [3], side: [] })).toBe("Goat, 2 main, 1 extra, 0 side");
    expect(deckSummaryText(null, { main: [], extra: [], side: [] })).toBe("0 main, 0 extra, 0 side");
    expect(registerErrorText({ error: "Deck is not legal.", report: { issues: [{ message: "Too few cards." }] } }, "x")).toBe(
      "Deck is not legal. Too few cards.",
    );
    expect(registerErrorText(null, "fallback")).toBe("fallback");
  });
});
