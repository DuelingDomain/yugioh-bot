// @vitest-environment jsdom
import React from "react";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SheetRoot } from "@/components/sheet/sheet-root";
import { MyRow } from "@/components/tournament/matches/my-row";
import type { DuelSeriesSummary } from "@/components/tournament/types";
import { liveMatch, matchProps, seriesFor, slot, tournament } from "../fixtures/matches";

function show(status: DuelSeriesSummary["status"], featured: boolean) {
  const match = { ...liveMatch, series: seriesFor(liveMatch, { status }) };
  const matches = featured ? [match] : [slot(5, 1, 3), match];
  render(<SheetRoot><MyRow {...matchProps} currentUserPlayerId={1} tournament={tournament({ currentUserPlayerId: 1, matches })} /></SheetRoot>);
  return within(screen.getByText("vs voidpriest").closest("li")!);
}

describe("Your row", () => {
  it.each([
    { status: "active" as const, featured: true },
    { status: "active" as const, featured: false },
    { status: "between_games" as const, featured: true },
    { status: "between_games" as const, featured: false },
  ])("shows an open match with a $status series as live (featured=$featured)", ({ status, featured }) => {
    const row = show(status, featured);
    expect(row.getByText("live").parentElement).toHaveTextContent("1–0");
    expect(row.getByText(featured ? "The match above" : "Being played now")).toBeInTheDocument();
    expect(row.queryByRole("button", { name: "Play voidpriest" })).toBeNull();
    expect(row.queryByText("Not started")).toBeNull();
    expect(row.queryByText(/−\d+ \/ \+\d+/)).toBeNull();
  });

  it("keeps a cancelled series playable with projected stakes", () => {
    const row = show("cancelled", false);
    expect(row.getByRole("button", { name: "Play voidpriest" })).toBeInTheDocument();
    expect(row.getByText("Not started")).toBeInTheDocument();
    expect(row.getByText(/−\d+ \/ \+\d+/)).toBeInTheDocument();
    expect(row.queryByText("live")).toBeNull();
  });
});
