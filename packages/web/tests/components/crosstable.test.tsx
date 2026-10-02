// @vitest-environment jsdom
import React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/font/google", () => {
  const font = () => ({ className: "font", variable: "font-var", style: {} });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});

import { SheetRoot } from "@/components/sheet/sheet-root";
import { Crosstable } from "@/components/tournament/standings/crosstable";
import { largeStandingsTournament, standingsMatch, standingsPlayers, standingsRatings, standingsTournament } from "../fixtures/standings";

const props = { tournament: standingsTournament, tournamentSlug: "friday-night-duels-12", currentUserPlayerId: 5, ratings: standingsRatings };

afterEach(() => vi.unstubAllGlobals());

function renderStandings(overrides: Partial<typeof props> = {}) {
  return render(<SheetRoot><Crosstable {...props} {...overrides} /></SheetRoot>);
}

describe("tournament crosstable", () => {
  it("renders the named Standings section, sorting explanation and columns in standings order", () => {
    renderStandings();
    expect(screen.getByRole("region", { name: "Standings" })).toHaveAttribute("id", "standings");
    expect(screen.getByRole("heading", { name: "Standings" })).toBeInTheDocument();
    expect(screen.getByText("Placed by wins, then fewest losses. Equal records share a place.")).toBeInTheDocument();
    expect(screen.getAllByRole("columnheader").map((node) => node.textContent)).toEqual([
      "#", "Player", "Kestrel", "Imran", "voidpriest", "duelist.josh", "BlueEyesBen", "Marik_Mains", "W", "L",
    ]);
    for (const player of standingsPlayers) {
      expect(screen.getByRole("columnheader", { name: player.displayName }).querySelector("span")).toHaveAttribute("title", player.displayName);
    }
  });

  it("shows Kestrel's 3–0 record, shared places and profile links", () => {
    renderStandings();
    const table = screen.getByRole("table");
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows.map((row) => within(row).getAllByRole("cell")[0].textContent)).toEqual(["1", "2", "2", "4", "4", "6"]);
    const kestrel = screen.getByRole("link", { name: "Kestrel" }).closest("tr")!;
    expect(within(kestrel).getAllByRole("cell").slice(-2).map((node) => node.textContent)).toEqual(["3", "0"]);
    for (const player of standingsPlayers) {
      expect(screen.getByRole("link", { name: player.displayName })).toHaveAttribute("href", `/player/${player.playerId}`);
    }
  });

  it("highlights Imran and links both Play cells to the matching queue anchors", () => {
    renderStandings();
    const row = screen.getByRole("link", { name: "Imran" }).closest("tr")!;
    expect(row.className).toContain("me");
    expect(within(row).getByText("YOU")).toBeInTheDocument();
    const links = within(row).getAllByRole("link", { name: /not started, play now/ });
    expect(links.map((link) => [link.textContent, link.getAttribute("href")])).toEqual([
      ["Play", "#match-8"], ["Play", "#match-9"],
    ]);
    expect(screen.getAllByRole("link", { name: /play now/ })).toHaveLength(2);
  });

  it("renders live, reported, won and lost cells with the row player's score", () => {
    renderStandings();
    const live = screen.getByRole("cell", { name: "Kestrel vs voidpriest: live, game 2, Kestrel leads 1–0" });
    expect(within(live).getByText("1–0")).toHaveAttribute("data-r", "live");
    expect(within(live).getByText("game 2")).toBeInTheDocument();
    const reverse = screen.getByRole("cell", { name: "voidpriest vs Kestrel: live, game 2, voidpriest trails 0–1" });
    expect(within(reverse).getByText("0–1")).toBeInTheDocument();
    const reported = screen.getByRole("cell", { name: "Marik_Mains vs duelist.josh: reported win, awaiting confirmation" });
    expect(within(reported).getByText("reported")).toBeInTheDocument();
    expect(within(reported).getByText("W")).toHaveAttribute("data-r", "wait");
    expect(screen.getByRole("cell", { name: "Imran vs Kestrel: lost, 1–2" })).toHaveTextContent("lost");
    expect(screen.getByRole("cell", { name: "BlueEyesBen vs Marik_Mains: won" })).toHaveTextContent("W");
  });

  it("includes the exact legend and a keyboard-accessible scrolling container", () => {
    renderStandings();
    for (const text of ["won · game score when played online", "lost", "live now", "reported, not confirmed", "not started", "Columns are opponents, in standings order"]) {
      expect(within(screen.getByRole("group", { name: "Crosstable key" })).getByText(text)).toBeInTheDocument();
    }
    expect(screen.getByRole("region", { name: "Standings grid" })).toHaveAttribute("tabindex", "0");
  });

  it("uses a grey gem when a player's rating is missing", () => {
    renderStandings({ ratings: new Map() });
    const row = screen.getByRole("link", { name: "Imran" }).closest("tr")!;
    const gem = row.querySelector("svg")!;
    expect(gem).toHaveAttribute("aria-hidden", "true");
    expect(gem.querySelector("stop")).toHaveAttribute("stop-color", "#c7ccda");
    expect(screen.queryByText("1184")).toBeNull();
  });

  it("refreshes cells and standings from new props without another standings request", () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const { rerender } = renderStandings();
    const next = { ...standingsTournament, matches: standingsTournament.matches.map((slot) => slot.id === 8 ? {
      ...slot, status: "completed", matchId: 108, winnerId: 5,
    } : slot) };
    rerender(<SheetRoot><Crosstable {...props} tournament={next} /></SheetRoot>);
    expect(screen.getAllByRole("link", { name: /play now/ })).toHaveLength(1);
    expect(screen.getByRole("cell", { name: "Imran vs BlueEyesBen: won" })).toHaveTextContent("W");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each(["completed", "cancelled"])("retains standings for a %s tournament", (status) => {
    renderStandings({ tournament: { ...standingsTournament, status } });
    expect(screen.getAllByRole("row")).toHaveLength(7);
    expect(screen.getByRole("link", { name: "Kestrel" })).toBeInTheDocument();
  });

  it("renders a quiet empty section", () => {
    renderStandings({ tournament: { ...standingsTournament, participants: [], matches: [] } });
    expect(screen.getByText("No players yet.")).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.queryByRole("button", { name: /Show/ })).toBeNull();
  });
});

