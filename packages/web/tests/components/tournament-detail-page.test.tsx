// @vitest-environment jsdom
import React from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TournamentDetail } from "@/components/tournament/types";
import type { useTournamentWebsocket } from "@/lib/hooks/use-tournament-websocket";

vi.mock("next/font/google", () => {
  const font = () => ({ className: "font", variable: "font-var", style: {} });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});
const push = vi.fn();
let handlers: NonNullable<Parameters<typeof useTournamentWebsocket>[1]>;
vi.mock("next/navigation", () => ({
  useParams: () => ({ slug: "friday-night-12" }), useRouter: () => ({ push, replace: vi.fn() }), useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/hooks/use-tournament-websocket", () => ({
  useTournamentWebsocket: (_slug: string, options: typeof handlers) => { handlers = options; },
}));
vi.mock("@/components/tournament/standings/crosstable", () => ({ Crosstable: () => <section id="standings" aria-label="Standings" /> }));
vi.mock("@/components/tournament/matches/your-match", () => ({ YourMatch: () => <section id="your-match" aria-label="Your match" /> }));
vi.mock("@/components/tournament/matches/match-queue", () => ({ MatchQueue: () => <section id="matches" aria-label="Matches" /> }));

import TournamentDetailPage from "../../app/(app)/tournament/[slug]/page";
import { sheetRatings, sheetTournament, threeMatchTournament } from "../fixtures/tournament-sheet";

