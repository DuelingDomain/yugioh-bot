// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
  unreadySeries: vi.fn(),
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
  api.unreadySeries.mockReset().mockResolvedValue({ series: makeSeries(), nextSlug: null });
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
  it("previews the first card when nothing is hovered, not an empty box", async () => {
    screenFor();
    await card("Card 1, Main Deck");
    expect(screen.getByRole("img", { name: "Card 1" }).getAttribute("src")).toBe("/api/cards/1/image");
    expect(screen.queryByText(/Hover a card/)).toBeNull();
    // A hovered card replaces it, and the first card returns when the pointer leaves.
    const other = await card("Card 3, Main Deck");
    fireEvent.pointerEnter(other, { pointerType: "mouse" });
    expect(screen.getByRole("img", { name: "Card 3" })).toBeTruthy();
    fireEvent.pointerLeave(other);
    expect(screen.getByRole("img", { name: "Card 1" })).toBeTruthy();
  });

  it("previews the first Extra or Side card when the Main Deck is empty", async () => {
    screenFor({ deck: { main: [], extra: [100], side: [10] } });
    await card("Card 100, Extra Deck");
    expect(screen.getByRole("img", { name: "Card 100" })).toBeTruthy();
  });

  it("previews a focused card and keeps the clicked card visible after the pointer leaves", async () => {
    screenFor();
    const tile = await card("Card 2, Main Deck");
    fireEvent.focus(tile);
    expect(screen.getByRole("img", { name: "Card 2" }).getAttribute("src")).toBe("/api/cards/2/image");
    fireEvent.click(tile);
    fireEvent.pointerLeave(tile);
    fireEvent.blur(tile);
    expect(screen.getByRole("img", { name: "Card 2" }).getAttribute("src")).toBe("/api/cards/2/image");
  });

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

  it.each([0, 1])("shows each player's actual readiness for seat %s", async (mySeat) => {
    for (const mine of [false, true]) {
      for (const theirs of [false, true]) {
        const sideReady: [boolean, boolean] = mySeat === 0 ? [mine, theirs] : [theirs, mine];
        screenFor({ mySeat, series: { sideReady } });
        await card("Card 1, Main Deck");
        expect(screen.getByTestId("my-side-status").textContent).toBe(mine ? "You are ready." : "You are not ready.");
        expect(screen.getByTestId("opponent-side-status").textContent).toBe(theirs ? "Opponent ready" : "Opponent is siding…");
        expect(screen.queryByText("Both players are ready.") != null).toBe(mine && theirs);
        expect(screen.queryByRole("button", { name: "Not ready" }) != null).toBe(mine);
        expect(screen.queryByRole("button", { name: "Ready" }) != null).toBe(!mine);
        cleanup();
      }
    }
  });

  it.each(["first", "second"] as const)("choosing %s against a ready bot leaves the human unready", async (choice) => {
    const props = screenFor({ deck: makeDeck({ side: [] }), series: {
      vsBot: true, playerIds: [1, 0], firstChooser: 0, sideReady: [false, true], hasSide: [false, false],
    } });
    await card("Card 1, Main Deck");
    fireEvent.click(screen.getByRole("button", { name: `Go ${choice}` }));
    await waitFor(() => expect(props.onChanged).toHaveBeenCalled());
    expect(api.chooseSeriesFirst).toHaveBeenCalledWith("game-1", choice);
    expect(api.readySeries).not.toHaveBeenCalled();
    expect(props.onNavigate).not.toHaveBeenCalled();
    expect(screen.getByTestId("my-side-status").textContent).toBe("You are not ready.");
    expect(screen.queryByText("Both players are ready.")).toBeNull();
    expect(readyButton().disabled).toBe(false);
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
  it("blocks an even total swap that changes Main and Extra counts", async () => {
    screenFor();
    fireEvent.click(await card("Card 100, Extra Deck"));
    fireEvent.click(await card("Card 10, Side Deck"));
    expect(counter()).toContain("1 out · 1 in");
    expect(counter()).toContain("Section sizes changed");
    expect(readyButton().disabled).toBe(true);
    expect(screen.getByTestId("ready-reason").textContent).toBe("Keep the Main Deck at 3 cards and the Extra Deck at 2 cards (last game).");
    expect(screen.getByTestId("count-main").getAttribute("data-tone")).toBe("bad");
    expect(screen.getByTestId("count-extra").getAttribute("data-tone")).toBe("bad");
    fireEvent.click(readyButton());
    expect(api.saveSeriesSideDeck).not.toHaveBeenCalled();
    expect(api.readySeries).not.toHaveBeenCalled();
  });

  it("disables Ready while Side types load and resolves an Extra-for-Extra swap correctly", async () => {
    let resolve!: (value: { cards: Array<{ code: number; name: string; type: number }>; missing: number[] }) => void;
    api.getDuelCards.mockReturnValue(new Promise((done) => { resolve = done; }));
    screenFor();
    expect(readyButton().disabled).toBe(true);
    expect(screen.getByTestId("ready-reason").textContent).toBe("Loading card types…");
    fireEvent.click(screen.getByRole("button", { name: "100, Extra Deck" }));
    fireEvent.click(screen.getByRole("button", { name: "11, Side Deck" }));
    expect(counter()).toContain("1 out · 1 in");
    expect(counter()).not.toContain("Not even");
    expect(readyButton().disabled).toBe(true);
    expect(screen.getByTestId("ready-reason").textContent).toBe("Loading card types…");
    fireEvent.click(readyButton());
    expect(api.readySeries).not.toHaveBeenCalled();
    await act(async () => resolve({ cards: [{ code: 10, name: "Card 10", type: 1 }, { code: 11, name: "Card 11", type: TYPE_FUSION }], missing: [] }));
    expect(screen.getByRole("button", { name: "Card 11, Extra Deck, coming in" })).toBeTruthy();
    expect(screen.getByTestId("count-extra").textContent).toBe("2");
    expect(counter()).toContain("Even");
    expect(readyButton().disabled).toBe(false);
  });

  it("keeps Ready disabled when the lookup fails or leaves a Side type missing", async () => {
    api.getDuelCards.mockResolvedValue({ cards: [{ code: 10, name: "Card 10", type: 1 }], missing: [11] });
    screenFor();
    await card("Card 10, Side Deck");
    expect(readyButton().disabled).toBe(true);
    expect(screen.getByTestId("ready-reason").textContent).toBe("Loading card types…");
    cleanup();
    api.getDuelCards.mockRejectedValue(new Error("Offline"));
    screenFor();
    await act(async () => { await Promise.resolve(); });
    expect(readyButton().disabled).toBe(true);
    expect(screen.getByTestId("ready-reason").textContent).toBe("Loading card types…");
  });

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

  it("keeps the Main Deck at its last-game size", async () => {
    screenFor();
    // Take Card 1 out of Main and bring the Extra monster in: Main would drop to 2 and Extra grow to 3.
    fireEvent.click(await card("Card 1, Main Deck"));
    fireEvent.click(await card("Card 11, Side Deck, goes to the Extra Deck"));
    expect(counter()).toContain("1 out · 1 in");
    expect(readyButton().disabled).toBe(true);
    expect(screen.getByTestId("ready-reason").textContent).toMatch(/Keep the Main Deck at 3 cards/);
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
  it("saves swaps and Reset in order, and Ready waits for the final save", async () => {
    const resolves: Array<() => void> = [];
    api.saveSeriesSideDeck.mockImplementation(() => new Promise<void>((resolve) => { resolves.push(resolve); }));
    screenFor();
    fireEvent.click(await card("Card 2, Main Deck"));
    fireEvent.click(await card("Card 10, Side Deck"));
    await waitFor(() => expect(api.saveSeriesSideDeck).toHaveBeenCalledTimes(1));
    expect(api.readySeries).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Reset to the deck from last game" }));
    fireEvent.click(readyButton());
    await act(async () => { await Promise.resolve(); });
    expect(api.saveSeriesSideDeck).toHaveBeenCalledTimes(1);
    expect(api.readySeries).not.toHaveBeenCalled();
    await act(async () => { resolves[0]!(); });
    await waitFor(() => expect(api.saveSeriesSideDeck).toHaveBeenCalledTimes(2));
    expect(api.saveSeriesSideDeck.mock.calls[1]).toEqual(["game-1", makeDeck()]);
    expect(api.readySeries).not.toHaveBeenCalled();
    await act(async () => { resolves[1]!(); });
    await waitFor(() => expect(api.readySeries).toHaveBeenCalledWith("game-1"));
    expect(api.saveSeriesSideDeck).toHaveBeenCalledTimes(2);
  });

  it("keeps marks and the Reset target when a room refresh echoes an autosave", async () => {
    const deck = makeDeck();
    const series = makeSeries({ status: "between_games", nextGameAt: soon() });
    const room = makeSeriesRoom({ series, mySide: { baseDeck: deck, currentDeck: deck } });
    const props = { slug: "game-1", onChanged: vi.fn(), onNavigate: vi.fn() };
    const view = render(<BetweenGamesScreen room={room} {...props} />);
    fireEvent.click(await card("Card 2, Main Deck"));
    fireEvent.click(await card("Card 10, Side Deck"));
    await waitFor(() => expect(api.saveSeriesSideDeck).toHaveBeenCalledTimes(1));
    const saved = api.saveSeriesSideDeck.mock.calls[0]![1] as DuelDeck;
    view.rerender(<BetweenGamesScreen room={{ ...room, mySide: { baseDeck: deck, currentDeck: saved } }} {...props} />);
    expect(counter()).toContain("1 out · 1 in");
    fireEvent.click(screen.getByRole("button", { name: "Reset to the deck from last game" }));
    await waitFor(() => expect(api.saveSeriesSideDeck).toHaveBeenLastCalledWith("game-1", deck));
    expect(api.readySeries).not.toHaveBeenCalled();
  });

  it("keeps the last valid save while a later swap is incomplete", async () => {
    screenFor();
    fireEvent.click(await card("Card 2, Main Deck"));
    fireEvent.click(await card("Card 10, Side Deck"));
    await waitFor(() => expect(api.saveSeriesSideDeck).toHaveBeenCalledTimes(1));
    fireEvent.click(await card("Card 3, Main Deck"));
    await act(async () => { await Promise.resolve(); });
    expect(api.saveSeriesSideDeck).toHaveBeenCalledTimes(1);
    expect(api.readySeries).not.toHaveBeenCalled();
    expect(readyButton().disabled).toBe(true);
  });

  it("adopts a deck saved in another tab before the player clicks Ready", async () => {
    const deck = makeDeck();
    const series = makeSeries({ status: "between_games", nextGameAt: soon() });
    const room = makeSeriesRoom({ series, mySide: { baseDeck: deck, currentDeck: deck } });
    const props = { slug: "game-1", onChanged: vi.fn(), onNavigate: vi.fn() };
    const view = render(<BetweenGamesScreen room={room} {...props} />);
    await card("Card 1, Main Deck");
    const external: DuelDeck = { ...deck, main: [1, 3, 10], side: [11, 2] };
    view.rerender(<BetweenGamesScreen room={{ ...room, mySide: { baseDeck: deck, currentDeck: external } }} {...props} />);
    expect(await card("Card 10, Main Deck")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Card 2, Main Deck" })).toBeNull();
    expect(counter()).toContain("0 out · 0 in");
    fireEvent.click(readyButton());
    await waitFor(() => expect(api.readySeries).toHaveBeenCalledWith("game-1"));
    expect(api.saveSeriesSideDeck).not.toHaveBeenCalled();
  });

  it("can reset to the previous game's deck after reloading a saved swap", async () => {
    const deck = makeDeck();
    const sided: DuelDeck = { ...deck, main: [1, 3, 10], side: [11, 2] };
    const room = makeSeriesRoom({ series: makeSeries({ status: "between_games", nextGameAt: soon() }),
      myDeck: deck, mySide: { baseDeck: deck, currentDeck: sided } });
    render(<BetweenGamesScreen room={room} slug="game-1" onChanged={vi.fn()} onNavigate={vi.fn()} />);
    await card("Card 10, Main Deck");
    fireEvent.click(screen.getByRole("button", { name: "Reset to the deck from last game" }));
    await waitFor(() => expect(api.saveSeriesSideDeck).toHaveBeenCalledWith("game-1", deck));
    expect(await card("Card 2, Main Deck")).toBeTruthy();
    expect(api.readySeries).not.toHaveBeenCalled();
  });

  it("drops obsolete queued swaps when a deck arrives from another tab", async () => {
    let resolveSave!: () => void;
    api.saveSeriesSideDeck.mockImplementationOnce(() => new Promise<void>((resolve) => { resolveSave = resolve; }));
    const deck = makeDeck();
    const series = makeSeries({ status: "between_games", nextGameAt: soon() });
    const room = makeSeriesRoom({ series, myDeck: deck, mySide: { baseDeck: deck, currentDeck: deck } });
    const props = { slug: "game-1", onChanged: vi.fn(), onNavigate: vi.fn() };
    const view = render(<BetweenGamesScreen room={room} {...props} />);
    fireEvent.click(await card("Card 2, Main Deck"));
    fireEvent.click(await card("Card 10, Side Deck"));
    await waitFor(() => expect(api.saveSeriesSideDeck).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "Reset to the deck from last game" }));
    const external: DuelDeck = { ...deck, main: [2, 3, 10], side: [11, 1] };
    view.rerender(<BetweenGamesScreen room={{ ...room, mySide: { baseDeck: deck, currentDeck: external } }} {...props} />);
    await act(async () => { resolveSave(); });
    // The in-flight save may finish; any queued stale Reset must be discarded and the external deck retained.
    expect(api.saveSeriesSideDeck.mock.calls.slice(1).every(([, saved]) => JSON.stringify(saved) === JSON.stringify(external))).toBe(true);
    expect(await card("Card 10, Main Deck")).toBeTruthy();
    fireEvent.click(readyButton());
    await waitFor(() => expect(api.readySeries).toHaveBeenCalledWith("game-1"));
    expect(api.saveSeriesSideDeck).toHaveBeenLastCalledWith("game-1", external);
  });

  it("abandons an in-flight Ready when another tab changes the deck", async () => {
    const resolves: Array<() => void> = [];
    api.saveSeriesSideDeck.mockImplementation(() => new Promise<void>((resolve) => { resolves.push(resolve); }));
    const deck = makeDeck();
    const room = makeSeriesRoom({ series: makeSeries({ status: "between_games", nextGameAt: soon() }),
      myDeck: deck, mySide: { baseDeck: deck, currentDeck: deck } });
    const props = { slug: "game-1", onChanged: vi.fn(), onNavigate: vi.fn() };
    const view = render(<BetweenGamesScreen room={room} {...props} />);
    fireEvent.click(await card("Card 2, Main Deck"));
    fireEvent.click(await card("Card 10, Side Deck"));
    await waitFor(() => expect(api.saveSeriesSideDeck).toHaveBeenCalledTimes(1));
    fireEvent.click(readyButton());
    const external: DuelDeck = { ...deck, main: [2, 3, 10], side: [11, 1] };
    view.rerender(<BetweenGamesScreen room={{ ...room, mySide: { baseDeck: deck, currentDeck: external } }} {...props} />);
    await act(async () => { resolves[0]!(); });
    await waitFor(() => expect(api.saveSeriesSideDeck).toHaveBeenCalledTimes(2));
    expect(api.readySeries).not.toHaveBeenCalled();
    expect((await screen.findByRole("alert")).textContent).toBe("Your deck changed. Review it and click Ready again.");
    await act(async () => { resolves[1]!(); });
    expect(api.readySeries).not.toHaveBeenCalled();
  });

  it("adopts an external return to an older save after observing only the newest save", async () => {
    const deck = makeDeck();
    const room = makeSeriesRoom({ series: makeSeries({ status: "between_games", nextGameAt: soon() }),
      myDeck: deck, mySide: { baseDeck: deck, currentDeck: deck } });
    const props = { slug: "game-1", onChanged: vi.fn(), onNavigate: vi.fn() };
    const view = render(<BetweenGamesScreen room={room} {...props} />);
    fireEvent.click(await card("Card 2, Main Deck"));
    fireEvent.click(await card("Card 10, Side Deck"));
    await waitFor(() => expect(api.saveSeriesSideDeck).toHaveBeenCalledTimes(1));
    const first = api.saveSeriesSideDeck.mock.calls[0]![1] as DuelDeck;
    fireEvent.click(screen.getByRole("button", { name: "Reset to the deck from last game" }));
    await waitFor(() => expect(api.saveSeriesSideDeck).toHaveBeenCalledTimes(2));
    fireEvent.click(await card("Card 1, Main Deck"));
    fireEvent.click(await card("Card 10, Side Deck"));
    await waitFor(() => expect(api.saveSeriesSideDeck).toHaveBeenCalledTimes(3));
    const latest = api.saveSeriesSideDeck.mock.calls[2]![1] as DuelDeck;
    view.rerender(<BetweenGamesScreen room={{ ...room, mySide: { baseDeck: deck, currentDeck: latest } }} {...props} />);
    view.rerender(<BetweenGamesScreen room={{ ...room, mySide: { baseDeck: deck, currentDeck: first } }} {...props} />);
    expect(await card("Card 10, Main Deck")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Card 1, Main Deck" })).toBeTruthy();
    expect(counter()).toContain("0 out · 0 in");
    await act(async () => { await Promise.resolve(); });
    expect(api.saveSeriesSideDeck).toHaveBeenCalledTimes(3);
  });

  it("retires unobserved completed saves when adopting another tab's deck", async () => {
    const deck = makeDeck();
    const room = makeSeriesRoom({ series: makeSeries({ status: "between_games", nextGameAt: soon() }),
      myDeck: deck, mySide: { baseDeck: deck, currentDeck: deck } });
    const props = { slug: "game-1", onChanged: vi.fn(), onNavigate: vi.fn() };
    const view = render(<BetweenGamesScreen room={room} {...props} />);
    fireEvent.click(await card("Card 2, Main Deck"));
    fireEvent.click(await card("Card 10, Side Deck"));
    await waitFor(() => expect(api.saveSeriesSideDeck).toHaveBeenCalledTimes(1));
    const saved = api.saveSeriesSideDeck.mock.calls[0]![1] as DuelDeck;
    const external: DuelDeck = { ...deck, main: [2, 3, 10], side: [11, 1] };
    view.rerender(<BetweenGamesScreen room={{ ...room, mySide: { baseDeck: deck, currentDeck: external } }} {...props} />);
    view.rerender(<BetweenGamesScreen room={{ ...room, mySide: { baseDeck: deck, currentDeck: saved } }} {...props} />);
    expect(await card("Card 1, Main Deck")).toBeTruthy();
    expect(counter()).toContain("0 out · 0 in");
    await act(async () => { await Promise.resolve(); });
    expect(api.saveSeriesSideDeck).toHaveBeenCalledTimes(1);
  });

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

  it("lets a ready player edit and explains that it takes Ready back", async () => {
    screenFor({ series: { sideReady: [true, false] } });
    fireEvent.click(await card("Card 2, Main Deck"));
    expect(counter()).toContain("1 out · 0 in");
    expect(screen.getByTestId("my-side-status").textContent).toMatch(/no longer ready/);
    expect(api.unreadySeries).toHaveBeenCalledWith("game-1");
  });

  it("shows an error from the server", async () => {
    api.readySeries.mockRejectedValue(new Error("The series moved on."));
    screenFor();
    await card("Card 1, Main Deck");
    fireEvent.click(readyButton());
    expect((await screen.findByRole("alert")).textContent).toBe("The series moved on.");
  });

  it("shows a rejected side-deck submission and does not mark the player ready", async () => {
    api.saveSeriesSideDeck.mockRejectedValue(new Error("The main deck must keep the same number of cards"));
    screenFor();
    fireEvent.click(await card("Card 2, Main Deck"));
    fireEvent.click(await card("Card 10, Side Deck"));
    fireEvent.click(readyButton());
    expect((await screen.findByRole("alert")).textContent).toBe("The main deck must keep the same number of cards");
    expect(api.readySeries).not.toHaveBeenCalled();
  });

  it.each([false, true])("saves valid side changes before timer expiry without Ready (balanced: %s)", async (balanced) => {
    vi.useFakeTimers();
    try {
      const deck = makeDeck();
      const series = makeSeries({ status: "between_games", hasSide: [true, true], nextGameAt: new Date(Date.now() + 1000).toISOString() });
      const room = makeSeriesRoom({ series, mySide: { baseDeck: deck, currentDeck: deck } });
      render(<BetweenGamesScreen room={room} slug="game-1" onChanged={vi.fn()} onNavigate={vi.fn()}
        initialMarks={{ out: [{ section: "main", index: 1 }], inn: balanced ? [0] : [] }} />);
      await act(async () => { await Promise.resolve(); });
      expect(readyButton().disabled).toBe(!balanced);
      await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
      expect(screen.getByTestId("between-timer").textContent).toBe("Starting game 2…");
      expect(api.saveSeriesSideDeck).toHaveBeenCalledTimes(balanced ? 1 : 0);
      if (balanced) expect(api.saveSeriesSideDeck).toHaveBeenCalledWith("game-1", { ...deck, main: [1, 3, 10], side: [11, 2] });
      expect(api.readySeries).not.toHaveBeenCalled();
    } finally {
      cleanup();
      vi.useRealTimers();
    }
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

describe("BetweenGamesScreen: the window has ended", () => {
  const over = () => new Date(Date.now() - 2_000).toISOString();

  it("says the next game is starting, not 0:00, and re-reads the room at once", async () => {
    const props = screenFor({ series: { nextGameAt: over() } });
    expect(screen.getByTestId("between-timer").textContent).toBe("Starting game 2…");
    await waitFor(() => expect(props.onChanged).toHaveBeenCalledTimes(1));
  });

  it("re-reads the room once when the countdown reaches zero while the screen is open", async () => {
    vi.useFakeTimers();
    try {
      const props = screenFor({ series: { nextGameAt: new Date(Date.now() + 1_000).toISOString() } });
      expect(screen.getByTestId("between-timer").textContent).toMatch(/Starts in 0:01/);
      expect(props.onChanged).not.toHaveBeenCalled();
      await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
      expect(screen.getByTestId("between-timer").textContent).toBe("Starting game 2…");
      expect(props.onChanged).toHaveBeenCalledTimes(1);
    } finally {
      cleanup();
      vi.useRealTimers();
    }
  });

  it("keeps counting for an interrupted game that has no deadline", async () => {
    const props = screenFor({ series: { nextGameAt: null } });
    expect(screen.getByTestId("between-timer").textContent).toBe("Waiting for both players");
    expect(props.onChanged).not.toHaveBeenCalled();
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