describe("standings list", () => {
  it("defaults to the list at 13 players and toggles the grid accessibly", () => {
    renderStandings({ tournament: largeStandingsTournament() });
    expect(screen.getAllByRole("columnheader").map((node) => node.textContent)).toEqual(["#", "Player", "W", "L"]);
    expect(screen.getByRole("button", { name: "Show grid" })).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(screen.getByRole("button", { name: "Show grid" }));
    expect(screen.getAllByRole("columnheader")).toHaveLength(17);
    expect(screen.getByRole("button", { name: "Show list" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Show list" }));
    expect(screen.getAllByRole("columnheader")).toHaveLength(4);
  });

  it("keeps the selected grid visible across live refreshes and reorders it", () => {
    const tournament = largeStandingsTournament();
    const { rerender } = renderStandings({ tournament });
    fireEvent.click(screen.getByRole("button", { name: "Show grid" }));
    rerender(<SheetRoot><Crosstable {...props} tournament={{ ...tournament, matches: [
      standingsMatch(60, 1, 5, { status: "completed", winnerId: 5 }),
    ] }} /></SheetRoot>);
    expect(screen.getByRole("button", { name: "Show list" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getAllByRole("columnheader")[2]).toHaveTextContent("Player 5");
  });

  it("keeps 12-player round robin as a grid without a toggle", () => {
    renderStandings({ tournament: largeStandingsTournament(12) });
    expect(screen.getAllByRole("columnheader")).toHaveLength(16);
    expect(screen.queryByRole("button", { name: /Show/ })).toBeNull();
  });

  it("always uses a standings list for single elimination with no grid toggle", () => {
    renderStandings({ tournament: { ...standingsTournament, format: "single_elimination" } });
    expect(screen.getAllByRole("columnheader").map((node) => node.textContent)).toEqual(["#", "Player", "W", "L"]);
    expect(screen.queryByRole("button", { name: /Show/ })).toBeNull();
    const row = screen.getByRole("link", { name: "Imran" }).closest("tr")!;
    expect(within(row).getByText("YOU")).toBeInTheDocument();
    expect(row.className).toContain("me");
    expect(within(row).getAllByRole("cell").map((node) => node.textContent)).toEqual(["2", "ImranYOU", "2", "1"]);
    expect(row.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });
});
