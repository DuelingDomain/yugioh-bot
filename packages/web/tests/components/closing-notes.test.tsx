// @vitest-environment jsdom
import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/font/google", () => {
  const font = () => ({ className: "font", variable: "font-var", style: {} });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});

import { SheetRoot } from "@/components/sheet";
import { ClosingNote } from "@/components/tournament/sheet/closing-notes";
import { tournamentEnding } from "@/components/tournament/sheet/sheet-header";
import { sheetTournament } from "../fixtures/tournament-sheet";

const allDone = { ...sheetTournament, status: "completed", matches: sheetTournament.matches.map((m) => ({ ...m, status: "completed" })) };

describe("closed tournament endings", () => {
  it("tells the three endings apart", () => {
    expect(tournamentEnding({ ...sheetTournament, status: "active" })).toBeNull();
    expect(tournamentEnding({ ...sheetTournament, status: "cancelled" })).toBe("cancelled");
    expect(tournamentEnding({ ...sheetTournament, status: "completed" })).toBe("ended-early");
    expect(tournamentEnding(allDone)).toBe("finished");
  });

  it("finished: a Finished stamp and a match count, with no champion crowned", () => {
    render(<SheetRoot><ClosingNote tournament={allDone} ending="finished" /></SheetRoot>);
    expect(screen.getByText("Finished")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Result" })).toHaveTextContent(`${allDone.matches.length} matches decided`);
    expect(screen.queryByText(/champion/i)).toBeNull();
  });

  it("ended early: counts the unplayed matches", () => {
    const tournament = { ...sheetTournament, status: "completed" };
    const unplayed = tournament.matches.filter((m) => m.status !== "completed").length;
    render(<SheetRoot><ClosingNote tournament={tournament} ending="ended-early" /></SheetRoot>);
    expect(screen.getByRole("status")).toHaveTextContent(`Ended early with ${unplayed} ${unplayed === 1 ? "match" : "matches"} unplayed.`);
  });

  it("cancelled: a clear note", () => {
    render(<SheetRoot><ClosingNote tournament={{ ...sheetTournament, status: "cancelled" }} ending="cancelled" /></SheetRoot>);
    expect(screen.getByRole("status")).toHaveTextContent("The organizer cancelled this tournament.");
  });
});
