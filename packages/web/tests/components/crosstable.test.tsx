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
import { sheetRatings, sheetTournament } from "../fixtures/tournament-sheet";

// jsdom has no scrollIntoView.
beforeEach(() => { Element.prototype.scrollIntoView = vi.fn(); });
afterEach(() => {
  document.body.querySelectorAll("[data-test-node]").forEach((node) => node.remove());
  vi.unstubAllGlobals();
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
