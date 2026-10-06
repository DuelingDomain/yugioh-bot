// @vitest-environment jsdom
import { fixtureUserId } from "../fixtures/identity";
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/font/google", () => {
  const font = () => ({ className: "font", variable: "font-var", style: {} });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

import { SheetRoot } from "@/components/sheet";
import { TournamentLobby, firstRoundNote } from "../../src/components/tournament/tournament-lobby";
import type { TournamentDetail } from "../../src/components/tournament/types";

const pending: TournamentDetail = {
  id: 1, name: "Friday", format: "round_robin", status: "pending", createdByUserId: fixtureUserId("host"),
  isParticipant: false, currentUserPlayerId: null,
  startedAt: null, createdAt: "2026-01-01T00:00:00Z",
  participants: [{ playerId: 1, displayName: "Ann" }],
  matches: [],
};
const three: TournamentDetail = {
  ...pending,
  participants: [
    { playerId: 1, displayName: "Ann", deckRegistered: true, deckLocked: false },
    { playerId: 2, displayName: "Bo", deckRegistered: false },
    { playerId: 3, displayName: "Cy" },
  ],
};

function show(tournament: TournamentDetail, isCreator = false, currentUserId: number | null = null, onChanged = () => {}) {
  return render(
    <SheetRoot><TournamentLobby tournament={tournament} tournamentSlug="slug1" isCreator={isCreator} currentUserId={currentUserId} onChanged={onChanged} /></SheetRoot>,
  );
}

afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe("TournamentLobby", () => {
  it("renders the invite link and players for a pending tournament", () => {
    show(pending);
    expect(screen.getByRole("heading", { name: /Invite link/ })).toBeInTheDocument();
    expect(screen.getByText("Ann")).toBeInTheDocument();
  });

  it("titles the invite section Invite players for the host", () => {
    show(pending, true, fixtureUserId("host"));
    expect(screen.getByRole("heading", { name: /Invite players/ })).toBeInTheDocument();
  });

  it("shows open seats only while fewer than two players have joined", () => {
    const { unmount } = show(pending);
    expect(screen.getAllByText(/Open seat/)).toHaveLength(1);
    unmount();
    show(three);
    expect(screen.queryByText(/Open seat/)).toBeNull();
  });

  it("tells the host how many more players are needed, and disables Start", () => {
    show(pending, true, fixtureUserId("host"));
    expect(screen.getByText(/Starting needs 2 or more players\. 1 more to go\./)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start the tournament" })).toBeDisabled();
  });

  it("enables Start with the match count once two players are in, and posts to start", async () => {
    const fetchMock = vi.fn(async () => Response.json({ success: true }));
    vi.stubGlobal("fetch", fetchMock);
    const onChanged = vi.fn();
    show(three, true, fixtureUserId("host"), onChanged);
    expect(screen.getByText(/3 matches over 3 rounds/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Start the tournament" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/tournaments/slug1", { method: "POST" }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it("hides Start and the danger zone from players", () => {
    show(three);
    expect(screen.queryByRole("button", { name: "Start the tournament" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Cancel the tournament" })).toBeNull();
  });

  it("shows deck state beside players for the organizer only", () => {
    const { unmount } = show(three, true, fixtureUserId("host"));
    expect(screen.getByTestId("player-deck-marker-1")).toHaveTextContent("Deck in");
    expect(screen.getByTestId("player-deck-marker-2")).toHaveTextContent("No deck yet");
    expect(screen.queryByTestId("player-deck-marker-3")).toBeNull(); // payload without deck data
    unmount();
    show(three);
    expect(screen.queryByTestId("player-deck-marker-1")).toBeNull();
  });

  it("shows Add bot for the organizer in dev and posts to the join-bot route", async () => {
    const fetchMock = vi.fn(async () => Response.json({ success: true, displayName: "Bot 1" }));
    vi.stubGlobal("fetch", fetchMock);
    const onChanged = vi.fn();
    show(pending, true, fixtureUserId("host"), onChanged);
    fireEvent.click(screen.getByRole("button", { name: /add a bot/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/tournaments/slug1/join-bot", { method: "POST" }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it("does not show Add bot to non-organizers", () => {
    show(pending, false, fixtureUserId("someone"));
    expect(screen.queryByRole("button", { name: /add a bot/i })).toBeNull();
  });

  it("asks before cancelling, then deletes", async () => {
    const fetchMock = vi.fn(async () => Response.json({ success: true }));
    vi.stubGlobal("fetch", fetchMock);
    show(three, true, fixtureUserId("host"));
    fireEvent.click(screen.getByRole("button", { name: "Cancel the tournament" }));
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole("button", { name: /Yes, cancel/ }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/tournaments/slug1", { method: "DELETE" }));
  });
});

describe("firstRoundNote", () => {
  it("names the bye and the pairings the engine makes", () => {
    expect(firstRoundNote(1)).toBe("");
    expect(firstRoundNote(2)).toBe("Round 1 pairs 1 with 2.");
    expect(firstRoundNote(3)).toBe("Seat 1 gets a bye. Round 1 pairs 2 with 3.");
    expect(firstRoundNote(4)).toBe("Round 1 pairs 1 with 4 and 2 with 3.");
    expect(firstRoundNote(5)).toBe("Seat 1 gets a bye. Round 1 pairs 2 with 5 and 3 with 4.");
    expect(firstRoundNote(8)).toBe("Round 1 pairs 1 with 8, 2 with 7 and so on.");
  });
});

const FIXTURE_KEYS = ["host", "someone"] as const;
