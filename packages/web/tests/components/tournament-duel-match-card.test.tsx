// @vitest-environment jsdom
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

import { MatchCard } from "../../src/components/tournament/match-card";
import type { DuelSeriesSummary, Match } from "../../src/components/tournament/types";

const openSeries: DuelSeriesSummary = {
  id: 1, bestOf: 3, ranked: false, status: "active", playerIds: [10, 20], displayNames: ["Me", "Bob"],
  wins: [1, 0], gameNumber: 2, currentDuelSlug: "duel-2", winnerPlayerId: null,
  tournamentId: 1, tournamentSlug: "cup", tournamentMatchId: 7, nextGameAt: null,
  sideReady: [false, false], hasSide: [false, false], firstChooser: null, firstChoice: null,
};

const openMatch: Match = {
  id: 7, matchId: null, roundNumber: 1, playerOneId: 10, playerTwoId: 20,
  playerOneName: "Me", playerTwoName: "Bob", status: "open",
  winnerId: null, reporterId: null, resolvedAt: null, metadata: {}, series: null,
};

function renderCard(match: Match, props: { playerId?: number | null; isHost?: boolean; onResolved?: () => void } = {}) {
  return render(
    <MatchCard
      match={match}
      tournamentSlug="cup"
      tournamentFormat="single_elim"
      currentUserPlayerId={props.playerId === undefined ? 10 : props.playerId}
      isHost={props.isHost ?? false}
      isReporting={false}
      onReport={() => {}}
      onCancelReport={() => {}}
      onReported={() => {}}
      onResolved={props.onResolved ?? (() => {})}
    />,
  );
}

afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe("MatchCard online duel", () => {
  it("starts a duel and opens the duel page", async () => {
    const fetchMock = vi.fn(async () => Response.json({ series: openSeries, duel: { slug: "duel-1" } }, { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
    renderCard(openMatch);
    fireEvent.click(screen.getByRole("button", { name: /start duel/i }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("/api/tournaments/cup/matches/7/duel", { method: "POST" }),
    );
    await waitFor(() => expect(push).toHaveBeenCalledWith("/duels/duel-1"));
  });

  it("points at My deck when a deck is not registered", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "Bob has not registered a deck" }, { status: 409 })));
    renderCard(openMatch);
    fireEvent.click(screen.getByRole("button", { name: /start duel/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/has not registered a deck.*My deck/i);
    expect(push).not.toHaveBeenCalled();
  });

  it("does not offer Start duel to a spectator, but does to the organizer", () => {
    const { unmount } = renderCard(openMatch, { playerId: 99 });
    expect(screen.queryByRole("button", { name: /start duel/i })).toBeNull();
    unmount();
    renderCard(openMatch, { playerId: 99, isHost: true });
    expect(screen.getByRole("button", { name: /start duel/i })).toBeTruthy();
  });

  it("shows Open duel and the game score, and hides Report, while a series is open", () => {
    renderCard({ ...openMatch, series: openSeries });
    expect(screen.getByRole("link", { name: /open duel/i })).toHaveAttribute("href", "/duels/duel-2");
    expect(screen.getByTestId("tournament-match-score-7")).toHaveTextContent("Game 2 · 1–0");
    expect(screen.queryByRole("button", { name: /start duel/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /^report$/i })).toBeNull();
  });

  it("shows Report and Start duel again when the series is cancelled", () => {
    renderCard({ ...openMatch, series: { ...openSeries, status: "cancelled" } });
    expect(screen.getByRole("button", { name: /^report$/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /start duel/i })).toBeTruthy();
    expect(screen.queryByRole("link", { name: /open duel/i })).toBeNull();
  });

  it("shows the final game score on a completed match", () => {
    renderCard({
      ...openMatch, status: "completed", winnerId: 10, matchId: 3,
      series: { ...openSeries, status: "completed", wins: [2, 1], winnerPlayerId: 10 },
    });
    expect(screen.getByTestId("tournament-match-score-7")).toHaveTextContent("Final · 2–1");
    expect(screen.queryByRole("button", { name: /start duel/i })).toBeNull();
    expect(screen.queryByRole("link", { name: /open duel/i })).toBeNull();
  });

  it("lets the organizer set a result after a confirm that warns about the duel", async () => {
    const fetchMock = vi.fn(async () => Response.json({ success: true }));
    vi.stubGlobal("fetch", fetchMock);
    const onResolved = vi.fn();
    renderCard({ ...openMatch, series: openSeries }, { playerId: 99, isHost: true, onResolved });
    fireEvent.click(screen.getByRole("button", { name: /set result/i }));
    expect(screen.getByText(/this cancels the online duel/i)).toBeTruthy();
    const confirm = screen.getByRole("button", { name: /confirm result/i });
    expect(confirm).toBeDisabled();
    fireEvent.click(screen.getByLabelText("Bob"));
    fireEvent.click(confirm);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/tournaments/cup/matches/7/result");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ winnerPlayerId: 20 });
    await waitFor(() => expect(onResolved).toHaveBeenCalled());
  });

  it("hides Set result from non-organizers", () => {
    renderCard(openMatch);
    expect(screen.queryByRole("button", { name: /set result/i })).toBeNull();
  });
});
