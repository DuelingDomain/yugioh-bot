// @vitest-environment jsdom
import React from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/font/google", () => {
  const font = () => ({ className: "font", variable: "font-var", style: {} });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

import { SheetRoot } from "@/components/sheet";
import { requestMatch } from "@/components/tournament/floor/select-match";
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
    expect(field).toHaveAttribute("id", "duel-field");
    expect(field).toHaveAttribute("data-match-id", "1");
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

describe("the field as drawn in the mock", () => {
  it("puts the tables of the round above the field, and both name the same round", () => {
    live(sheetTournament);
    const strip = screen.getByTestId("table-strip");
    const field = screen.getByTestId("duel-field");
    expect(strip.compareDocumentPosition(field) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(strip).getByRole("heading", { level: 2 })).toHaveTextContent("Round 1. 3 tables.");
    expect(field).toHaveTextContent("Round 1. Not started.");
  });

  it("shows the record so far under each seat", () => {
    live(sheetTournament);
    const field = screen.getByTestId("duel-field");
    expect(within(field).getAllByText(/^\d+–\d+ so far$/)).toHaveLength(2);
    expect(within(field).queryByText(/here$/)).toBeNull();
  });

  it("always shows the big score and the game dots, 0 to 0 before it starts", () => {
    live(sheetTournament);
    const field = screen.getByTestId("duel-field");
    expect(within(field).getByLabelText("Games 0 to 0")).toHaveTextContent("0 – 0");
    expect(within(field).getByRole("img", { name: "Best of 3, 0 to 0" }).querySelectorAll("i")).toHaveLength(3);
  });

  it("labels the zones: Beat, Lost to, this round, and R-numbers with the opponent dim inside", () => {
    live({ ...sheetTournament, matches: sheetTournament.matches.map((m) => (m.id === 8 ? { ...m, roundNumber: 1 } : m)) });
    const field = screen.getByTestId("duel-field");
    expect(within(field).getAllByText("Round 1").length).toBeGreaterThan(0);
    expect(within(field).getAllByText(/^R\d$/).length).toBeGreaterThan(0);
    expect(within(field).getAllByText(/^Beat [A-Z][a-z]$/).length).toBeGreaterThan(0);
    expect(within(field).getAllByText(/^Lost to [A-Z][a-z]$/).length).toBeGreaterThan(0);
  });

  it("reads a finished table as who won and the score, and a live one with a dot and Watch", () => {
    const { container } = render(<SheetRoot><TableStrip tournament={sheetTournament} round={1} viewerId={5} /></SheetRoot>);
    expect(container).toHaveTextContent("Kestrel won 2–1.");
    expect(container).not.toHaveTextContent("Final Kestrel");
  });

  it("shows the live table with Game N in progress and a Watch link", () => {
    const { container } = render(<SheetRoot><TableStrip tournament={sheetTournament} round={2} viewerId={5} /></SheetRoot>);
    expect(container).toHaveTextContent("Game 2 in progress");
    expect(screen.getByRole("link", { name: "Watch" })).toHaveAttribute("href", "/duels/duel-4");
    expect(container.querySelector(".sv-ldot")).not.toBeNull();
  });

  it("gives each spectator table both players' round slots beside their names, the dots, and the status under it", () => {
    const { container } = render(<SheetRoot><SpectatorGrid tournament={sheetTournament} round={2} viewerId={null} /></SheetRoot>);
    const tables = container.querySelectorAll('[data-st]');
    expect(tables.length).toBe(3);
    for (const table of Array.from(tables)) {
      expect(table.querySelectorAll('[role="group"][aria-label$=", rounds"]')).toHaveLength(2);
      expect(table.querySelector('[role="img"][aria-label^="Best of"]')).not.toBeNull();
    }
    expect(container).toHaveTextContent("Game 2 in progress");
  });
});

