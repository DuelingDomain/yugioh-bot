// @vitest-environment jsdom
import React from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/font/google", () => {
  const font = () => ({ className: "font", variable: "font-var", style: {} });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

import { SheetRoot } from "@/components/sheet/sheet-root";
import { LiveView } from "@/components/tournament/floor/live-view";
import { StandingsGrid, goToMatch } from "@/components/tournament/standings/crosstable";
import { buildCrosstable } from "@/components/tournament/standings/standings-model";
import type { TournamentDetail } from "@/components/tournament/types";
import { standingsPlayers, standingsTournament } from "../fixtures/standings";
import { sheetRatings, sheetTournament } from "../fixtures/tournament-sheet";

// jsdom has no scrollIntoView.
beforeEach(() => { Element.prototype.scrollIntoView = vi.fn(); });
afterEach(() => {
  document.body.querySelectorAll("[data-test-node]").forEach((node) => node.remove());
  vi.unstubAllGlobals();
});

function grid(tournament: Pick<TournamentDetail, "participants" | "matches"> = standingsTournament, narrow = false) {
  return render(<SheetRoot><StandingsGrid rows={buildCrosstable(tournament, 5)} currentUserPlayerId={5} narrow={narrow} /></SheetRoot>);
}

describe("standings grid", () => {
  it("has the pinned columns in standings order and the W and L columns", () => {
    grid();
    expect(screen.getByRole("region", { name: "Standings grid" })).toHaveAttribute("tabindex", "0");
    expect(screen.getAllByRole("columnheader").map((node) => node.textContent)).toEqual([
      "#", "Player", "Kestrel", "Imran", "voidpriest", "duelist.josh", "BlueEyesBen", "Marik_Mains", "W", "L",
    ]);
  });

  it("shows places, records and profile links", () => {
    grid();
    const rows = within(screen.getByRole("table")).getAllByRole("row").slice(1);
    expect(rows.map((row) => within(row).getAllByRole("cell")[0].textContent)).toEqual(["1", "2", "2", "4", "4", "6"]);
    const kestrel = screen.getByRole("link", { name: "Kestrel" }).closest("tr")!;
    expect(within(kestrel).getAllByRole("cell").slice(-2).map((node) => node.textContent)).toEqual(["3", "0"]);
    for (const player of standingsPlayers) expect(screen.getByRole("link", { name: player.displayName })).toHaveAttribute("href", `/player/${player.playerId}`);
  });

  it("marks the viewer's row and gives each of their open matches a Play button", () => {
    grid();
    const row = screen.getByRole("link", { name: "Imran" }).closest("tr")!;
    expect(row.className).toContain("me");
    expect(within(row).getByText("You")).toBeInTheDocument();
    expect(within(row).getAllByRole("button", { name: /not started, play now/ }).map((button) => button.textContent)).toEqual(["Play", "Play"]);
    expect(screen.getAllByRole("button", { name: /play now/ })).toHaveLength(2);
  });

  it("describes live, reported, won and lost cells for the row player", () => {
    grid();
    const live = screen.getByRole("cell", { name: "Kestrel vs voidpriest: live, game 2, Kestrel leads 1–0" });
    expect(within(live).getByText("1–0")).toHaveAttribute("data-r", "live");
    expect(within(live).getByText("game 2")).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "voidpriest vs Kestrel: live, game 2, voidpriest trails 0–1" })).toBeInTheDocument();
    const reported = screen.getByRole("cell", { name: "Marik_Mains vs duelist.josh: reported win, awaiting confirmation" });
    expect(within(reported).getByText("W")).toHaveAttribute("data-r", "wait");
    expect(screen.getByRole("cell", { name: "Imran vs Kestrel: lost, 1–2" })).toHaveTextContent("lost");
    expect(screen.getByRole("cell", { name: "BlueEyesBen vs Marik_Mains: won" })).toHaveTextContent("W");
  });

  it("explains the cells in a legend on a wide column only", () => {
    const { unmount } = grid();
    const legend = screen.getByLabelText("How to read a cell");
    for (const text of ["Row player lost.", "Being played now.", "Yours to play.", "Not started."]) expect(within(legend).getByText(text)).toBeInTheDocument();
    unmount();
    grid(standingsTournament, true);
    expect(screen.queryByLabelText("How to read a cell")).toBeNull();
    expect(screen.getByText("Swipe the grid. Names and places stay pinned.")).toBeInTheDocument();
    expect(screen.getAllByRole("columnheader").map((node) => node.textContent)).not.toContain("W");
  });

  it("drops a Play button once its match is decided", () => {
    const { rerender } = grid();
    const next = { ...standingsTournament, matches: standingsTournament.matches.map((m) => (m.id === 8 ? { ...m, status: "completed", winnerId: 5 } : m)) };
    rerender(<SheetRoot><StandingsGrid rows={buildCrosstable(next, 5)} currentUserPlayerId={5} narrow={false} /></SheetRoot>);
    expect(screen.getAllByRole("button", { name: /play now/ })).toHaveLength(1);
    expect(screen.getByRole("cell", { name: "Imran vs BlueEyesBen: won" })).toHaveTextContent("W");
  });
});

