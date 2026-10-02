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
let searchParams = new URLSearchParams();
vi.mock("next/navigation", () => ({
  useParams: () => ({ slug: "friday-night-12" }), useRouter: () => ({ push, replace: vi.fn() }), useSearchParams: () => searchParams,
}));
vi.mock("@/lib/hooks/use-tournament-websocket", () => ({
  useTournamentWebsocket: (_slug: string, options: typeof handlers) => { handlers = options; },
}));
vi.mock("@/components/tournament/standings/standings-section", () => ({ StandingsSection: () => <section id="standings" aria-label="Standings" /> }));
vi.mock("@/components/tournament/matches/your-match", () => ({ YourMatch: () => <section id="your-match" aria-label="Your match" /> }));
vi.mock("@/components/tournament/matches/match-queue", () => ({ MatchQueue: () => <section id="matches" aria-label="Matches" /> }));

import TournamentDetailPage from "../../app/(app)/tournament/[slug]/page";
import { sheetRatings, sheetTournament, threeMatchTournament } from "../fixtures/tournament-sheet";

const SLUG = "/api/tournaments/friday-night-12";

function setup(data: TournamentDetail = sheetTournament, userId = "host") {
  const fetchMock = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    if (String(url) === "/api/auth/session") return Response.json({ user: { id: userId } });
    if (String(url) === "/api/leaderboard?scope=all") return Response.json({ rows: sheetRatings });
    if (String(url) === SLUG && !init?.method) return Response.json(data);
    return Response.json({});
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}
const detailFetches = (fetchMock: ReturnType<typeof setup>) => fetchMock.mock.calls.filter(([url, init]) => String(url) === SLUG && !init?.method);
function deferred() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((done) => { resolve = done; });
  return { promise, resolve };
}
beforeEach(() => { vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false }))); });
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); searchParams = new URLSearchParams(); });