function setup(data: TournamentDetail = sheetTournament, userId = "host") {
  const fetchMock = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    if (String(url) === "/api/auth/session") return Response.json({ user: { id: userId } });
    if (String(url) === "/api/leaderboard?scope=all") return Response.json({ rows: sheetRatings });
    if (String(url) === "/api/tournaments/friday-night-12" && !init?.method) return Response.json(data);
    return Response.json({});
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}
function deferred() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((done) => { resolve = done; });
  return { promise, resolve };
}
beforeEach(() => { vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false }))); });
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe("TournamentDetailPage one sheet", () => {
  it("shows the approved header, progress and all three named sections together", async () => {
    setup(threeMatchTournament);
    render(<TournamentDetailPage />);
    expect(await screen.findByRole("heading", { name: "Friday Night Duels #12" })).toBeInTheDocument();
    expect(screen.getByText("In progress")).toBeInTheDocument();
    expect(screen.getByText("In progress").querySelector("[data-s=live]")).toBeInTheDocument();
    expect(screen.getByText("Round robin", { exact: true })).toBeInTheDocument();
    expect(screen.getByText("Best of 3", { exact: true })).toBeInTheDocument();
    expect(screen.getByText("6 players")).toBeInTheDocument();
    expect(screen.getByText("2/3 matches done")).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "2 of 3 matches done" })).toBeInTheDocument();
    expect(screen.queryByText(/Round \d+ of \d+/)).toBeNull();
    for (const name of ["Your match", "Standings", "Matches"]) expect(screen.getByRole("region", { name })).toBeInTheDocument();
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.getByRole("link", { name: "All tournaments" })).toHaveAttribute("href", "/tournaments");
  });

  it("preserves the single elimination round computation", async () => {
    setup({ ...threeMatchTournament, format: "single_elim" });
    render(<TournamentDetailPage />);
    expect(await screen.findByText("Round 2 of 2")).toBeInTheDocument();
    expect(screen.getByText("2/3 matches done")).toBeInTheDocument();
  });

  it("shows the organizer, deck states and YOU tag to the host", async () => {
    setup();
    render(<TournamentDetailPage />);
    expect(await screen.findByRole("region", { name: "Organizer" })).toHaveTextContent("only you see this");
    const players = screen.getByRole("region", { name: "Players" });
    expect(players).toHaveTextContent("6 · decks");
    expect(within(players).getAllByText("Locked")).toHaveLength(3);
    expect(within(players).getAllByText("Registered")).toHaveLength(2);
    expect(within(players).getByText("No deck")).toBeInTheDocument();
    expect(within(players).getByText("YOU")).toBeInTheDocument();
    for (const player of sheetTournament.participants) expect(within(players).getByRole("link", { name: player.displayName })).toHaveAttribute("href", `/player/${player.playerId}`);
    expect(screen.queryByRole("region", { name: "Your deck" })).toBeNull();
  });

  it("hides organizer tools and deck state for another viewer", async () => {
    setup(sheetTournament, "spectator");
    render(<TournamentDetailPage />);
    const players = await screen.findByRole("region", { name: "Players" });
    expect(screen.queryByRole("region", { name: "Organizer" })).toBeNull();
    expect(players).not.toHaveTextContent(/Locked|Registered|No deck|decks/);
  });

  it("ends the event only after confirmation and refreshes the same sheet", async () => {
    const fetchMock = setup();
    render(<TournamentDetailPage />);
    fireEvent.click(await screen.findByRole("button", { name: "End tournament now" }));
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "End tournament" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/tournaments/friday-night-12/complete", { method: "POST" }));
    await waitFor(() => expect(fetchMock.mock.calls.filter(([url, init]) => String(url) === "/api/tournaments/friday-night-12" && !init?.method)).toHaveLength(2));
    expect(screen.getByRole("region", { name: "Standings" })).toBeInTheDocument();
  });

  it("cancels only after confirmation, then returns to the tournament list", async () => {
    const fetchMock = setup();
    render(<TournamentDetailPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Cancel tournament" }));
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "DELETE")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Cancel tournament" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/tournaments/friday-night-12", { method: "DELETE" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/tournaments"));
  });

  it("saves a deadline through the page's slug and refresh callback", async () => {
    const fetchMock = setup();
    render(<TournamentDetailPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Edit deadline" }));
    fireEvent.change(screen.getByLabelText("Deadline"), { target: { value: "2099-01-01T12:30" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/tournaments/friday-night-12", {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ deadlineAt: new Date("2099-01-01T12:30").toISOString() }),
    }));
    await waitFor(() => expect(fetchMock.mock.calls.filter(([url, init]) => String(url) === "/api/tournaments/friday-night-12" && !init?.method)).toHaveLength(2));
  });

  it.each(["completed", "cancelled"])("renders the sheet with only event and players in the %s rail", async (status) => {
    setup({ ...sheetTournament, status });
    render(<TournamentDetailPage />);
    expect(await screen.findByText(status === "completed" ? "Completed" : "Cancelled")).toBeInTheDocument();
    const rail = screen.getByRole("complementary", { name: "Event details and organizer tools" });
    expect(within(rail).getByRole("region", { name: "Event details" })).toBeInTheDocument();
    expect(within(rail).getByRole("region", { name: "Players" })).toBeInTheDocument();
    expect(within(rail).queryByRole("region", { name: "Organizer" })).toBeNull();
    expect(within(rail).queryByRole("region", { name: "Your deck" })).toBeNull();
  });

  it("keeps the pending lobby and Add Bot request unchanged and outside SheetRoot", async () => {
    const fetchMock = setup({ ...sheetTournament, status: "pending" });
    const { container } = render(<TournamentDetailPage />);
    expect(await screen.findByRole("heading", { name: "Invite link" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "All Tournaments" })).toBeInTheDocument();
    expect(container.querySelector("[data-testid=tournament-page-shell]")).toBeNull();
    expect(screen.queryByRole("region", { name: "Standings" })).toBeNull();
    fireEvent.click(await screen.findByRole("button", { name: /Add Bot/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/tournaments/friday-night-12/join-bot", { method: "POST" }));
  });

  it("keeps the sheet and edited deadline on screen while a websocket refetch is pending", async () => {
    const fetchMock = setup();
    render(<TournamentDetailPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Edit deadline" }));
    fireEvent.change(screen.getByLabelText("Deadline"), { target: { value: "2099-01-01T12:30" } });
    const standings = screen.getByRole("region", { name: "Standings" });
    const update = deferred();
    fetchMock.mockImplementationOnce(() => update.promise);
    act(() => handlers.onMatchUpdated?.());
    expect(screen.getByRole("region", { name: "Standings" })).toBe(standings);
    expect(screen.getByLabelText("Deadline")).toHaveValue("2099-01-01T12:30");
    await act(async () => update.resolve(Response.json({ ...sheetTournament, name: "Updated event" })));
    expect(screen.getByRole("heading", { name: "Updated event" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Standings" })).toBe(standings);
    expect(screen.getByLabelText("Deadline")).toHaveValue("2099-01-01T12:30");
  });

  it("keeps old data with a quiet status after a failed refresh and clears it on recovery", async () => {
    const fetchMock = setup();
    render(<TournamentDetailPage />);
    await screen.findByRole("region", { name: "Matches" });
    fetchMock.mockResolvedValueOnce(Response.json({}, { status: 500 }));
    act(() => handlers.onMatchUpdated?.());
    expect(await screen.findByRole("status")).toHaveTextContent("Couldn't refresh. Showing the last update.");
    expect(screen.getByRole("heading", { name: sheetTournament.name })).toBeInTheDocument();
    act(() => handlers.onMatchUpdated?.());
    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
  });

  it.each([200, 500])("ignores an out-of-order tournament response with status %s", async (status) => {
    const fetchMock = setup();
    render(<TournamentDetailPage />);
    await screen.findByRole("region", { name: "Matches" });
    const old = deferred(), latest = deferred();
    fetchMock.mockImplementationOnce(() => old.promise).mockImplementationOnce(() => latest.promise);
    act(() => { handlers.onMatchUpdated?.(); handlers.onMatchUpdated?.(); });
    await act(async () => latest.resolve(Response.json({ ...sheetTournament, name: "Latest" })));
    await act(async () => old.resolve(Response.json({ ...sheetTournament, name: "Older" }, { status })));
    expect(screen.getByRole("heading", { name: "Latest" })).toBeInTheDocument();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("shows an initial-load error when no last update exists", async () => {
    const fetchMock = setup();
    fetchMock.mockImplementation(async (url) => String(url) === "/api/tournaments/friday-night-12" ? Response.json({}, { status: 500 }) : Response.json({}));
    render(<TournamentDetailPage />);
    expect(await screen.findByText("Failed to load tournament")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Matches" })).toBeNull();
  });

  it("fetches ratings once at mount, then again on a status change but not an ordinary refresh", async () => {
    const fetchMock = setup();
    render(<TournamentDetailPage />);
    await screen.findByRole("region", { name: "Matches" });
    const ratingsCalls = () => fetchMock.mock.calls.filter(([url]) => String(url) === "/api/leaderboard?scope=all");
    expect(ratingsCalls()).toHaveLength(1);
    act(() => handlers.onMatchUpdated?.());
    await act(async () => {});
    expect(ratingsCalls()).toHaveLength(1);
    fetchMock.mockResolvedValueOnce(Response.json({ ...sheetTournament, status: "completed" }));
    act(() => handlers.onCompleted?.());
    await screen.findByText("Completed");
    await waitFor(() => expect(ratingsCalls()).toHaveLength(2));
  });

  it.each(["onParticipantJoined", "onParticipantLeft", "onStarted", "onCancelled", "onCompleted", "onMatchUpdated"] as const)("refetches the tournament on %s", async (event) => {
    const fetchMock = setup();
    render(<TournamentDetailPage />);
    await screen.findByRole("region", { name: "Matches" });
    act(() => {
      if (event === "onParticipantJoined") handlers[event]?.({ playerId: 99, displayName: "New player" });
      else if (event === "onParticipantLeft") handlers[event]?.({ playerId: 99 });
      else handlers[event]?.();
    });
    await waitFor(() => expect(fetchMock.mock.calls.filter(([url, init]) => String(url) === "/api/tournaments/friday-night-12" && !init?.method)).toHaveLength(2));
  });

  it("keeps ratings failure separate from tournament refresh failure", async () => {
    const fetchMock = setup();
    fetchMock.mockImplementation(async (url) => {
      if (String(url) === "/api/auth/session") return Response.json({ user: { id: "host" } });
      if (String(url) === "/api/tournaments/friday-night-12") return Response.json(sheetTournament);
      if (String(url) === "/api/leaderboard?scope=all") return Response.json({}, { status: 500 });
      return Response.json({});
    });
    render(<TournamentDetailPage />);
    expect(await screen.findByRole("region", { name: "Players" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Standings" })).toBeInTheDocument();
    expect(screen.queryByRole("status")).toBeNull();
  });
});
