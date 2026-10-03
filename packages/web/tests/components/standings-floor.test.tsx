// @vitest-environment jsdom
import React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/font/google", () => {
  const font = () => ({ className: "font", variable: "font-var", style: {} });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});

import { SheetRoot } from "@/components/sheet/sheet-root";
import { StandingsFloor } from "@/components/tournament/standings/standings-floor";
import { standingsPlayers, standingsRatings, standingsTournament } from "../fixtures/standings";

const props = { tournament: standingsTournament, tournamentSlug: "friday-night-duels-12", currentUserPlayerId: 5, ratings: standingsRatings };
afterEach(() => vi.unstubAllGlobals());

function show(overrides: Partial<typeof props> & { final?: boolean } = {}) {
  return render(<SheetRoot><StandingsFloor {...props} {...overrides} /></SheetRoot>);
}
const rows = () => Array.from(screen.getByRole("list", { name: "Tournament standings" }).querySelectorAll<HTMLElement>(":scope > li"));

describe("standings on the floor", () => {
  it("is the named Standings section with its anchors and the sorting rule", () => {
    const { container } = show();
    expect(screen.getByRole("region", { name: "Standings" })).toHaveAttribute("id", "standings");
    expect(container.querySelector("#players")).not.toBeNull();
    expect(screen.getByRole("heading", { name: "Standings" })).toBeInTheDocument();
    expect(screen.getByText("Wins, then fewest losses. Equal records share a place.")).toBeInTheDocument();
  });

  it("lists every player in standings order with shared places, records and profile links", () => {
    show();
    const items = rows();
    expect(items).toHaveLength(standingsPlayers.length);
    expect(items.map((row) => row.querySelector(".sv-cell-rank")?.textContent)).toEqual(["1", "2", "2", "4", "4", "6"]);
    expect(items[0]).toHaveTextContent("Kestrel");
    expect(within(items[0]).getByLabelText("3 wins, 0 losses")).toHaveTextContent("3–0");
    for (const player of standingsPlayers) expect(screen.getByRole("link", { name: player.displayName })).toHaveAttribute("href", `/player/${player.playerId}`);
  });

  it("marks the viewer with a You pill and the row underlay", () => {
    show();
    const mine = screen.getByRole("link", { name: "Imran" }).closest("li")!;
    expect(mine).toHaveAttribute("data-you", "true");
    expect(within(mine).getByText("You")).toBeInTheDocument();
  });

  it("flags who is playing now and who owes a reply", () => {
    show();
    expect(screen.getAllByRole("img", { name: /^Live/ }).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Owes a reply").length).toBeGreaterThan(0);
  });

  it("shows no tier line for a player without a rating", () => {
    show({ ratings: new Map() });
    expect(screen.queryByText("1184")).toBeNull();
  });

  it("titles a finished tournament Final standings", () => {
    show({ final: true });
    expect(screen.getByRole("region", { name: "Final standings" })).toBeInTheDocument();
  });

  it.each(["completed", "cancelled"])("keeps the standings of a %s tournament", (status) => {
    show({ tournament: { ...standingsTournament, status } });
    expect(rows()).toHaveLength(6);
  });

  it("has a quiet empty state with no toggle", () => {
    show({ tournament: { ...standingsTournament, participants: [], matches: [] } });
    expect(screen.getByText("No players yet.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Show/ })).toBeNull();
  });

  it("offers no grid for single elimination", () => {
    show({ tournament: { ...standingsTournament, format: "single_elim" } });
    expect(screen.queryByRole("button", { name: /Show/ })).toBeNull();
  });
});

describe("the grid view", () => {
  it("toggles to the crosstable and back, keeping the toggle state in aria-pressed", () => {
    show();
    const toggle = screen.getByRole("button", { name: "Show grid" });
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(toggle);
    expect(screen.getByRole("button", { name: "Show list" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getAllByRole("columnheader").map((node) => node.textContent)).toEqual([
      "#", "Player", "Kestrel", "Imran", "voidpriest", "duelist.josh", "BlueEyesBen", "Marik_Mains", "W", "L",
    ]);
    expect(screen.getByRole("region", { name: "Standings grid" })).toHaveAttribute("tabindex", "0");
    fireEvent.click(screen.getByRole("button", { name: "Show list" }));
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("describes live, reported, won and lost cells for the row player", () => {
    show();
    fireEvent.click(screen.getByRole("button", { name: "Show grid" }));
    const live = screen.getByRole("cell", { name: "Kestrel vs voidpriest: live, game 2, Kestrel leads 1–0" });
    expect(within(live).getByText("1–0")).toHaveAttribute("data-r", "live");
    expect(screen.getByRole("cell", { name: "Imran vs Kestrel: lost, 1–2" })).toHaveTextContent("lost");
    expect(screen.getByRole("cell", { name: "BlueEyesBen vs Marik_Mains: won" })).toHaveTextContent("W");
    expect(within(screen.getByLabelText("How to read a cell")).getByText("Row player lost.")).toBeInTheDocument();
  });

  it("sends a Play cell to the viewer's match field and focuses it", () => {
    show();
    fireEvent.click(screen.getByRole("button", { name: "Show grid" }));
    const target = document.createElement("section");
    target.id = "duel-field";
    target.scrollIntoView = vi.fn();
    document.body.append(target);
    const play = screen.getAllByRole("button", { name: /play now/ })[0];
    fireEvent.click(play);
    expect(target.scrollIntoView).toHaveBeenCalledWith(expect.objectContaining({ block: "start" }));
    expect(target).toHaveFocus();
    target.remove();
  });
});
