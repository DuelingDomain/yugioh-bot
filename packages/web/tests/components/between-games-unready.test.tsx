// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DuelRequestError } from "../../src/components/duel/api";
import { TYPE_FUSION } from "../../src/components/duel/constants";
import { makeDeck, makeSeries, makeSeriesRoom } from "../helpers/duel-series";

vi.mock("next/font/google", () => {
  const font = () => ({ variable: "font-var", className: "font-class" });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});
const api = vi.hoisted(() => ({
  readySeries: vi.fn(), unreadySeries: vi.fn(), saveSeriesSideDeck: vi.fn(),
  chooseSeriesFirst: vi.fn(), getDuelCards: vi.fn(), searchDuelCards: vi.fn(),
}));
vi.mock("../../src/components/duel/api", async (original) => ({
  ...(await original<typeof import("../../src/components/duel/api")>()), ...api,
}));
import { BetweenGamesScreen } from "../../src/components/duel/between-games";

const base = makeDeck();
const sided = { main: [1, 3, 10], extra: [100, 101], side: [11, 2] };
function between(overrides: Parameters<typeof makeSeries>[0] = {}) {
  return makeSeries({ status: "between_games", nextGameAt: new Date(Date.now() + 60_000).toISOString(),
    hasSide: [true, true], ...overrides });
}
beforeEach(() => {
  api.readySeries.mockReset().mockResolvedValue({ series: between({ sideReady: [true, false] }), nextSlug: null });
  api.unreadySeries.mockReset().mockResolvedValue({ series: between(), nextSlug: null });
  api.saveSeriesSideDeck.mockReset().mockResolvedValue({ series: between() });
  api.chooseSeriesFirst.mockReset().mockResolvedValue({ series: between({ sideReady: [true, false], firstChooser: 0, firstChoice: "second" }), nextSlug: null });
  api.searchDuelCards.mockReset().mockResolvedValue({ cards: [] });
  api.getDuelCards.mockReset().mockImplementation(async (codes: number[]) => ({
    cards: codes.map((code) => ({ code, name: `Card ${code}`, type: code === 11 || code >= 100 ? TYPE_FUSION : 1 })), missing: [],
  }));
});
afterEach(cleanup);

function setup(overrides: Parameters<typeof makeSeries>[0] = {}, onChanged = vi.fn()) {
  const props = { onChanged, onNavigate: vi.fn() };
  const element = (series = between(overrides), current = base) => <BetweenGamesScreen slug="game-1"
    room={makeSeriesRoom({ series, mySide: { baseDeck: base, currentDeck: current } })} {...props} />;
  const view = render(element());
  return { ...props, ...view, element };
}
const tile = (name: string) => screen.findByRole("button", { name });
const ready = () => screen.getByRole("button", { name: "Ready" }) as HTMLButtonElement;
const status = () => screen.getByTestId("my-side-status");
async function swap() {
  fireEvent.click(await tile("Card 2, Main Deck"));
  fireEvent.click(await tile("Card 10, Side Deck"));
}
function pending<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((finish) => { resolve = finish; });
  return { promise, resolve };
}

