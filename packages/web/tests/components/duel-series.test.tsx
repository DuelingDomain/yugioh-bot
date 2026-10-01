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
  saveSeriesSideDeck: vi.fn(),
  cancelSeries: vi.fn(),
  getDuelCards: vi.fn(),
}));

vi.mock("../../src/components/duel/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/components/duel/api")>()),
  ...api,
}));

import { DuelResultScreen } from "../../src/components/duel/duel-result";
import { SeriesBadges } from "../../src/components/duel/series-banner";
import { SeriesNextControls } from "../../src/components/duel/series-next";
import { SideDeckPanel } from "../../src/components/duel/side-deck-panel";

const soon = () => new Date(Date.now() + 42_000).toISOString();

beforeEach(() => {
  api.readySeries.mockReset().mockResolvedValue({ series: makeSeries(), nextSlug: null });
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
    expect(screen.getByRole("status").textContent).toBe("Waiting for Imran.");
    expect((screen.getByRole("button", { name: "Ready" }) as HTMLButtonElement).disabled).toBe(true);
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
    expect(within(block).getByText("1 – 0")).toBeTruthy();
    expect(within(block).getByRole("timer")).toBeTruthy();
    expect(within(block).getByRole("button", { name: "Side deck" })).toBeTruthy();
  });

  it("hides the side deck button from a player with no side deck", () => {
    const series = makeSeries({ status: "between_games", nextGameAt: soon(), hasSide: [false, true] });
    render(<DuelResultScreen room={makeSeriesRoom({ series })} {...screenProps} onOpenSide={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Side deck" })).toBeNull();
    expect(screen.getByRole("button", { name: "Ready for next game" })).toBeTruthy();
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