describe("TournamentDetailPage one sheet", () => {
  it("shows the header, the track caption and the three named sections together", async () => {
    setup(threeMatchTournament);
    render(<TournamentDetailPage />);
    expect(await screen.findByRole("heading", { name: "Friday Night Duels #12" })).toBeInTheDocument();
    expect(screen.getByText("In progress")).toBeInTheDocument();
    expect(screen.getByText("Round robin", { exact: true })).toBeInTheDocument();
    expect(screen.getByText("6 players")).toBeInTheDocument();
    expect(screen.getByText("2 of 3 decided")).toBeInTheDocument();
    expect(screen.queryByText(/Round \d+ of \d+/)).toBeNull();
    for (const name of ["Your match", "Standings", "Matches"]) expect(screen.getByRole("region", { name })).toBeInTheDocument();
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.getByRole("link", { name: "All tournaments" })).toHaveAttribute("href", "/tournaments");
    expect(screen.getByTestId("tournament-page-shell")).toBeInTheDocument();
  });

  it("preserves the single elimination round computation", async () => {
    setup({ ...threeMatchTournament, format: "single_elim" });
    render(<TournamentDetailPage />);
    expect(await screen.findByText("Round 2 of 2")).toBeInTheDocument();
  });

  it("shows the Decks sheet, deck states and the YOU tag to the host", async () => {
    setup();
    render(<TournamentDetailPage />);
    const players = await screen.findByRole("region", { name: "Decks" });
    expect(players).toHaveTextContent("organizer only");
    expect(within(players).getAllByText("Locked")).toHaveLength(3);
    expect(within(players).getAllByText("Registered")).toHaveLength(2);
    expect(within(players).getByText("No deck yet")).toBeInTheDocument();
    expect(within(players).getByText("you")).toBeInTheDocument();
    for (const player of sheetTournament.participants) expect(within(players).getByRole("link", { name: player.displayName })).toHaveAttribute("href", `/player/${player.playerId}`);
    expect(screen.getByRole("heading", { name: "Ending early" })).toBeInTheDocument();
  });

  it("shows another viewer a plain Players list with no organizer tools or deck state", async () => {
    setup(sheetTournament, "spectator");
    render(<TournamentDetailPage />);
    const players = await screen.findByRole("region", { name: "Players" });
    expect(screen.queryByRole("heading", { name: "Ending early" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Decks" })).toBeNull();
    expect(players).not.toHaveTextContent(/Locked|Registered|No deck/);
  });

  it("ends the event only after confirmation and refreshes the same sheet", async () => {
    const fetchMock = setup();
    render(<TournamentDetailPage />);
    fireEvent.click(await screen.findByRole("button", { name: "End now" }));
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Yes, end now" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(`${SLUG}/complete`, { method: "POST" }));
    await waitFor(() => expect(detailFetches(fetchMock)).toHaveLength(2));
    expect(screen.getByRole("region", { name: "Standings" })).toBeInTheDocument();
  });

  it("cancels only after confirmation, then returns to the tournament list", async () => {
    const fetchMock = setup();
    render(<TournamentDetailPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "DELETE")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Yes, cancel" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(SLUG, { method: "DELETE" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/tournaments"));
  });

  it("going back from a confirm changes nothing", async () => {
    const fetchMock = setup();
    render(<TournamentDetailPage />);
    fireEvent.click(await screen.findByRole("button", { name: "End now" }));
    fireEvent.click(screen.getByRole("button", { name: "Go back" }));
    expect(screen.getByRole("button", { name: "End now" })).toBeInTheDocument();
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST" || init?.method === "DELETE")).toHaveLength(0);
  });

  it("saves the deadline through the page's slug and refresh callback", async () => {
    const fetchMock = setup();
    render(<TournamentDetailPage />);
    fireEvent.click((await screen.findAllByRole("button", { name: "Edit deadline" }))[0]);
    fireEvent.change(screen.getByLabelText(/Deadline/), { target: { value: "2099-01-01T12:30" } });
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(SLUG, expect.objectContaining({ method: "PUT" })));
    const put = fetchMock.mock.calls.find(([, init]) => init?.method === "PUT")!;
    expect(JSON.parse(String((put[1] as RequestInit).body)).deadlineAt).toBe(new Date("2099-01-01T12:30").toISOString());
    await waitFor(() => expect(detailFetches(fetchMock)).toHaveLength(2));
  });

  it.each([
    { reportConfirmWindowHours: 48 },
    { deadlineAt: "2099-03-01T12:00:00.000Z" },
  ])("refreshes an open timing editor when server settings change: %j", async patch => {
    const fetchMock = setup();
    render(<TournamentDetailPage />);
    fireEvent.click((await screen.findAllByRole("button", { name: "Edit deadline" }))[0]);
    fireEvent.change(screen.getByLabelText(/Deadline/), { target: { value: "2099-01-01T12:30" } });
    fireEvent.change(screen.getByLabelText(/Confirm window/), { target: { value: "12" } });
    const updated = { ...sheetTournament, ...patch };
    fetchMock.mockResolvedValueOnce(Response.json(updated));
    act(() => handlers.onMatchUpdated?.());
    await waitFor(() => expect(screen.getByLabelText(/Confirm window/)).toHaveValue(updated.reportConfirmWindowHours));
    expect(new Date((screen.getByLabelText(/Deadline/) as HTMLInputElement).value).toISOString()).toBe(new Date(updated.deadlineAt!).toISOString());
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(SLUG, expect.objectContaining({ method: "PUT" })));
    const put = fetchMock.mock.calls.find(([, init]) => init?.method === "PUT")!;
    expect(JSON.parse(String(put[1]!.body))).toEqual({
      deadlineAt: new Date(updated.deadlineAt!).toISOString(),
      reportConfirmWindowHours: updated.reportConfirmWindowHours,
    });
  });

  it.each(["completed", "cancelled"])("renders the closed sheet with no organizer tools in the %s rail", async (status) => {
    setup({ ...sheetTournament, status });
    render(<TournamentDetailPage />);
    await screen.findByRole("heading", { name: sheetTournament.name });
    const rail = screen.getByRole("complementary", { name: "Event details" });
    expect(within(rail).getByRole("region", { name: "Rules" })).toHaveTextContent("as played");
    expect(within(rail).getByRole("region", { name: "Players" })).toBeInTheDocument();
    expect(within(rail).queryByRole("heading", { name: "Ending early" })).toBeNull();
    expect(within(rail).queryByRole("region", { name: "Your deck" })).toBeNull();
  });

  it("keeps the pending lobby and the Add bot request, inside the sheet", async () => {
    const fetchMock = setup({ ...sheetTournament, status: "pending" });
    render(<TournamentDetailPage />);
    expect(await screen.findByRole("heading", { name: /Invite players/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "All tournaments" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Standings" })).toBeNull();
    fireEvent.click(await screen.findByRole("button", { name: /Add bot/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(`${SLUG}/join-bot`, { method: "POST" }));
  });

  it("keeps the sheet and an edited deadline on screen while a websocket refetch is pending", async () => {
    const fetchMock = setup();
    render(<TournamentDetailPage />);
    fireEvent.click((await screen.findAllByRole("button", { name: "Edit deadline" }))[0]);
    fireEvent.change(screen.getByLabelText(/Deadline/), { target: { value: "2099-01-01T12:30" } });
    const standings = screen.getByRole("region", { name: "Standings" });
    const update = deferred();
    fetchMock.mockImplementationOnce(() => update.promise);
    act(() => handlers.onMatchUpdated?.());
    expect(screen.getByRole("region", { name: "Standings" })).toBe(standings);
    expect(screen.getByLabelText(/Deadline/)).toHaveValue("2099-01-01T12:30");
    await act(async () => update.resolve(Response.json({ ...sheetTournament, name: "Updated event" })));
    expect(screen.getByRole("heading", { name: "Updated event" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Standings" })).toBe(standings);
    expect(screen.getByLabelText(/Deadline/)).toHaveValue("2099-01-01T12:30");
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
    const original = fetchMock.getMockImplementation()!;
    let requests = 0;
    fetchMock.mockImplementation((url, init) => String(url) === SLUG && !init?.method
      ? (++requests === 1 ? old.promise : latest.promise)
      : original(url, init));
    act(() => { handlers.onMatchUpdated?.(); handlers.onMatchUpdated?.(); });
    await act(async () => latest.resolve(Response.json({ ...sheetTournament, name: "Latest" })));
    await act(async () => old.resolve(Response.json({ ...sheetTournament, name: "Older" }, { status })));
    expect(screen.getByRole("heading", { name: "Latest" })).toBeInTheDocument();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("shows an initial-load error when no last update exists", async () => {
    const fetchMock = setup();
    fetchMock.mockImplementation(async (url) => String(url) === SLUG ? Response.json({}, { status: 500 }) : Response.json({}));
    render(<TournamentDetailPage />);
    expect(await screen.findByText("Failed to load tournament")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Matches" })).toBeNull();
  });

  it("refreshes ratings on match updates and status changes, keeping participant refreshes cheap", async () => {
    const fetchMock = setup();
    render(<TournamentDetailPage />);
    await screen.findByRole("region", { name: "Matches" });
    const ratingsCalls = () => fetchMock.mock.calls.filter(([url]) => String(url) === "/api/leaderboard?scope=all");
    expect(ratingsCalls()).toHaveLength(1);
    act(() => handlers.onParticipantJoined?.({ playerId: 99, displayName: "New player" }));
    await act(async () => {});
    expect(ratingsCalls()).toHaveLength(1);
    act(() => handlers.onMatchUpdated?.());
    await act(async () => {});
    expect(ratingsCalls()).toHaveLength(2);
    fetchMock.mockResolvedValueOnce(Response.json({ ...sheetTournament, status: "completed" }));
    act(() => handlers.onCompleted?.());
    await screen.findAllByText("Ended early"); // the fixture has unplayed matches
    await waitFor(() => expect(ratingsCalls()).toHaveLength(3));
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
    await waitFor(() => expect(detailFetches(fetchMock)).toHaveLength(2));
  });

  it("keeps a ratings failure separate from a tournament refresh failure", async () => {
    const fetchMock = setup();
    fetchMock.mockImplementation(async (url) => {
      if (String(url) === "/api/auth/session") return Response.json({ user: { id: "host" } });
      if (String(url) === SLUG) return Response.json(sheetTournament);
      if (String(url) === "/api/leaderboard?scope=all") return Response.json({}, { status: 500 });
      return Response.json({});
    });
    render(<TournamentDetailPage />);
    expect(await screen.findByRole("region", { name: "Decks" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Standings" })).toBeInTheDocument();
    expect(screen.queryByRole("status")).toBeNull();
  });
});

describe("old ?tab= links", () => {
  const scrolls: Array<{ id: string; options: unknown }> = [];
  beforeEach(() => {
    scrolls.length = 0;
    Element.prototype.scrollIntoView = function scroll(this: Element, options?: unknown) { scrolls.push({ id: this.id, options }); };
  });

  it.each([["standings", "standings"], ["my", "matches"], ["my-matches", "matches"], ["all", "matches"], ["all-matches", "matches"], ["players", "players"]])("?tab=%s scrolls to #%s smoothly", async (tab, id) => {
    searchParams = new URLSearchParams({ tab });
    setup(sheetTournament, "spectator");
    render(<TournamentDetailPage />);
    await screen.findByRole("region", { name: "Matches" });
    await waitFor(() => expect(scrolls).toHaveLength(1));
    expect(scrolls[0]).toEqual({ id, options: { behavior: "smooth", block: "start" } });
  });

  it("scrolls instantly under reduced motion", async () => {
    searchParams = new URLSearchParams({ tab: "standings" });
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true })));
    setup();
    render(<TournamentDetailPage />);
    await waitFor(() => expect(scrolls).toHaveLength(1));
    expect(scrolls[0].options).toEqual({ behavior: "instant", block: "start" });
  });

  it.each(["overview", "nonsense", ""])("?tab=%s stays at the top", async (tab) => {
    searchParams = new URLSearchParams(tab ? { tab } : {});
    setup();
    render(<TournamentDetailPage />);
    await screen.findByRole("region", { name: "Matches" });
    expect(scrolls).toHaveLength(0);
  });

  it("scrolls once, not again after a refetch", async () => {
    searchParams = new URLSearchParams({ tab: "standings" });
    setup();
    render(<TournamentDetailPage />);
    await waitFor(() => expect(scrolls).toHaveLength(1));
    act(() => handlers.onMatchUpdated?.());
    await act(async () => {});
    expect(scrolls).toHaveLength(1);
  });
});