describe("live duels in other rounds", () => {
  it("lists a live series from a later round under the table strip with a Watch link", () => {
    render(<SheetRoot><TableStrip tournament={sheetTournament} round={1} viewerId={5} /></SheetRoot>);
    const also = screen.getByTestId("also-live");
    expect(within(also).getByRole("heading", { name: "Also live" })).toBeInTheDocument();
    expect(also).toHaveTextContent("Round 2.");
    expect(within(also).getByRole("link", { name: /^Watch .* round 2$/ })).toHaveAttribute("href", "/duels/duel-4");
  });

  it("lists it under the spectator grid too, and not when the live series is in the shown round", () => {
    const first = render(<SheetRoot><SpectatorGrid tournament={sheetTournament} round={1} viewerId={null} /></SheetRoot>);
    expect(within(screen.getByTestId("also-live")).getByRole("link", { name: /^Watch/ })).toHaveAttribute("href", "/duels/duel-4");
    first.unmount();
    render(<SheetRoot><SpectatorGrid tournament={sheetTournament} round={2} viewerId={null} /></SheetRoot>);
    expect(screen.queryByTestId("also-live")).toBeNull();
  });
});

// A round robin makes every round at the start. Imran has two open matches here, in rounds 1 and 3.
const twoOpen: TournamentDetail = { ...sheetTournament, matches: sheetTournament.matches.map((m) => (m.id === 2 ? { ...m, roundNumber: 3 } : m)) };

describe("a player with more than one open match", () => {
  it("lists the other open matches under the field and keeps the first one on it", () => {
    live(twoOpen);
    const field = screen.getByRole("region", { name: "Your match" });
    expect(field).toHaveTextContent("Round 1. Not started.");
    expect(within(field).getByRole("button", { name: "Start duel" })).toBeInTheDocument();
    const list = screen.getByRole("region", { name: "Your other matches" });
    const buttons = within(list).getAllByRole("button");
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toHaveAccessibleName("Round 3, against BlueEyesBen. Show this match.");
    expect(list).not.toHaveTextContent("Marik_Mains");
  });

  it("puts a picked match on the field with its own actions, and the tables of that round", () => {
    live(twoOpen);
    fireEvent.click(screen.getByRole("button", { name: /Round 3, against BlueEyesBen/ }));
    const field = screen.getByRole("region", { name: "Your match" });
    expect(field).toHaveTextContent("Round 3. Not started.");
    expect(within(field).getByRole("button", { name: "Start duel" })).toBeInTheDocument();
    expect(within(screen.getByTestId("table-strip")).getByRole("heading", { level: 2 })).toHaveTextContent(/^Round 3\./);
    // The match that left the field is in the list now.
    expect(screen.getByRole("button", { name: /Round 1, against Marik_Mains/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Round 3, against BlueEyesBen/ })).toBeNull();
  });

  it("puts a match on the field when a zone of a round still to play is clicked", () => {
    live(twoOpen);
    const field = screen.getByRole("region", { name: "Your match" });
    fireEvent.click(within(field).getByRole("button", { name: /Round 3, plays BlueEyesBen\. Show this match\./ }));
    expect(screen.getByRole("region", { name: "Your match" })).toHaveTextContent("Round 3. Not started.");
  });

  it("follows a request from another part of the page, like a Play cell", () => {
    live(twoOpen);
    act(() => requestMatch(2));
    expect(screen.getByRole("region", { name: "Your match" })).toHaveTextContent("Round 3. Not started.");
  });

  it("ignores a request for a match that is not an open match of the viewer", () => {
    live(twoOpen);
    act(() => requestMatch(3)); // decided
    act(() => requestMatch(11)); // somebody else's
    expect(screen.getByRole("region", { name: "Your match" })).toHaveTextContent("Round 1. Not started.");
  });

  it("falls back to the first open match once the picked one is decided", () => {
    const { rerender } = live(twoOpen);
    act(() => requestMatch(2));
    const decided = { ...twoOpen, matches: twoOpen.matches.map((m) => (m.id === 2 ? { ...m, status: "completed", winnerId: 5 } : m)) };
    rerender(
      <SheetRoot>
        <LiveView tournament={decided} tournamentSlug="friday-night-12" ratings={ratings} isHost={false} onChanged={() => {}} narrow={false} />
      </SheetRoot>,
    );
    expect(screen.getByRole("region", { name: "Your match" })).toHaveTextContent("Round 1. Not started.");
    expect(screen.queryByRole("region", { name: "Your other matches" })).toBeNull();
  });

  it("shows no list when the viewer has one open match", () => {
    live({ ...sheetTournament, matches: sheetTournament.matches.map((m) => (m.id === 2 ? { ...m, status: "completed", winnerId: 5 } : m)) });
    expect(screen.queryByRole("region", { name: "Your other matches" })).toBeNull();
  });
});
