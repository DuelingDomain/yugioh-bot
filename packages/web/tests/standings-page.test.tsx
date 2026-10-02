// @vitest-environment jsdom
import React from "react";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/font/google", () => {
  const font = () => ({ className: "font", variable: "font-var", style: {} });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});
vi.mock("next/navigation", () => ({ useParams: () => ({ slug: "friday-night-12" }) }));
vi.mock("@/components/tournament/standings/standings-section", () => ({
  StandingsSection: ({ final }: { final?: boolean }) => <section aria-label={final ? "Final standings" : "Standings"} />,
}));

import StandingsPage from "../app/(app)/tournament/[slug]/standings/page";
import { sheetTournament } from "./fixtures/tournament-sheet";

afterEach(() => vi.unstubAllGlobals());

function stub(status = 200, tournament = sheetTournament) {
  const fetchMock = vi.fn(async (url: RequestInfo | URL) =>
    String(url).startsWith("/api/leaderboard") ? Response.json({ rows: [] }) : status === 200 ? Response.json(tournament) : new Response("{}", { status }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("standings route", () => {
  it("renders the same standings section the sheet shows, with no redirect", async () => {
    const fetchMock = stub();
    render(<StandingsPage />);
    expect(await screen.findByRole("region", { name: "Standings" })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith("/api/tournaments/friday-night-12");
  });

  it("titles a completed tournament Final standings", async () => {
    stub(200, { ...sheetTournament, status: "completed" });
    render(<StandingsPage />);
    expect(await screen.findByRole("region", { name: "Final standings" })).toBeInTheDocument();
  });

  it("shows an error when the tournament cannot load", async () => {
    stub(404);
    render(<StandingsPage />);
    expect(await screen.findByText("Failed to load tournament")).toBeInTheDocument();
  });
});
