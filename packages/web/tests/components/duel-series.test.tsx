// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TYPE_FUSION } from "../../src/components/duel/constants";
import { makeDeck, makeSeries, makeSeriesRoom } from "../helpers/duel-series";

vi.mock("next/font/google", () => {
  const font = () => ({ variable: "font-var", className: "font-class" });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));

const api = vi.hoisted(() => ({
  readySeries: vi.fn(),
  unreadySeries: vi.fn(),
  saveSeriesSideDeck: vi.fn(),
  cancelSeries: vi.fn(),
  getDuelCards: vi.fn(),
}));

vi.mock("../../src/components/duel/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/components/duel/api")>()),
  ...api,
}));

import { DuelResultScreen } from "../../src/components/duel/duel-result";
import { SeriesBadges, SeriesGameLabel } from "../../src/components/duel/series-banner";
import { SeriesNextControls } from "../../src/components/duel/series-next";
import { SideDeckPanel } from "../../src/components/duel/side-deck-panel";

const soon = () => new Date(Date.now() + 42_000).toISOString();

beforeEach(() => {
  api.readySeries.mockReset().mockResolvedValue({ series: makeSeries(), nextSlug: null });
  api.unreadySeries.mockReset().mockResolvedValue({ series: makeSeries(), nextSlug: null });
  api.saveSeriesSideDeck.mockReset().mockResolvedValue({ series: makeSeries() });
  api.cancelSeries.mockReset().mockResolvedValue(undefined);
  api.getDuelCards.mockReset().mockImplementation(async (codes: number[]) => ({
    cards: codes.map((code) => ({ code, name: `Card ${code}`, type: code === 11 ? TYPE_FUSION : code >= 100 ? TYPE_FUSION : 1 })),
    missing: [],
  }));
});
afterEach(cleanup);

function controls(seriesOverrides: Parameters<typeof makeSeries>[0], extra: Partial<React.ComponentProps<typeof SeriesNextControls>> = {}) {
  const series = makeSeries({ status: "between_games", ...seriesOverrides });
  const props = { onChanged: vi.fn(), onNavigate: vi.fn(), ...extra };
  render(<SeriesNextControls room={makeSeriesRoom({ series })} slug="game-1" tone="sheet" {...props} />);
  return props;
}