describe("BetweenGamesScreen: Not ready button", () => {
  it.each([false, true])("takes Ready back with no edit while the timer runs (opponent ready: %s)", async (theirs) => {
    const view = setup({ sideReady: [true, theirs] });
    expect(screen.queryByRole("button", { name: "Ready" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Not ready" }));
    expect(api.unreadySeries).toHaveBeenCalledTimes(1);
    expect(api.unreadySeries).toHaveBeenCalledWith("game-1");
    // Ready is offered again at once and the player can edit.
    await waitFor(() => expect(ready().disabled).toBe(false));
    expect(screen.queryByRole("button", { name: "Not ready" })).toBeNull();
    expect(status().textContent).toMatch(/You are no longer ready/);
    await waitFor(() => expect(view.onChanged).toHaveBeenCalled());
    expect(api.readySeries).not.toHaveBeenCalled();
    expect(api.saveSeriesSideDeck).not.toHaveBeenCalled();
    // Editing afterwards works and Ready sends the new deck.
    await swap();
    fireEvent.click(ready());
    await waitFor(() => expect(api.readySeries).toHaveBeenCalledTimes(1));
  });

  it("does not ready the player again on a double click while the un-ready request is in flight", async () => {
    const request = pending<unknown>();
    api.unreadySeries.mockReturnValue(request.promise);
    setup({ sideReady: [true, false] });
    // Let the card types load, so only the pending un-ready can keep Ready off.
    await waitFor(() => expect(api.getDuelCards).toHaveBeenCalled());
    await act(async () => { await Promise.resolve(); });
    const button = screen.getByRole("button", { name: "Not ready" });
    fireEvent.click(button);
    fireEvent.click(button);
    // The button that replaces it stays disabled until the request settles.
    expect(ready().disabled).toBe(true);
    fireEvent.click(ready());
    await act(async () => { await Promise.resolve(); });
    expect(api.readySeries).not.toHaveBeenCalled();
    expect(api.unreadySeries).toHaveBeenCalledTimes(1);
    await act(async () => request.resolve({ series: between(), nextSlug: null }));
    await waitFor(() => expect(ready().disabled).toBe(false));
    // A Ready queued behind the un-ready would send now; give it time to do so.
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });
    expect(api.readySeries).not.toHaveBeenCalled();
  });

  it("shows the change at once when Not ready is clicked while an earlier un-ready is in flight", async () => {
    const first = pending<unknown>();
    api.unreadySeries.mockReturnValueOnce(first.promise).mockResolvedValue({ series: between(), nextSlug: null });
    const view = setup({ sideReady: [true, false] });
    fireEvent.click(screen.getByRole("button", { name: "Not ready" }));
    expect(api.unreadySeries).toHaveBeenCalledTimes(1);
    // Another tab readies the player while the request is still out.
    view.rerender(view.element(between({ sideReady: [false, false] })));
    view.rerender(view.element(between({ sideReady: [true, false] })));
    fireEvent.click(await screen.findByRole("button", { name: "Not ready" }));
    expect(screen.queryByRole("button", { name: "Not ready" })).toBeNull();
    expect(status().textContent).toMatch(/You are no longer ready/);
    await act(async () => first.resolve({ series: between(), nextSlug: null }));
    // One more un-ready goes out once the first settles.
    await waitFor(() => expect(api.unreadySeries).toHaveBeenCalledTimes(2));
  });

  it("shows Ready, not Not ready, for a player who is not ready", async () => {
    setup({ sideReady: [false, true] });
    await waitFor(() => expect(ready().disabled).toBe(false));
    expect(screen.queryByRole("button", { name: "Not ready" })).toBeNull();
  });

  it("follows the series when the game already started", async () => {
    api.unreadySeries.mockResolvedValue({ series: between(), nextSlug: "game-2" });
    const view = setup({ sideReady: [true, true] });
    fireEvent.click(screen.getByRole("button", { name: "Not ready" }));
    await waitFor(() => expect(view.onNavigate).toHaveBeenCalledWith("game-2"));
    expect(screen.getByTestId("between-notice").textContent).toBe("The next game started before Not ready reached the server.");
  });

  it("shows no such note when an edit's un-ready follows the series", async () => {
    api.unreadySeries.mockResolvedValue({ series: between(), nextSlug: "game-2" });
    const view = setup({ sideReady: [true, true] });
    fireEvent.click(await tile("Card 2, Main Deck"));
    await waitFor(() => expect(view.onNavigate).toHaveBeenCalledWith("game-2"));
    expect(screen.queryByTestId("between-notice")).toBeNull();
  });

  it("keeps the player ready and shows the error when the request fails", async () => {
    api.unreadySeries.mockRejectedValue(new Error("Could not reach the server"));
    setup({ sideReady: [true, false] });
    fireEvent.click(screen.getByRole("button", { name: "Not ready" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Could not reach the server");
    expect(screen.getByRole("button", { name: "Not ready" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Ready" })).toBeNull();
  });
});

describe("BetweenGamesScreen: editing after Ready", () => {
  it("takes Ready back on the first mark, before saving, and only once while un-ready is in flight", async () => {
    const request = pending<unknown>();
    api.unreadySeries.mockReturnValue(request.promise);
    const view = setup({ sideReady: [true, true] });
    // Ready shows as Not ready while the player is ready and has no pending swaps.
    expect(screen.queryByRole("button", { name: "Ready" })).toBeNull();
    expect((screen.getByRole("button", { name: "Not ready" }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(await tile("Card 2, Main Deck"));
    expect(api.unreadySeries).toHaveBeenCalledWith("game-1");
    expect(api.saveSeriesSideDeck).not.toHaveBeenCalled();
    expect(status().textContent).toMatch(/You are no longer ready/);
    expect(status().getAttribute("role")).toBe("status");
    fireEvent.click(await tile("Card 10, Side Deck"));
    expect(ready().disabled).toBe(false);
    expect(api.unreadySeries).toHaveBeenCalledTimes(1);
    await act(async () => request.resolve({ series: between(), nextSlug: null }));
    expect(view.onChanged).toHaveBeenCalled();
    // The edit made while it was in flight sends one trailing un-ready (a Ready from another tab may follow the first).
    await waitFor(() => expect(api.unreadySeries).toHaveBeenCalledTimes(2));
  });

  it("shows the un-ready explanation only once after completing a swap", async () => {
    const view = setup({ sideReady: [true, false] });
    await swap();
    await waitFor(() => expect(view.onChanged).toHaveBeenCalled());
    const explanation = "You are no longer ready. Finish your swaps, then click Ready again.";
    expect(screen.getAllByText(explanation)).toHaveLength(1);
    expect(status().textContent).toBe(explanation);
    expect(screen.getByTestId("ready-reason").textContent).toBe("");
    expect(ready().disabled).toBe(false);
  });

  it("makes Ready wait for a queued trailing un-ready, so none lands after it", async () => {
    const first = pending<unknown>();
    const second = pending<unknown>();
    api.unreadySeries.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    setup({ sideReady: [true, false] });
    await swap();
    fireEvent.click(ready());
    await act(async () => first.resolve({ series: between(), nextSlug: null }));
    await waitFor(() => expect(api.unreadySeries).toHaveBeenCalledTimes(2));
    expect(api.readySeries).not.toHaveBeenCalled();
    await act(async () => second.resolve({ series: between(), nextSlug: null }));
    await waitFor(() => expect(api.readySeries).toHaveBeenCalled());
    expect(api.unreadySeries.mock.invocationCallOrder[1]).toBeLessThan(api.readySeries.mock.invocationCallOrder[0]);
  });

  it("trusts a refreshed room over its own Ready answer, even when the snapshot's Ready did not change", async () => {
    // This tab readies; another tab takes it back before the refresh, so the room still says not ready.
    setup({}, vi.fn().mockResolvedValue(undefined));
    await tile("Card 1, Main Deck");
    fireEvent.click(ready());
    await waitFor(() => expect(api.readySeries).toHaveBeenCalled());
    await waitFor(() => expect(ready().disabled).toBe(false));
    expect(status().textContent).not.toMatch(/You are ready/);
  });

  it("waits for un-ready before saving and sending Ready again", async () => {
    const request = pending<unknown>();
    api.unreadySeries.mockReturnValue(request.promise);
    setup({ sideReady: [true, false] });
    await swap();
    fireEvent.click(ready());
    expect(api.saveSeriesSideDeck).not.toHaveBeenCalled();
    expect(api.readySeries).not.toHaveBeenCalled();
    await act(async () => request.resolve({ series: between(), nextSlug: null }));
    await waitFor(() => expect(api.readySeries).toHaveBeenCalledWith("game-1"));
    expect(api.saveSeriesSideDeck).toHaveBeenCalledWith("game-1", sided);
    expect(api.saveSeriesSideDeck.mock.invocationCallOrder[0]).toBeLessThan(api.readySeries.mock.invocationCallOrder[0]);
    expect(status().textContent).toMatch(/You are ready/);
  });

  it("retries failed un-ready on the next mark and autosaves the changed deck as a backstop before Ready", async () => {
    api.unreadySeries.mockRejectedValue(new Error("Network down"));
    setup({ sideReady: [true, false] });
    fireEvent.click(await tile("Card 2, Main Deck"));
    expect((await screen.findByRole("alert")).textContent).toBe("Network down");
    fireEvent.click(await tile("Card 10, Side Deck"));
    await waitFor(() => expect(api.unreadySeries).toHaveBeenCalledTimes(2));
    // Still failing: the error stays.
    expect(screen.getByRole("alert").textContent).toBe("Network down");
    // The valid swap is saved even though un-ready failed; that save clears Ready in its transaction.
    await waitFor(() => expect(api.saveSeriesSideDeck).toHaveBeenCalledWith("game-1", sided));
    await waitFor(() => expect(status().textContent).toMatch(/You are (?:not|no longer) ready/));
    expect(ready().disabled).toBe(false);
    fireEvent.click(ready());
    await waitFor(() => expect(api.readySeries).toHaveBeenCalled());
    expect(api.saveSeriesSideDeck).toHaveBeenCalledWith("game-1", sided);
    expect(api.saveSeriesSideDeck).toHaveBeenCalledTimes(1);
    expect(status().textContent).toMatch(/You are ready/);
  });

  it("locks marks, Reset and first/second choice while Ready is in flight", async () => {
    const request = pending<unknown>();
    api.readySeries.mockReturnValue(request.promise);
    const view = setup({ firstChooser: 0 });
    await swap();
    fireEvent.click(ready());
    await waitFor(() => expect(api.readySeries).toHaveBeenCalled());
    const card = await tile("Card 1, Main Deck");
    expect(card.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(card);
    expect(card.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(await tile("Card 11, Side Deck, goes to the Extra Deck"));
    expect(screen.getByTestId("swap-counter").textContent).toContain("0 out · 0 in");
    expect((screen.getByRole("button", { name: "Reset to the deck from last game" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Go second" }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => request.resolve({ series: between({ sideReady: [true, true] }), nextSlug: "game-2" }));
    expect(view.onNavigate).toHaveBeenCalledWith("game-2");
    // One per swap click; the clicks while Ready was in flight were locked and sent nothing.
    expect(api.unreadySeries).toHaveBeenCalledTimes(2);
    expect(api.saveSeriesSideDeck).toHaveBeenCalledTimes(1);
  });

  it("uses the Ready response before the room refreshes and un-readies the next edit", async () => {
    const view = setup();
    await tile("Card 1, Main Deck");
    fireEvent.click(ready());
    await waitFor(() => expect(status().textContent).toMatch(/You are ready/));
    await waitFor(() => expect(view.onChanged).toHaveBeenCalled());
    // The room still has its original sideReady=false snapshot.
    fireEvent.click(await tile("Card 2, Main Deck"));
    expect(api.unreadySeries).toHaveBeenCalledWith("game-1");
    expect(status().textContent).toMatch(/no longer ready/);
  });

  it("un-readies again after a false-to-true Ready snapshot from another tab", async () => {
    const view = setup({ sideReady: [true, false] });
    fireEvent.click(await tile("Card 2, Main Deck"));
    await waitFor(() => expect(view.onChanged).toHaveBeenCalled());
    view.rerender(view.element(between({ sideReady: [false, false] })));
    view.rerender(view.element(between({ sideReady: [true, false] })));
    fireEvent.click(await tile("Card 3, Main Deck"));
    expect(api.unreadySeries).toHaveBeenCalledTimes(2);
  });

  it("re-arms un-ready when a new snapshot still says Ready (another tab readied again)", async () => {
    const view = setup({ sideReady: [true, false] });
    fireEvent.click(await tile("Card 2, Main Deck"));
    await waitFor(() => expect(view.onChanged).toHaveBeenCalled());
    view.rerender(view.element(between({ sideReady: [true, false] })));
    fireEvent.click(await tile("Card 3, Main Deck"));
    expect(api.unreadySeries).toHaveBeenCalledTimes(2);
  });

  it("sends un-ready on every edit, even with a not-ready snapshot (another tab may have readied)", async () => {
    const view = setup();
    await swap();
    await waitFor(() => expect(view.onChanged).toHaveBeenCalled());
    fireEvent.click(await tile("Card 3, Main Deck"));
    expect(api.unreadySeries).toHaveBeenCalledTimes(3);
    expect(status().textContent).not.toMatch(/no longer ready/);
  });

  it("un-readies after remounting with stale props when Ready worked but refresh failed", async () => {
    const onChanged = vi.fn().mockRejectedValue(new Error("Refresh failed"));
    const view = setup({}, onChanged);
    await tile("Card 1, Main Deck");
    fireEvent.click(ready());
    await waitFor(() => expect(status().textContent).toMatch(/You are ready/));
    await screen.findByRole("button", { name: "Not ready" });
    view.unmount();
    setup();
    fireEvent.click(await tile("Card 2, Main Deck"));
    expect(api.unreadySeries).toHaveBeenCalledWith("game-1");
  });

  it("un-readies the next edit when a Ready response was lost, even after an earlier un-ready", async () => {
    api.readySeries.mockRejectedValue(new Error("Ready response lost"));
    setup();
    await swap();
    fireEvent.click(ready());
    expect((await screen.findByRole("alert")).textContent).toBe("Ready response lost");
    fireEvent.click(await tile("Card 1, Main Deck"));
    expect(api.unreadySeries).toHaveBeenCalledTimes(3);
  });

  it("un-readies when an incoming mark is removed or Reset is clicked after Ready", async () => {
    const marks = { out: [{ section: "main" as const, index: 1 }], inn: [0] };
    const element = () => <BetweenGamesScreen slug="game-1" room={makeSeriesRoom({ series: between({ sideReady: [true, false] }),
      mySide: { baseDeck: base, currentDeck: base } })} initialMarks={marks} onChanged={vi.fn()} onNavigate={vi.fn()} />;
    const view = render(element());
    fireEvent.click(await tile("Card 10, Main Deck, coming in"));
    expect(api.unreadySeries).toHaveBeenCalledTimes(1);
    view.unmount();
    render(element());
    fireEvent.click(screen.getByRole("button", { name: "Reset to the deck from last game" }));
    expect(api.unreadySeries).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("swap-counter").textContent).toContain("0 out · 0 in");
  });

  it("lets the chooser change first/second after Ready without clearing Ready", async () => {
    const view = setup({ sideReady: [true, false], firstChooser: 0, firstChoice: "first" });
    await tile("Card 1, Main Deck");
    fireEvent.click(screen.getByRole("button", { name: "Go second" }));
    await waitFor(() => expect(view.onChanged).toHaveBeenCalled());
    expect(api.chooseSeriesFirst).toHaveBeenCalledWith("game-1", "second");
    expect(api.unreadySeries).not.toHaveBeenCalled();
    expect(status().textContent).toMatch(/You are ready/);
  });

  it("keeps the practice bot ready when only the human edits", async () => {
    api.unreadySeries.mockResolvedValue({ series: between({ vsBot: true, sideReady: [false, true] }), nextSlug: null });
    const view = setup({ vsBot: true, playerIds: [1, 0], sideReady: [true, true] });
    fireEvent.click(await tile("Card 2, Main Deck"));
    await waitFor(() => expect(view.onChanged).toHaveBeenCalled());
    expect(status().textContent).toMatch(/no longer ready/);
    expect(screen.getByTestId("opponent-side-status").textContent).toBe("Opponent ready");
    expect(screen.getByText("The practice bot is always ready.")).toBeTruthy();
    expect(api.unreadySeries).toHaveBeenCalledTimes(1);
  });

  it("follows an already-created game instead of saving pending marks after a late un-ready", async () => {
    const request = pending<unknown>();
    api.unreadySeries.mockReturnValue(request.promise);
    const view = setup({ sideReady: [true, true] });
    await swap();
    fireEvent.click(ready());
    await act(async () => request.resolve({ series: makeSeries({ gameNumber: 2, currentDuelSlug: "game-2" }), nextSlug: "game-2" }));
    expect(view.onNavigate).toHaveBeenCalledWith("game-2");
    expect(api.saveSeriesSideDeck).not.toHaveBeenCalled();
    expect(api.readySeries).not.toHaveBeenCalled();
    expect((await tile("Card 1, Main Deck")).getAttribute("aria-disabled")).toBe("true");
  });

  it("shows a 409 and refreshes when the series closed while editing", async () => {
    api.unreadySeries.mockRejectedValue(new DuelRequestError("The series is not between games", 409));
    const view = setup({ sideReady: [true, true] });
    fireEvent.click(await tile("Card 2, Main Deck"));
    expect((await screen.findByRole("alert")).textContent).toBe("The series is not between games");
    expect(view.onChanged).toHaveBeenCalled();
    expect(api.saveSeriesSideDeck).not.toHaveBeenCalled();
  });

  it("edits the just-saved deck while the room still has the old deck, without reapplying marks", async () => {
    const view = setup();
    await swap();
    fireEvent.click(ready());
    await waitFor(() => expect(status().textContent).toMatch(/You are ready/));
    expect(screen.getByTestId("swap-counter").textContent).toContain("0 out · 0 in");
    fireEvent.click(await tile("Card 10, Main Deck"));
    await waitFor(() => expect(api.unreadySeries).toHaveBeenCalledTimes(3));
    // The saved deck catches up; it must preserve the new pending edit.
    view.rerender(view.element(between({ sideReady: [false, false] }), sided));
    expect(screen.getByTestId("swap-counter").textContent).toContain("1 out · 0 in");
    fireEvent.click(await tile("Card 2, Side Deck"));
    fireEvent.click(ready());
    await waitFor(() => expect(api.readySeries).toHaveBeenCalledTimes(2));
    expect(api.saveSeriesSideDeck).toHaveBeenLastCalledWith("game-1", { main: [1, 3, 2], extra: [100, 101], side: [11, 10] });
  });

  it("clears the un-ready error once a retry succeeds", async () => {
    api.unreadySeries.mockRejectedValueOnce(new Error("Network down"));
    setup({ sideReady: [true, false] });
    fireEvent.click(await tile("Card 2, Main Deck"));
    expect((await screen.findByRole("alert")).textContent).toBe("Network down");
    fireEvent.click(await tile("Card 10, Side Deck"));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(status().textContent).toMatch(/no longer ready/);
  });
});
