// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DuelDeck } from "@yugidraft/shared/duels";
import { TYPE_FUSION } from "../../src/components/duel/constants";
import { makeDeck, makeSeries, makeSeriesRoom } from "../helpers/duel-series";

vi.mock("next/font/google", () => {
  const font = () => ({ variable: "font-var", className: "font-class" });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});

const api = vi.hoisted(() => ({
  readySeries: vi.fn(),
  chooseSeriesFirst: vi.fn(),
  saveSeriesSideDeck: vi.fn(),
  cancelSeries: vi.fn(),
  getDuelCards: vi.fn(),
  searchDuelCards: vi.fn(),
}));

vi.mock("../../src/components/duel/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/components/duel/api")>()),
  ...api,
}));

import { BetweenGamesScreen } from "../../src/components/duel/between-games";

const soon = () => new Date(Date.now() + 42_000).toISOString();

beforeEach(() => {
  api.chooseSeriesFirst.mockReset().mockResolvedValue({ series: makeSeries(), nextSlug: null });
  api.readySeries.mockReset().mockResolvedValue({ series: makeSeries(), nextSlug: null });
  api.saveSeriesSideDeck.mockReset().mockResolvedValue({ series: makeSeries() });
  api.cancelSeries.mockReset().mockResolvedValue(undefined);
  api.searchDuelCards.mockReset().mockResolvedValue({ cards: [] });
  // Card 11 and the 100s are Extra Deck monsters.
  api.getDuelCards.mockReset().mockImplementation(async (codes: number[]) => ({
    cards: codes.map((code) => ({ code, name: `Card ${code}`, type: code === 11 || code >= 100 ? TYPE_FUSION : 1 })),
    missing: [],
  }));
});
afterEach(cleanup);

function screenFor(options: {
  deck?: DuelDeck;
  series?: Parameters<typeof makeSeries>[0];
  mySeat?: number;
  slug?: string;
} = {}) {
  const deck = options.deck ?? makeDeck();
  const series = makeSeries({ status: "between_games", wins: [1, 0], nextGameAt: soon(), hasSide: [true, true], ...options.series });
  const room = makeSeriesRoom({ series, mySeat: options.mySeat, mySide: { baseDeck: deck, currentDeck: deck } });
  const props = { onChanged: vi.fn(), onNavigate: vi.fn() };
  render(<BetweenGamesScreen room={room} slug={options.slug ?? "game-1"} {...props} />);
  return props;
}

const card = (name: string) => screen.findByRole("button", { name });
const counter = () => screen.getByTestId("swap-counter").textContent ?? "";
const readyButton = () => screen.getByRole("button", { name: "Ready" }) as HTMLButtonElement;

describe("BetweenGamesScreen: what it shows", () => {
  it("shows the match score, the next game and who won the last game", async () => {
    screenFor();
    await card("Card 1, Main Deck");
    const region = screen.getByRole("region", { name: "Between games" });
    expect(within(region).getByRole("heading", { level: 1 }).textContent).toBe("Game 2 of 3");
    expect(within(region).getByTestId("between-result").textContent).toBe("Game 1 won by you · 1–0");
    expect(within(region).getByText("Score").textContent).toContain("1–0");
    expect(within(region).getByTestId("between-timer").textContent).toMatch(/Starts in 0:4\d/);
  });

  it("shows the Main, Extra and Side Deck with their counts", async () => {
    screenFor();
    await card("Card 1, Main Deck");
    expect(screen.getByTestId("count-main").textContent).toBe("3");
    expect(screen.getByTestId("count-extra").textContent).toBe("2");
    expect(screen.getByTestId("count-side").textContent).toBe("2");
    expect(screen.getByRole("region", { name: "Side Deck" })).toBeTruthy();
  });

  it("marks a Side card that goes to the Extra Deck", async () => {
    screenFor();
    expect(await card("Card 11, Side Deck, goes to the Extra Deck")).toBeTruthy();
    expect(await card("Card 10, Side Deck")).toBeTruthy();
  });

  it("shows no table settings, format pickers or seat cards", async () => {
    screenFor();
    await card("Card 1, Main Deck");
    expect(screen.queryByRole("region", { name: "Seats" })).toBeNull();
    expect(screen.queryByText(/Registered deck \(locked\)/)).toBeNull();
    expect(screen.queryByText(/Master Rule|Starting LP|Banlist|Time limit/i)).toBeNull();
  });

  it("tells the opponent state: siding, then ready", async () => {
    screenFor();
    await card("Card 1, Main Deck");
    expect(screen.getByTestId("opponent-side-status").textContent).toBe("Opponent is siding…");
    cleanup();
    screenFor({ series: { sideReady: [false, true] } });
    await card("Card 1, Main Deck");
    expect(screen.getByTestId("opponent-side-status").textContent).toBe("Opponent ready");
  });

  it("lets the loser choose to go first or second, and tells the winner who chooses", async () => {
    screenFor({ series: { wins: [0, 1], firstChooser: 0 } });
    await card("Card 1, Main Deck");
    fireEvent.click(screen.getByRole("button", { name: "Go second" }));
    await waitFor(() => expect(api.chooseSeriesFirst).toHaveBeenCalledWith("game-1", "second"));
    cleanup();
    screenFor({ series: { wins: [1, 0], firstChooser: 1 } });
    await card("Card 1, Main Deck");
    expect(screen.queryByTestId("first-choice")).toBeNull();
    expect(screen.getByTestId("opponent-first-status").textContent).toBe("Opponent is choosing to go first or second…");
  });

  it("says the practice bot is always ready", async () => {
    screenFor({ series: { vsBot: true, sideReady: [false, true], playerIds: [1, 0], displayNames: ["Sulman", "Practice Bot"] } });
    await card("Card 1, Main Deck");
    expect(screen.getByText("The practice bot is always ready.")).toBeTruthy();
    expect(screen.getByTestId("opponent-side-status").textContent).toBe("Opponent ready");
    expect(screen.getByText("Practice")).toBeTruthy();
  });

  it("renders nothing for a spectator", () => {
    screenFor({ mySeat: undefined });
    cleanup();
    const room = makeSeriesRoom({ series: makeSeries({ status: "between_games" }), mySeat: null });
    render(<BetweenGamesScreen room={room} slug="game-1" onChanged={vi.fn()} onNavigate={vi.fn()} />);
    expect(screen.queryByTestId("between-games")).toBeNull();
  });
});

