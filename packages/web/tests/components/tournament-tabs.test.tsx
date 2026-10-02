// @vitest-environment jsdom
import React from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { useTournamentWebsocket } from "@/lib/hooks/use-tournament-websocket";

vi.mock("next/font/google", () => {
  const font = () => ({ className: "font", variable: "font-var", style: {} });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});
let searchParams = new URLSearchParams();
let handlers: NonNullable<Parameters<typeof useTournamentWebsocket>[1]>;
vi.mock("next/navigation", () => ({
  useParams: () => ({ slug: "friday-night-12" }), useRouter: () => ({ replace: vi.fn(), push: vi.fn() }), useSearchParams: () => searchParams,
}));
vi.mock("@/lib/hooks/use-tournament-websocket", () => ({ useTournamentWebsocket: (_slug: string, options: typeof handlers) => { handlers = options; } }));
vi.mock("@/components/tournament/standings/crosstable", () => ({ Crosstable: () => <section id="standings" aria-label="Standings" /> }));
vi.mock("@/components/tournament/matches/your-match", () => ({ YourMatch: () => <section id="your-match" aria-label="Your match" /> }));
vi.mock("@/components/tournament/matches/match-queue", () => ({ MatchQueue: () => <section id="matches" aria-label="Matches" /> }));
import TournamentDetailPage from "../../app/(app)/tournament/[slug]/page";
import { sheetRatings, sheetTournament } from "../fixtures/tournament-sheet";

const scroll = vi.fn();
beforeEach(() => {
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false })));
  HTMLElement.prototype.scrollIntoView = scroll;
  vi.stubGlobal("fetch", vi.fn(async (url: RequestInfo | URL) => {
    if (String(url) === "/api/auth/session") return Response.json({ user: { id: "host" } });
    if (String(url) === "/api/tournaments/friday-night-12") return Response.json(sheetTournament);
    if (String(url) === "/api/leaderboard?scope=all") return Response.json({ rows: sheetRatings });
    return Response.json({});
  }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); searchParams = new URLSearchParams(); });

describe("legacy tournament tab links", () => {
  it.each([["standings", "standings"], ["all", "matches"], ["players", "players"]])("scrolls tab=%s to #%s once after loading", async (tab, id) => {
    searchParams = new URLSearchParams({ tab });
    render(<TournamentDetailPage />);
    await waitFor(() => expect(scroll).toHaveBeenCalledTimes(1));
    expect(scroll.mock.instances[0]).toBe(document.getElementById(id));
    expect(scroll).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
    act(() => handlers.onMatchUpdated?.());
    await act(async () => {});
    expect(scroll).toHaveBeenCalledTimes(1);
  });
  it.each(["my", "overview", "unknown", ""])("keeps tab=%s at the top while showing the one sheet", async (tab) => {
    searchParams = new URLSearchParams({ tab });
    render(<TournamentDetailPage />);
    expect(await screen.findByRole("region", { name: "Standings" })).toBeInTheDocument();
    expect(scroll).not.toHaveBeenCalled();
  });
  it("uses immediate scrolling for reduced motion", async () => {
    searchParams = new URLSearchParams("tab=standings");
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true })));
    render(<TournamentDetailPage />);
    await waitFor(() => expect(scroll).toHaveBeenCalledWith({ behavior: "instant", block: "start" }));
  });
});
