// @vitest-environment jsdom
import React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { generateSingleElimFirstRound } from "@yugidraft/shared/tournaments";

vi.mock("next/font/google", () => {
  const font = () => ({ className: "font", variable: "font-var", style: {} });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});

import { SheetRoot } from "@/components/sheet";
import { StandingsSection } from "@/components/tournament/standings/standings-section";
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
    ...standingsTournament, format: "single_elim", status: "active",
    participants: ids.map((id) => ({ playerId: id, displayName: `P${id}` })),
    matches: decide(matches),
  };
}

function show(tournament: TournamentDetail, narrow = false) {
  return render(<SheetRoot><StandingsSection tournament={tournament} tournamentSlug="cup" currentUserPlayerId={2} ratings={standingsRatings} narrow={narrow} /></SheetRoot>);
}

describe("bracket", () => {
  it("draws every round on a wide column, named from the end, with Winner of boxes", () => {
    show(bracketTournament(8));
    expect(screen.getByRole("region", { name: "Bracket" })).toHaveAttribute("id", "standings");
    expect(screen.getAllByRole("group").map((g) => g.getAttribute("aria-label"))).toEqual(["Quarterfinals", "Semifinals", "Final"]);
    expect(screen.getByTestId("bracket-match-1")).toBeInTheDocument();
    expect(screen.getByTestId("bracket-match-4")).toBeInTheDocument();
    expect(screen.getAllByText(/Winner of P1 – P8/)).not.toHaveLength(0);
    expect(screen.queryByRole("tablist")).toBeNull();
  });

  it("shows a bye box for an odd field and highlights the viewer's match", () => {
    show(bracketTournament(5));
    expect(screen.getAllByText("Bye · goes straight through").length).toBeGreaterThan(0); // round 1, and round 2 by the engine quirk
    expect(screen.getByTestId("bracket-match-2")).toHaveAttribute("data-s", "you"); // P2 plays P5
  });

  it("on a phone shows one round at a time, opening on the current round", () => {
    const tournament = bracketTournament(4, (matches) => matches.map((m) => ({ ...m, status: "completed", winnerId: m.playerOneId })));
    // Round 2 exists and is open, so it is the round to open on.
    const withFinal: TournamentDetail = { ...tournament, matches: [...tournament.matches, {
      id: 3, matchId: null, roundNumber: 2, playerOneId: 1, playerTwoId: 2, playerOneName: "P1", playerTwoName: "P2",
      status: "open", winnerId: null, reporterId: null, resolvedAt: null, metadata: {},
    }] };
    show(withFinal, true);
    const tabs = screen.getByRole("tablist", { name: "Round" });
    const buttons = within(tabs).getAllByRole("tab");
    expect(buttons.map((b) => b.textContent)).toEqual(["Semis", "Final"]);
    expect(buttons[1]).toHaveAttribute("aria-selected", "true");
    expect(screen.getAllByRole("group")).toHaveLength(1);
    expect(screen.getByRole("group", { name: "Final" })).toBeInTheDocument();
    fireEvent.click(buttons[0]);
    expect(buttons[0]).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("group", { name: "Semifinals" })).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Final" })).toBeNull();
  });

  it("opens on the first round before anything is decided", () => {
    show(bracketTournament(8), true);
    expect(screen.getByRole("tab", { name: "Quarters" })).toHaveAttribute("aria-selected", "true");
  });

  it("shows a quiet empty state", () => {
    show({ ...bracketTournament(8), participants: [], matches: [] });
    expect(screen.getByText("No players yet.")).toBeInTheDocument();
  });
});
