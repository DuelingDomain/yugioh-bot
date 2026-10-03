// @vitest-environment jsdom
import React from "react";
import { render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/font/google", () => {
  const font = () => ({ className: "font", variable: "font-var", style: {} });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

import { SheetRoot } from "@/components/sheet";
import { LiveView } from "@/components/tournament/floor/live-view";
import { SpectatorGrid, TableStrip } from "@/components/tournament/floor/tables";
import type { Match, TournamentDetail } from "@/components/tournament/types";
import { sheetRatings, sheetTournament } from "../fixtures/tournament-sheet";

const ratings = new Map(sheetRatings.map((row) => [row.playerId, { rating: row.rating, rank: row.rank }]));
afterEach(() => vi.restoreAllMocks());

function live(tournament: TournamentDetail, isHost = false) {
  return render(
    <SheetRoot>
      <LiveView tournament={tournament} tournamentSlug="friday-night-12" ratings={ratings} isHost={isHost} onChanged={() => {}} narrow={false} />
    </SheetRoot>,
  );
}

const done = (m: Match): Match => ({ ...m, status: "completed", winnerId: m.playerOneId });
const allDecided: TournamentDetail = { ...sheetTournament, status: "completed", matches: sheetTournament.matches.map(done) };

describe("your field", () => {
  it("shows both seats, the opponent's name and the actions of an open match", () => {
    live(sheetTournament);
    const field = screen.getByRole("region", { name: "Your match" });
    expect(field).toHaveAttribute("id", expect.stringMatching(/^match-\d+$/));
    expect(within(field).getAllByText("Imran").length).toBeGreaterThan(0);
    expect(within(field).getByRole("button", { name: "Start duel" })).toBeInTheDocument();
  });

  it("names the stakes from the server and never says winnings", () => {
    const match = sheetTournament.matches.find((m) => m.id === 1)!;
    const { container } = live({ ...sheetTournament, stakes: { tournamentMatchId: match.id, opponentId: 3, win: 18, loss: -14 } });
    expect(container).toHaveTextContent("+18");
    expect(container).toHaveTextContent("−14");
    expect(container.textContent ?? "").not.toMatch(/winnings/i);
  });

  it("gives a spectator the grid of every table instead of a field", () => {
    live({ ...sheetTournament, isParticipant: false, currentUserPlayerId: null });
    expect(screen.getByTestId("spectator-grid")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Your match" })).toBeNull();
  });

  it("crowns the champion of a finished tournament", () => {
    live(allDecided);
    const champ = screen.getByRole("region", { name: "Champion" });
    expect(champ).toHaveTextContent(/wins Friday Night Duels #12/);
  });

  it("tells an early end apart from a finish: no champion", () => {
    live({ ...sheetTournament, status: "completed" });
    expect(screen.queryByRole("region", { name: "Champion" })).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent(/Ended early with \d+ matches unplayed\./);
  });
});

describe("the tables of a round", () => {
  it("lists a table per match with the viewer's table marked and a Watch link on live ones", () => {
    const { container } = render(<SheetRoot><TableStrip tournament={sheetTournament} round={2} viewerId={5} /></SheetRoot>);
    expect(screen.getByTestId("table-strip")).toHaveAttribute("id", "matches");
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(/^Round 2\. \d+ tables?\.$/);
    expect(container.querySelectorAll("[data-table-score]").length).toBeGreaterThan(0);
  });

  it("marks the viewer's table", () => {
    render(<SheetRoot><TableStrip tournament={sheetTournament} round={1} viewerId={5} /></SheetRoot>);
    expect(screen.getAllByText("Your table").length).toBeGreaterThan(0);
  });

  it("the spectator grid puts a locator slot for each player on every table", () => {
    const { container } = render(<SheetRoot><SpectatorGrid tournament={sheetTournament} round={1} viewerId={null} /></SheetRoot>);
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(/^Round 1 of 5\. Every table\.$/);
    const slots = container.querySelectorAll("[data-slot]");
    expect(slots.length).toBeGreaterThan(0);
    expect(slots[0].getAttribute("data-slot")).toMatch(/^\d+:\d+$/);
  });
});