/** A node standing in for the page elements goToMatch scrolls to. */
function pageNode(id: string) {
  const node = document.createElement("section");
  node.id = id;
  node.setAttribute("data-test-node", "true");
  node.scrollIntoView = vi.fn();
  document.body.append(node);
  return node;
}

describe("Play on a round robin with several open matches", () => {
  // Imran (5) plays Marik_Mains in round 1 and BlueEyesBen in round 3. Both are open from the start.
  const twoOpen: TournamentDetail = { ...sheetTournament, matches: sheetTournament.matches.map((m) => (m.id === 2 ? { ...m, roundNumber: 3 } : m)) };
  const ratings = new Map(sheetRatings.map((row) => [row.playerId, { rating: row.rating, rank: row.rank }]));

  function page() {
    return render(
      <SheetRoot>
        <LiveView tournament={twoOpen} tournamentSlug="friday-night-12" ratings={ratings} isHost={false} onChanged={() => {}} narrow={false} />
        <StandingsGrid rows={buildCrosstable(twoOpen, 5)} currentUserPlayerId={5} narrow={false} />
      </SheetRoot>,
    );
  }

  it("has one Play button per open match", () => {
    page();
    const row = screen.getByRole("table").querySelector("tr.me")!;
    expect(within(row as HTMLElement).getAllByRole("button", { name: /play now/ })).toHaveLength(2);
  });

  it("puts the clicked match on the field, scrolls to the field and focuses it", () => {
    page();
    const field = screen.getByRole("region", { name: "Your match" });
    expect(field).toHaveTextContent("Round 1. Not started.");
    fireEvent.click(screen.getByRole("button", { name: /Imran vs BlueEyesBen.*play now/ }));
    const after = screen.getByRole("region", { name: "Your match" });
    expect(after).toBe(field); // same element, so the id and the scroll stay stable
    expect(after).toHaveAttribute("id", "duel-field");
    expect(after).toHaveAttribute("data-match-id", "2");
    expect(after).toHaveTextContent("Round 3. Not started.");
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith(expect.objectContaining({ block: "start" }));
    expect(field).toHaveFocus();
  });

  it("can go back to the first match from its own Play button", () => {
    page();
    fireEvent.click(screen.getByRole("button", { name: /Imran vs BlueEyesBen.*play now/ }));
    fireEvent.click(screen.getByRole("button", { name: /Imran vs Marik_Mains.*play now/ }));
    expect(screen.getByTestId("duel-field")).toHaveAttribute("data-match-id", "1");
  });
});

describe("goToMatch fallbacks", () => {
  it("scrolls to the field whichever match is asked for", () => {
    const field = pageNode("duel-field");
    goToMatch(42);
    expect(field.scrollIntoView).toHaveBeenCalledWith(expect.objectContaining({ block: "start" }));
    expect(field).toHaveFocus();
  });

  it("falls back to the tables when there is no field, and does nothing when there is neither", () => {
    expect(() => goToMatch(7)).not.toThrow();
    const tables = pageNode("matches");
    goToMatch(7);
    expect(tables.scrollIntoView).toHaveBeenCalled();
    expect(tables).toHaveFocus();
  });

  it("scrolls without animation for a reader who asks for less motion", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    const field = pageNode("duel-field");
    act(() => goToMatch(1));
    expect(field.scrollIntoView).toHaveBeenCalledWith(expect.objectContaining({ behavior: "auto" }));
  });
});
