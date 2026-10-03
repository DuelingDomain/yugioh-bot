// @vitest-environment jsdom
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { generateSingleElimFirstRound } from "@yugidraft/shared/tournaments";

vi.mock("next/font/google", () => {
  const font = () => ({ className: "font", variable: "font-var", style: {} });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});

import { SheetRoot } from "@/components/sheet";
import { Road } from "@/components/tournament/bracket/road";
import type { Match, TournamentDetail } from "@/components/tournament/types";
import { standingsRatings, standingsTournament } from "../fixtures/standings";

function bracketTournament(count: number, decide: (matches: Match[]) => Match[] = (m) => m): TournamentDetail {
  const ids = Array.from({ length: count }, (_, i) => i + 1);
  const { byes, pairings } = generateSingleElimFirstRound(ids);
  const rows = [
    ...byes.map((id) => ({ one: id, two: null as number | null, bye: true })),
    ...pairings.map((p) => ({ one: p.playerOneId, two: p.playerTwoId as number | null, bye: false })),
  ];
  const matches: Match[] = rows.map((row, i) => ({
    id: i + 1, matchId: null, roundNumber: 1, playerOneId: row.one, playerTwoId: row.two,
    playerOneName: `P${row.one}`, playerTwoName: row.two === null ? null : `P${row.two}`,
    status: row.bye ? "completed" : "open", winnerId: row.bye ? row.one : null, reporterId: null, resolvedAt: null,
    metadata: row.bye ? { bye: true, winnerId: row.one } : {},
  }));
  return {
    ...standingsTournament, format: "single_elim", status: "active", isParticipant: true, currentUserPlayerId: 2,
    participants: ids.map((id) => ({ playerId: id, displayName: `P${id}` })),
    matches: decide(matches),
  };
}
function show(tournament: TournamentDetail, final = false) {
  return render(<SheetRoot><Road tournament={tournament} tournamentSlug="cup" currentUserPlayerId={tournament.currentUserPlayerId} ratings={standingsRatings} final={final} /></SheetRoot>);
}

describe("the single elimination road", () => {
  it("is the Bracket section with the standings anchor and a stop per round, named from the end", () => {
    const { container } = show(bracketTournament(8));
    expect(screen.getByRole("region", { name: "Bracket" })).toHaveAttribute("id", "standings");
    expect(container.querySelector("#players")).not.toBeNull();
    expect(screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual(["Quarterfinals", "Semifinals", "Final"]);
    expect(screen.queryByRole("tablist")).toBeNull();
  });

  it("shows a player only their own road until they ask for the whole bracket", () => {
    show(bracketTournament(8));
    expect(screen.getByRole("heading", { name: "Your road" })).toBeInTheDocument();
    expect(screen.getAllByTestId(/bracket-match-/)).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Show the whole bracket" }));
    expect(screen.getByRole("heading", { name: "The road" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show only my road" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getAllByTestId(/bracket-match-/).length).toBeGreaterThan(1);
  });

  it("gives a spectator the whole road with no toggle", () => {
    show({ ...bracketTournament(8), isParticipant: false, currentUserPlayerId: null });
    expect(screen.queryByRole("button", { name: /Show/ })).toBeNull();
    expect(screen.getAllByTestId(/bracket-match-/).length).toBeGreaterThan(1);
  });

  it("marks a bye and your own chip", () => {
    show(bracketTournament(5));
    fireEvent.click(screen.getByRole("button", { name: "Show the whole bracket" }));
    expect(screen.getAllByText("Bye. Goes straight through.").length).toBeGreaterThan(0);
    expect(screen.getByTestId("bracket-match-2")).toHaveAttribute("data-mine", "true");
  });

  it("says when a later round will be drawn", () => {
    show(bracketTournament(8));
    expect(screen.getAllByText(/is drawn when/).length).toBeGreaterThan(0);
  });

  it("calls a finished bracket The bracket", () => {
    show(bracketTournament(4, (m) => m.map((x) => ({ ...x, status: "completed", winnerId: x.playerOneId }))), true);
    expect(screen.getByRole("heading", { name: "The bracket" })).toBeInTheDocument();
  });

  it("shows a quiet empty state", () => {
    show({ ...bracketTournament(8), participants: [], matches: [] });
    expect(screen.getByText("No players yet.")).toBeInTheDocument();
  });
});
