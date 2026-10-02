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
  chooseSeriesFirst: vi.fn(),
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

const soon = () => new Date(Date.now() + 42_000).toISOString();

beforeEach(() => {
  api.chooseSeriesFirst.mockReset().mockResolvedValue({ series: makeSeries(), nextSlug: null });
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

describe("SeriesNextControls: first or second", () => {
  it("lets the loser choose, with Go first selected by default", () => {
    controls({ nextGameAt: soon(), firstChooser: 0 });
    const group = screen.getByRole("group", { name: "Who goes first in the next game" });
    expect(within(group).getByRole("button", { name: "Go first" }).getAttribute("aria-pressed")).toBe("true");
    expect(within(group).getByRole("button", { name: "Go second" }).getAttribute("aria-pressed")).toBe("false");
    expect(screen.queryByTestId("opponent-first-status")).toBeNull();
  });

  it("sends the choice and refreshes", async () => {
    const props = controls({ nextGameAt: soon(), firstChooser: 0 });
    fireEvent.click(screen.getByRole("button", { name: "Go second" }));
    await waitFor(() => expect(api.chooseSeriesFirst).toHaveBeenCalledWith("game-1", "second"));
    await waitFor(() => expect(props.onChanged).toHaveBeenCalled());
  });

  it("does not send the choice that is already stored", () => {
    controls({ nextGameAt: soon(), firstChooser: 0, firstChoice: "second" });
    fireEvent.click(screen.getByRole("button", { name: "Go second" }));
    expect(api.chooseSeriesFirst).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Go second" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("shows the opponent that the loser is choosing, and then what they chose", () => {
    controls({ nextGameAt: soon(), firstChooser: 1 });
    expect(screen.queryByRole("group", { name: "Who goes first in the next game" })).toBeNull();
    expect(screen.getByTestId("opponent-first-status").textContent).toBe("Opponent is choosing to go first or second…");
    cleanup();
    controls({ nextGameAt: soon(), firstChooser: 1, firstChoice: "first" });
    expect(screen.getByTestId("opponent-first-status").textContent).toBe("Opponent chose to go first");
  });

  it("shows nothing about a choice after a draw", () => {
    controls({ nextGameAt: soon(), firstChooser: null });
    expect(screen.queryByTestId("first-choice")).toBeNull();
    expect(screen.queryByTestId("opponent-first-status")).toBeNull();
  });
});

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

describe("DuelResultScreen with a series", () => {
  const screenProps = { slug: "game-1", reducedMotion: true, soundEnabled: false, onClose: vi.fn() };

  it("shows the score and the between games controls", () => {
    const series = makeSeries({ status: "between_games", wins: [1, 0], nextGameAt: soon(), hasSide: [true, false] });
    render(<DuelResultScreen room={makeSeriesRoom({ series })} {...screenProps} />);
    const block = screen.getByRole("region", { name: "Series" });
    expect(within(block).getByText("Best of 3")).toBeTruthy();
    expect(within(block).getByText("Game 1 won by you · 1–0")).toBeTruthy();
    expect(within(block).getByText("Game 2 of 3")).toBeTruthy();
    expect(within(block).getByText("Imran goes first (the loser of game 1 goes first)")).toBeTruthy();
    expect(within(block).getByTestId("opponent-side-status").textContent).toBe("Opponent is siding…");
    expect(within(block).getByRole("timer")).toBeTruthy();
  });

  it("has no side deck button: players side their deck on the Between games screen", () => {
    const series = makeSeries({ status: "between_games", nextGameAt: soon(), hasSide: [false, true] });
    render(<DuelResultScreen room={makeSeriesRoom({ series })} {...screenProps} />);
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