describe("BetweenGamesScreen: the swap rule", () => {
  it("starts with nothing out and nothing in, and Ready is on", async () => {
    screenFor();
    await card("Card 1, Main Deck");
    expect(counter()).toContain("0 out · 0 in");
    expect(readyButton().disabled).toBe(false);
  });

  it("counts cards out and cards in, and blocks Ready with a reason while they differ", async () => {
    screenFor();
    fireEvent.click(await card("Card 2, Main Deck"));
    expect(counter()).toContain("1 out · 0 in");
    expect(readyButton().disabled).toBe(true);
    expect(screen.getByTestId("ready-reason").textContent).toBe("Bring in 1 card from the Side Deck, or put 1 card back.");
    expect(screen.getByRole("button", { name: "Card 2, Main Deck, going out" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(await card("Card 10, Side Deck"));
    expect(counter()).toContain("1 out · 1 in");
    expect(readyButton().disabled).toBe(false);
  });

  it("blocks Ready when more cards come in than go out", async () => {
    screenFor();
    fireEvent.click(await card("Card 10, Side Deck"));
    expect(counter()).toContain("0 out · 1 in");
    expect(readyButton().disabled).toBe(true);
    expect(screen.getByTestId("ready-reason").textContent).toBe("Take out 1 card from the Main or Extra Deck, or put 1 card back.");
  });

  it("shows the Side count changing while the marks are uneven and back when they match", async () => {
    screenFor();
    fireEvent.click(await card("Card 2, Main Deck"));
    expect(screen.getByTestId("count-side").textContent).toBe("3");
    fireEvent.click(await card("Card 10, Side Deck"));
    expect(screen.getByTestId("count-side").textContent).toBe("2");
  });

  it("puts an Extra Deck monster that comes in into the Extra Deck", async () => {
    screenFor();
    fireEvent.click(await card("Card 100, Extra Deck"));
    fireEvent.click(await card("Card 11, Side Deck, goes to the Extra Deck"));
    expect(counter()).toContain("1 out · 1 in");
    expect(screen.getByTestId("count-extra").textContent).toBe("2");
    expect(screen.getByRole("button", { name: "Card 11, Extra Deck, coming in" })).toBeTruthy();
    expect(screen.getByTestId("count-main").textContent).toBe("3");
  });

  it("keeps the Main Deck at its base size or more", async () => {
    screenFor();
    // Take Card 1 out of Main and bring the Extra monster in: Main would drop to 2 and Extra grow to 3.
    fireEvent.click(await card("Card 1, Main Deck"));
    fireEvent.click(await card("Card 11, Side Deck, goes to the Extra Deck"));
    expect(counter()).toContain("1 out · 1 in");
    expect(readyButton().disabled).toBe(true);
    expect(screen.getByTestId("ready-reason").textContent).toMatch(/Main Deck needs at least 3 cards/);
  });

  it("takes a mark back when the card is clicked again", async () => {
    screenFor();
    fireEvent.click(await card("Card 2, Main Deck"));
    fireEvent.click(await card("Card 2, Main Deck, going out"));
    expect(counter()).toContain("0 out · 0 in");
    expect(readyButton().disabled).toBe(false);
  });

  it("resets to the deck from the last game", async () => {
    screenFor();
    fireEvent.click(await card("Card 2, Main Deck"));
    fireEvent.click(await card("Card 10, Side Deck"));
    fireEvent.click(screen.getByRole("button", { name: "Reset to the deck from last game" }));
    expect(counter()).toContain("0 out · 0 in");
    expect(screen.getByTestId("count-side").textContent).toBe("2");
  });

  it("has no Reset until something is marked", async () => {
    screenFor();
    await card("Card 1, Main Deck");
    expect((screen.getByRole("button", { name: "Reset to the deck from last game" }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("BetweenGamesScreen: Ready", () => {
  it("saves the sided deck, marks the player ready, and refreshes the room", async () => {
    const props = screenFor();
    fireEvent.click(await card("Card 2, Main Deck"));
    fireEvent.click(await card("Card 10, Side Deck"));
    fireEvent.click(readyButton());
    await waitFor(() => expect(api.readySeries).toHaveBeenCalledWith("game-1"));
    expect(api.saveSeriesSideDeck).toHaveBeenCalledTimes(1);
    const [slug, deck] = api.saveSeriesSideDeck.mock.calls[0] as [string, DuelDeck];
    expect(slug).toBe("game-1");
    expect([...deck.main].sort((a, b) => a - b)).toEqual([1, 3, 10]);
    expect([...deck.side].sort((a, b) => a - b)).toEqual([2, 11]);
    expect(deck.extra).toEqual([100, 101]);
    expect(api.saveSeriesSideDeck.mock.invocationCallOrder[0]).toBeLessThan(api.readySeries.mock.invocationCallOrder[0]);
    await waitFor(() => expect(props.onChanged).toHaveBeenCalled());
  });

  it("sends only Ready when the deck was not changed", async () => {
    screenFor();
    await card("Card 1, Main Deck");
    fireEvent.click(readyButton());
    await waitFor(() => expect(api.readySeries).toHaveBeenCalledWith("game-1"));
    expect(api.saveSeriesSideDeck).not.toHaveBeenCalled();
  });

  it("goes to the next game when Ready starts it", async () => {
    api.readySeries.mockResolvedValue({ series: makeSeries(), nextSlug: "game-2" });
    const props = screenFor();
    await card("Card 1, Main Deck");
    fireEvent.click(readyButton());
    await waitFor(() => expect(props.onNavigate).toHaveBeenCalledWith("game-2"));
  });

  it("sends nothing while the counts differ", async () => {
    screenFor();
    fireEvent.click(await card("Card 2, Main Deck"));
    fireEvent.click(readyButton());
    expect(api.readySeries).not.toHaveBeenCalled();
    expect(api.saveSeriesSideDeck).not.toHaveBeenCalled();
  });

  it("locks the deck and says so once the player is ready", async () => {
    screenFor({ series: { sideReady: [true, false] } });
    fireEvent.click(await card("Card 2, Main Deck"));
    expect(counter()).toContain("0 out · 0 in");
    expect(readyButton().disabled).toBe(true);
    expect(screen.getByTestId("ready-reason").textContent).toBe("You are ready. Waiting for your opponent.");
  });

  it("shows an error from the server", async () => {
    api.readySeries.mockRejectedValue(new Error("The series moved on."));
    screenFor();
    await card("Card 1, Main Deck");
    fireEvent.click(readyButton());
    expect((await screen.findByRole("alert")).textContent).toBe("The series moved on.");
  });

  it("with no Side Deck there is nothing to swap, and Ready sends no deck", async () => {
    screenFor({ deck: makeDeck({ side: [] }), series: { hasSide: [false, true] } });
    fireEvent.click(await card("Card 2, Main Deck"));
    expect(counter()).toContain("0 out · 0 in");
    expect(screen.getByText("No Side Deck. You play the same deck again.")).toBeTruthy();
    expect(screen.getByTestId("ready-reason").textContent).toMatch(/no Side Deck/);
    fireEvent.click(readyButton());
    await waitFor(() => expect(api.readySeries).toHaveBeenCalled());
    expect(api.saveSeriesSideDeck).not.toHaveBeenCalled();
  });
});

describe("BetweenGamesScreen: an interrupted game", () => {
  it("waits for both players with no timer, and a casual series can be cancelled", async () => {
    const props = screenFor({ series: { nextGameAt: null } });
    await card("Card 1, Main Deck");
    expect(screen.getByTestId("between-timer").textContent).toBe("Waiting for both players");
    expect(screen.getByTestId("opponent-side-status").textContent).toBe("Opponent is not ready");
    fireEvent.click(screen.getByRole("button", { name: "Cancel series" }));
    expect(api.cancelSeries).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Confirm cancel" }));
    await waitFor(() => expect(api.cancelSeries).toHaveBeenCalledWith(7));
    await waitFor(() => expect(props.onChanged).toHaveBeenCalled());
  });

  it("offers no Cancel series with a deadline", async () => {
    screenFor();
    await card("Card 1, Main Deck");
    expect(screen.queryByRole("button", { name: "Cancel series" })).toBeNull();
  });
});