describe("SeriesNextControls", () => {
  it("counts down to the next game", () => {
    controls({ nextGameAt: soon() });
    expect(screen.getByRole("timer").textContent).toMatch(/Game 2 in 0:4\d/);
  });

  it("waits for both players when there is no deadline", () => {
    controls({ nextGameAt: null });
    expect(screen.getByRole("timer").textContent).toBe("Waiting for both players");
  });

  it("marks the player ready and stays put when the next game has not started", async () => {
    const props = controls({ nextGameAt: soon() });
    fireEvent.click(screen.getByRole("button", { name: "Ready for next game" }));
    await waitFor(() => expect(api.readySeries).toHaveBeenCalledWith("game-1"));
    await waitFor(() => expect(props.onChanged).toHaveBeenCalled());
    expect(props.onNavigate).not.toHaveBeenCalled();
  });

  it("goes to the next game when Ready starts it", async () => {
    api.readySeries.mockResolvedValue({ series: makeSeries(), nextSlug: "game-2" });
    const props = controls({ nextGameAt: soon(), sideReady: [false, true] });
    fireEvent.click(screen.getByRole("button", { name: "Ready for next game" }));
    await waitFor(() => expect(props.onNavigate).toHaveBeenCalledWith("game-2"));
  });

  it("shows a ready player that the other player is still needed", () => {
    controls({ nextGameAt: soon(), sideReady: [true, false] });
    expect(screen.getAllByRole("status").map((node) => node.textContent)).toEqual(["You are ready.", "Opponent is siding…"]);
    expect((screen.getByRole("button", { name: "Ready" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("says when the opponent is ready", () => {
    controls({ nextGameAt: soon(), sideReady: [false, true] });
    expect(screen.getByTestId("opponent-side-status").textContent).toBe("Opponent ready");
    expect(screen.getByTestId("opponent-side-status").getAttribute("data-ready")).toBe("true");
  });

  it("says both players are ready", () => {
    controls({ nextGameAt: soon(), sideReady: [true, true] });
    expect(screen.getAllByRole("status")[0].textContent).toBe("Both players are ready.");
    expect(screen.getByTestId("opponent-side-status").textContent).toBe("Opponent ready");
  });

  it("does not say the opponent is siding after an interrupted game", () => {
    controls({ nextGameAt: null });
    expect(screen.getByTestId("opponent-side-status").textContent).toBe("Opponent is not ready");
  });

  it("shows no opponent state to a spectator", () => {
    const series = makeSeries({ status: "between_games", nextGameAt: soon() });
    render(<SeriesNextControls room={makeSeriesRoom({ series, mySeat: null })} slug="game-1" tone="sheet" onChanged={vi.fn()} onNavigate={vi.fn()} />);
    expect(screen.queryByTestId("opponent-side-status")).toBeNull();
  });

  it("offers the side deck only to a player who has one", () => {
    const onOpenSide = vi.fn();
    controls({ nextGameAt: soon(), hasSide: [false, true] }, { onOpenSide });
    expect(screen.queryByRole("button", { name: "Side deck" })).toBeNull();
    cleanup();
    controls({ nextGameAt: soon(), hasSide: [true, false] }, { onOpenSide });
    fireEvent.click(screen.getByRole("button", { name: "Side deck" }));
    expect(onOpenSide).toHaveBeenCalled();
  });

  it("saves pending side deck work before it marks the player ready", async () => {
    const order: string[] = [];
    api.readySeries.mockImplementation(async () => { order.push("ready"); return { series: makeSeries(), nextSlug: null }; });
    controls({ nextGameAt: soon() }, { beforeReady: async () => { order.push("save"); } });
    fireEvent.click(screen.getByRole("button", { name: "Ready for next game" }));
    await waitFor(() => expect(order).toEqual(["save", "ready"]));
  });

  it("cancels an interrupted casual series after a second click", async () => {
    const props = controls({ nextGameAt: null });
    fireEvent.click(screen.getByRole("button", { name: "Cancel series" }));
    expect(api.cancelSeries).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Confirm cancel" }));
    await waitFor(() => expect(api.cancelSeries).toHaveBeenCalledWith(7));
    await waitFor(() => expect(props.onChanged).toHaveBeenCalled());
  });

  it("does not offer Cancel series in a tournament or with a deadline", () => {
    controls({ nextGameAt: null, tournamentId: 3, tournamentSlug: "cup" });
    expect(screen.queryByRole("button", { name: "Cancel series" })).toBeNull();
    expect(screen.getByText(/organizer can set the result/i)).toBeTruthy();
    cleanup();
    controls({ nextGameAt: soon() });
    expect(screen.queryByRole("button", { name: "Cancel series" })).toBeNull();
  });

  it("shows an error from the server", async () => {
    api.readySeries.mockRejectedValue(new Error("The series moved on."));
    controls({ nextGameAt: soon() });
    fireEvent.click(screen.getByRole("button", { name: "Ready for next game" }));
    expect((await screen.findByRole("alert")).textContent).toBe("The series moved on.");
  });
});

describe("SideDeckPanel", () => {
  function panel(overrides: { base?: ReturnType<typeof makeDeck>; current?: ReturnType<typeof makeDeck>; sideReady?: [boolean, boolean] } = {}) {
    const base = overrides.base ?? makeDeck();
    const props = { onClose: vi.fn(), onChanged: vi.fn(), onNavigate: vi.fn() };
    const series = makeSeries({ status: "between_games", nextGameAt: soon(), hasSide: [true, false], sideReady: overrides.sideReady ?? [false, false] });
    render(<SideDeckPanel slug="game-1" series={series} myIndex={0} side={{ baseDeck: base, currentDeck: overrides.current ?? base }} {...props} />);
    return props;
  }
  const tile = (name: string) => screen.findByRole("button", { name });

  it("swaps a main card with a side card and saves the new deck", async () => {
    const props = panel();
    fireEvent.click(await tile("Card 2"));
    fireEvent.click(await tile("Card 10"));
    expect(await screen.findByRole("button", { name: "Card 10, swapped in" })).toBeTruthy();
    expect(screen.getByText("1 card swapped from your registered deck")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(api.saveSeriesSideDeck).toHaveBeenCalledWith("game-1", { main: [1, 10, 3], extra: [100, 101], side: [2, 11] }));
    await waitFor(() => expect(props.onChanged).toHaveBeenCalled());
  });

  it("works from the side card first", async () => {
    panel();
    fireEvent.click(await tile("Card 11"));
    fireEvent.click(await tile("Card 100"));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(api.saveSeriesSideDeck).toHaveBeenCalledWith("game-1", { main: [1, 2, 3], extra: [11, 101], side: [10, 100] }));
  });

  it("refuses an extra deck monster in the main deck and keeps the deck as it was", async () => {
    panel();
    fireEvent.click(await tile("Card 1"));
    fireEvent.click(await tile("Card 11"));
    expect((await screen.findByRole("alert")).textContent).toMatch(/cannot go into the Main Deck/);
    expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("resets to the registered deck", async () => {
    const base = makeDeck();
    panel({ base, current: { main: [1, 10, 3], extra: [100, 101], side: [2, 11] } });
    const reset = screen.getByRole("button", { name: "Reset to registered deck" }) as HTMLButtonElement;
    expect(reset.disabled).toBe(false);
    fireEvent.click(reset);
    expect(reset.disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(api.saveSeriesSideDeck).toHaveBeenCalledWith("game-1", base));
  });

  it("saves a pending swap before it marks the player ready, then follows the next game", async () => {
    api.readySeries.mockResolvedValue({ series: makeSeries(), nextSlug: "game-2" });
    const props = panel();
    fireEvent.click(await tile("Card 3"));
    fireEvent.click(await tile("Card 10"));
    fireEvent.click(screen.getByRole("button", { name: "Ready for next game" }));
    await waitFor(() => expect(props.onNavigate).toHaveBeenCalledWith("game-2"));
    expect(api.saveSeriesSideDeck.mock.invocationCallOrder[0]).toBeLessThan(api.readySeries.mock.invocationCallOrder[0]);
  });

  it("says the timer starts the next game with the last saved deck", () => {
    panel();
    expect(screen.getByText(/When the timer runs out, the next game starts with your last saved deck/)).toBeTruthy();
  });

  it("un-readies a ready player on the server as soon as they start a swap, before any save", async () => {
    let finish!: (value: unknown) => void;
    api.unreadySeries.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const props = panel({ sideReady: [true, true] });
    expect((screen.getByRole("button", { name: "Ready" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByText(/no longer ready/)).toBeNull();

    fireEvent.click(await tile("Card 2"));
    await waitFor(() => expect(api.unreadySeries).toHaveBeenCalledWith("game-1"));
    expect(api.saveSeriesSideDeck).not.toHaveBeenCalled();
    expect(screen.getByText(/You are no longer ready/).getAttribute("role")).toBe("status");
    expect((screen.getByRole("button", { name: "Ready for next game" }) as HTMLButtonElement).disabled).toBe(false);

    // Finishing the swap while the un-ready is in flight does not send a second one.
    fireEvent.click(await tile("Card 10"));
    expect(api.unreadySeries).toHaveBeenCalledTimes(1);
    finish({ series: makeSeries(), nextSlug: null });
    await waitFor(() => expect(props.onChanged).toHaveBeenCalled());
  });

  it("sends Ready only after a pending un-ready has landed", async () => {
    let finish!: (value: unknown) => void;
    api.unreadySeries.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    panel({ sideReady: [true, false] });
    fireEvent.click(await tile("Card 2"));
    fireEvent.click(await tile("Card 10"));
    fireEvent.click(screen.getByRole("button", { name: "Ready for next game" }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(api.saveSeriesSideDeck).not.toHaveBeenCalled();
    expect(api.readySeries).not.toHaveBeenCalled();
    finish({ series: makeSeries(), nextSlug: null });
    await waitFor(() => expect(api.readySeries).toHaveBeenCalled());
    expect(api.saveSeriesSideDeck.mock.invocationCallOrder[0]).toBeLessThan(api.readySeries.mock.invocationCallOrder[0]);
  });

  it("falls back to the save clearing Ready when the un-ready request fails", async () => {
    const base = makeDeck();
    const swapped = { main: [1, 10, 3], extra: [100, 101], side: [2, 11] };
    const between = { status: "between_games" as const, nextGameAt: soon(), hasSide: [true, false] as [boolean, boolean] };
    api.saveSeriesSideDeck.mockResolvedValue({ series: makeSeries({ ...between, sideReady: [false, true] }) });
    api.unreadySeries.mockRejectedValue(new Error("Network down"));
    const element = (sideReady: [boolean, boolean], current: typeof base) => (
      <SideDeckPanel slug="game-1" series={makeSeries({ ...between, sideReady })} myIndex={0}
        side={{ baseDeck: base, currentDeck: current }} onClose={vi.fn()} onChanged={vi.fn()} onNavigate={vi.fn()} />
    );
    const { rerender } = render(element([true, true], base));
    expect((screen.getByRole("button", { name: "Ready" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByText(/clears your Ready|no longer ready/)).toBeNull();

    fireEvent.click(await tile("Card 2"));
    expect(await screen.findByText("Network down")).toBeTruthy();
    // The next edit retries the un-ready, which fails again: the save is the backstop.
    fireEvent.click(await tile("Card 10"));
    expect((await screen.findByText(/Saving these swaps clears your Ready/)).getAttribute("role")).toBe("status");
    expect(api.unreadySeries).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(api.saveSeriesSideDeck).toHaveBeenCalledWith("game-1", swapped));

    // The room refreshes with the server state: this player is no longer ready.
    rerender(element([false, true], swapped));
    expect((await screen.findByText(/You are no longer ready/)).getAttribute("role")).toBe("status");
    expect(screen.queryByText(/clears your Ready/)).toBeNull();
    const ready = screen.getByRole("button", { name: "Ready for next game" }) as HTMLButtonElement;
    expect(ready.disabled).toBe(false);
  });

  it("locks the cards while Ready is in flight, so an edit cannot slip past the Ready", async () => {
    let finish!: (value: unknown) => void;
    api.readySeries.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const props = panel({ sideReady: [false, true] });
    fireEvent.click(await tile("Card 3"));
    fireEvent.click(await tile("Card 10"));
    // The first edit sends its un-ready; Ready waits for it.
    await waitFor(() => expect(api.unreadySeries).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "Ready for next game" }));
    await waitFor(() => expect(api.readySeries).toHaveBeenCalled());

    const card = await tile("Card 1");
    expect((card as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(card);
    fireEvent.click(await tile("Card 11"));
    expect(card.getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByText("1 card swapped from your registered deck")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Reset to registered deck" }) as HTMLButtonElement).disabled).toBe(true);

    finish({ series: makeSeries({ status: "between_games", sideReady: [true, true] }), nextSlug: "game-2" });
    await waitFor(() => expect(props.onNavigate).toHaveBeenCalledWith("game-2"));
    expect(api.saveSeriesSideDeck).toHaveBeenCalledTimes(1);
    expect(api.saveSeriesSideDeck).toHaveBeenCalledWith("game-1", { main: [1, 2, 10], extra: [100, 101], side: [3, 11] });
    // The clicks during the lock changed nothing and sent nothing.
    expect(api.unreadySeries).toHaveBeenCalledTimes(1);
  });

  it("un-readies an edit made right after Ready, before the room has refreshed", async () => {
    let refreshed!: () => void;
    api.readySeries.mockResolvedValue({ series: makeSeries({ status: "between_games", sideReady: [true, false] }), nextSlug: null });
    const props = panel({ sideReady: [false, false] });
    props.onChanged.mockReturnValue(new Promise<void>((resolve) => { refreshed = resolve; }));
    fireEvent.click(screen.getByRole("button", { name: "Ready for next game" }));
    await waitFor(() => expect(props.onChanged).toHaveBeenCalled());
    // The panel stays open until the room has the new Ready, so reopening never shows stale state.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(props.onClose).not.toHaveBeenCalled();
    refreshed();
    await waitFor(() => expect(props.onClose).toHaveBeenCalled());

    // Still mounted with the room's old props (sideReady false): the edit must still take Ready back.
    expect(screen.getByText("You are ready")).toBeTruthy();
    fireEvent.click(await tile("Card 2"));
    await waitFor(() => expect(api.unreadySeries).toHaveBeenCalledWith("game-1"));
  });

  it("un-readies again when the server says the player is ready once more", async () => {
    const base = makeDeck();
    const between = { status: "between_games" as const, nextGameAt: soon(), hasSide: [true, false] as [boolean, boolean] };
    const element = (sideReady: [boolean, boolean]) => (
      <SideDeckPanel slug="game-1" series={makeSeries({ ...between, sideReady })} myIndex={0}
        side={{ baseDeck: base, currentDeck: base }} onClose={vi.fn()} onChanged={vi.fn()} onNavigate={vi.fn()} />
    );
    const { rerender } = render(element([true, false]));
    fireEvent.click(await tile("Card 2"));
    await waitFor(() => expect(api.unreadySeries).toHaveBeenCalledTimes(1));

    // The room refreshes (not ready), then Ready arrives from another tab.
    rerender(element([false, false]));
    rerender(element([true, false]));
    expect(await screen.findByText("You are ready")).toBeTruthy();
    fireEvent.click(await tile("Card 3"));
    await waitFor(() => expect(api.unreadySeries).toHaveBeenCalledTimes(2));
  });

  it("un-readies again when a refresh still shows Ready after an un-ready (Ready from another tab)", async () => {
    const base = makeDeck();
    const between = { status: "between_games" as const, nextGameAt: soon(), hasSide: [true, false] as [boolean, boolean] };
    const onChanged = vi.fn();
    const element = (sideReady: [boolean, boolean]) => (
      <SideDeckPanel slug="game-1" series={makeSeries({ ...between, sideReady })} myIndex={0}
        side={{ baseDeck: base, currentDeck: base }} onClose={vi.fn()} onChanged={onChanged} onNavigate={vi.fn()} />
    );
    const { rerender } = render(element([true, false]));
    fireEvent.click(await tile("Card 2"));
    await waitFor(() => expect(api.unreadySeries).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());

    // The refresh never showed the player not ready: Ready landed again from another tab.
    rerender(element([true, false]));
    fireEvent.click(await tile("Card 3"));
    await waitFor(() => expect(api.unreadySeries).toHaveBeenCalledTimes(2));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(api.unreadySeries).toHaveBeenCalledTimes(2);
  });

  it("sends un-ready on the first edit after the panel opens, even when it shows the player not ready, and only once", async () => {
    const props = panel({ sideReady: [false, false] });
    fireEvent.click(await tile("Card 2"));
    await waitFor(() => expect(api.unreadySeries).toHaveBeenCalledWith("game-1"));
    await waitFor(() => expect(props.onChanged).toHaveBeenCalled());
    // A player shown as not ready gets no "no longer ready" copy.
    expect(screen.queryByText(/no longer ready/)).toBeNull();
    fireEvent.click(await tile("Card 10"));
    fireEvent.click(await tile("Card 3"));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(api.unreadySeries).toHaveBeenCalledTimes(1);
  });

  it("un-readies on the first edit after a reopen when Ready worked but the room's refresh failed", async () => {
    const base = makeDeck();
    const between = { status: "between_games" as const, nextGameAt: soon(), hasSide: [true, false] as [boolean, boolean] };
    api.readySeries.mockResolvedValue({ series: makeSeries({ ...between, sideReady: [true, false] }), nextSlug: null });
    const onClose = vi.fn();
    const onChanged = vi.fn().mockRejectedValue(new Error("Refresh failed"));
    // The room keeps its stale snapshot: this player is not ready.
    const element = () => (
      <SideDeckPanel slug="game-1" series={makeSeries({ ...between, sideReady: [false, false] })} myIndex={0}
        side={{ baseDeck: base, currentDeck: base }} onClose={onClose} onChanged={onChanged} onNavigate={vi.fn()} />
    );
    const first = render(element());
    fireEvent.click(screen.getByRole("button", { name: "Ready for next game" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    first.unmount();
    expect(api.unreadySeries).not.toHaveBeenCalled();

    render(element());
    fireEvent.click(await tile("Card 2"));
    await waitFor(() => expect(api.unreadySeries).toHaveBeenCalledWith("game-1"));
  });

  it("un-readies on the next edit when a Ready's answer was lost", async () => {
    api.readySeries.mockRejectedValue(new Error("Network down"));
    panel({ sideReady: [false, false] });
    fireEvent.click(screen.getByRole("button", { name: "Ready for next game" }));
    expect(await screen.findByText("Network down")).toBeTruthy();
    // The Ready may have landed on the server, so the edit takes it back to be safe.
    fireEvent.click(await tile("Card 2"));
    await waitFor(() => expect(api.unreadySeries).toHaveBeenCalledWith("game-1"));
  });

  it("closes on Escape", async () => {
    const props = panel();
    await tile("Card 1");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(props.onClose).toHaveBeenCalled();
  });

  it("moves focus once and keeps focus on a card when the room re-renders with a new onClose", async () => {
    const base = makeDeck();
    const series = makeSeries({ status: "between_games", nextGameAt: soon(), hasSide: [true, false], sideReady: [false, false] });
    const first = vi.fn();
    const second = vi.fn();
    const element = (onClose: () => void) => (
      <SideDeckPanel slug="game-1" series={series} myIndex={0} side={{ baseDeck: base, currentDeck: base }}
        onClose={onClose} onChanged={vi.fn()} onNavigate={vi.fn()} />
    );
    const { rerender } = render(element(first));
    const card = await tile("Card 2");
    const dialog = screen.getByRole("dialog");
    expect(document.activeElement).toBe(dialog);
    card.focus();
    rerender(element(second));
    rerender(element(() => undefined));
    rerender(element(second));
    expect(document.activeElement).toBe(card);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
  });

  it("shows the next game and the opponent's state", async () => {
    panel({ sideReady: [false, true] });
    await tile("Card 1");
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Game 2 of 3")).toBeTruthy();
    expect(within(dialog).getByText(/Starts in 0:4\d/)).toBeTruthy();
    expect(within(dialog).getByTestId("opponent-side-status").textContent).toBe("Opponent ready");
  });

  it("shows the deck counts", async () => {
    panel();
    await tile("Card 1");
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Main 3")).toBeTruthy();
    expect(within(dialog).getByText("Extra 2")).toBeTruthy();
    expect(within(dialog).getByText("Side 2")).toBeTruthy();
  });
});

describe("DuelResultScreen with a series", () => {
  const screenProps = { slug: "game-1", reducedMotion: true, soundEnabled: false, onClose: vi.fn() };

  it("shows the score and the between games controls", () => {
    const series = makeSeries({ status: "between_games", wins: [1, 0], nextGameAt: soon(), hasSide: [true, false] });
    render(<DuelResultScreen room={makeSeriesRoom({ series })} {...screenProps} onOpenSide={vi.fn()} />);
    const block = screen.getByRole("region", { name: "Series" });
    expect(within(block).getByText("Best of 3")).toBeTruthy();
    expect(within(block).getByText("Game 1 won by you · 1–0")).toBeTruthy();
    expect(within(block).getByText("Game 2 of 3")).toBeTruthy();
    expect(within(block).getByText("Imran goes first (the loser of game 1 goes first)")).toBeTruthy();
    expect(within(block).getByTestId("opponent-side-status").textContent).toBe("Opponent is siding…");
    expect(within(block).getByRole("timer")).toBeTruthy();
    expect(within(block).getByRole("button", { name: "Side deck" })).toBeTruthy();
  });

  it("hides the side deck button from a player with no side deck", () => {
    const series = makeSeries({ status: "between_games", nextGameAt: soon(), hasSide: [false, true] });
    render(<DuelResultScreen room={makeSeriesRoom({ series })} {...screenProps} onOpenSide={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Side deck" })).toBeNull();
    expect(screen.getByRole("button", { name: "Ready for next game" })).toBeTruthy();
  });

  it("names the loser as the first player of the next game", () => {
    const series = makeSeries({ status: "between_games", wins: [1, 0], nextGameAt: soon() });
    render(<DuelResultScreen room={makeSeriesRoom({ series, mySeat: 1 })} {...screenProps} />);
    const info = screen.getByTestId("between-games-info");
    expect(within(info).getByText("Game 1 won by Sulman · 0–1")).toBeTruthy();
    expect(within(info).getByText("You go first (the loser of game 1 goes first)")).toBeTruthy();
  });

  it("offers no next game when the match is over", () => {
    const series = makeSeries({ status: "completed", wins: [2, 0], winnerPlayerId: 1, gameNumber: 2 });
    render(<DuelResultScreen room={makeSeriesRoom({ series })} {...screenProps} />);
    expect(screen.queryByTestId("between-games-info")).toBeNull();
    expect(screen.queryByRole("button", { name: /Ready/ })).toBeNull();
    expect(screen.queryByTestId("opponent-side-status")).toBeNull();
    expect(screen.getByText("You win the series")).toBeTruthy();
  });

  it("shows the series winner, the final score and where the result went", () => {
    const series = makeSeries({ status: "completed", wins: [2, 1], winnerPlayerId: 1, tournamentId: 4, tournamentSlug: "cup" });
    render(<DuelResultScreen room={makeSeriesRoom({ series })} {...screenProps} />);
    const block = screen.getByRole("region", { name: "Series" });
    expect(within(block).getByText("You win the series")).toBeTruthy();
    expect(within(block).getByText("Final score 2 – 1")).toBeTruthy();
    expect(within(block).getByText("Recorded to the bracket")).toBeTruthy();
    expect(within(block).queryByRole("timer")).toBeNull();
  });

  it("says Ranked result recorded, or Unranked", () => {
    const ranked = makeSeries({ status: "completed", wins: [2, 0], winnerPlayerId: 1, ranked: true });
    render(<DuelResultScreen room={makeSeriesRoom({ series: ranked })} {...screenProps} />);
    expect(screen.getByText("Ranked result recorded")).toBeTruthy();
    cleanup();
    render(<DuelResultScreen room={makeSeriesRoom({ series: { ...ranked, ranked: false } })} {...screenProps} />);
    expect(screen.getByText("Unranked")).toBeTruthy();
  });

  it("leaves a duel with no series as it was", () => {
    render(<DuelResultScreen room={makeSeriesRoom({ series: null })} {...screenProps} />);
    expect(screen.queryByRole("region", { name: "Series" })).toBeNull();
  });
});

describe("SeriesBadges", () => {
  it("links the tournament badge, or leaves it plain inside a link", () => {
    const series = makeSeries({ tournamentId: 4, tournamentSlug: "cup", wins: [1, 1], gameNumber: 3 });
    const { container } = render(<SeriesBadges series={series} showGame />);
    expect(screen.getByRole("link", { name: "Tournament" }).getAttribute("href")).toBe("/tournament/cup");
    expect(screen.getByText("Game 3")).toBeTruthy();
    expect(screen.getByLabelText("Series score 1 – 1")).toBeTruthy();
    cleanup();
    render(<SeriesBadges series={series} plain />);
    expect(screen.queryByRole("link")).toBeNull();
    expect(container).toBeTruthy();
  });

  it("shows Ranked for a ranked casual series", () => {
    render(<SeriesBadges series={makeSeries({ ranked: true })} />);
    expect(screen.getByText("Ranked")).toBeTruthy();
  });
});

describe("SeriesGameLabel", () => {
  it("shows the game and the score in the header of a Best of 3 game", () => {
    const series = makeSeries({ wins: [1, 0], gameNumber: 2 });
    const room = makeSeriesRoom({ series, status: "active" });
    room.session.gameNumber = 2;
    render(<SeriesGameLabel room={room} />);
    const label = screen.getByTestId("series-game-label");
    expect(label.textContent).toBe("Game 2 of 3·1–0");
    expect(label.getAttribute("title")).toBe("You 1 – 0 Imran");
  });

  it("counts the viewer's wins first", () => {
    const series = makeSeries({ wins: [0, 1], gameNumber: 2 });
    render(<SeriesGameLabel room={makeSeriesRoom({ series, mySeat: 1, status: "active" })} />);
    expect(screen.getByTestId("series-game-label").textContent).toContain("1–0");
  });

  it("shows nothing for a single game, a Best of 1 series or no series", () => {
    render(<SeriesGameLabel room={makeSeriesRoom({ series: null })} />);
    render(<SeriesGameLabel room={makeSeriesRoom({ series: makeSeries({ bestOf: 1 }) })} />);
    expect(screen.queryByTestId("series-game-label")).toBeNull();
  });
});
