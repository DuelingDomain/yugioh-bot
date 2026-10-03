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
let routeSlug = "friday-night-12";
vi.mock("next/navigation", () => ({
  useParams: () => ({ slug: routeSlug }), useRouter: () => ({ push, replace: vi.fn() }), useSearchParams: () => searchParams,
}));
vi.mock("@/lib/hooks/use-tournament-websocket", () => ({
  useTournamentWebsocket: (_slug: string, options: typeof handlers) => { handlers = options; },
}));

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
const ready = () => screen.findByRole("region", { name: "Standings" });
const openHostTools = async () => {
  fireEvent.click(await screen.findByRole("button", { name: "Host tools" }));
  return screen.findByRole("dialog", { name: "Host tools" });
};
const detailFetches = (fetchMock: ReturnType<typeof setup>) => fetchMock.mock.calls.filter(([url, init]) => String(url) === SLUG && !init?.method);
function deferred() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((done) => { resolve = done; });
  return { promise, resolve };
}
beforeEach(() => { vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false }))); });
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); searchParams = new URLSearchParams(); routeSlug = "friday-night-12"; });

describe("TournamentDetailPage one sheet", () => {
  it("shows the bar, your match, the tables, the standings and the rail together", async () => {
    setup(threeMatchTournament);
    render(<TournamentDetailPage />);
    expect(await screen.findByRole("heading", { name: "Friday Night Duels #12" })).toBeInTheDocument();
    expect(screen.getByText("Round robin, best of 3.")).toBeInTheDocument();
    expect(document.querySelector("header")?.textContent).toMatch(/Round\d+of \d+/);
    for (const name of ["Your match", "Tables", "Standings", "Event details"]) expect(screen.getByLabelText(name)).toBeInTheDocument();
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.getByRole("link", { name: "All tournaments" })).toHaveAttribute("href", "/tournaments");
    expect(screen.getByTestId("tournament-page-shell")).toHaveAttribute("data-motion");
  });

  it("derives elimination progress from participants", async () => {
    setup({ ...threeMatchTournament, format: "single_elim" });
    render(<TournamentDetailPage />);
    await screen.findByRole("heading", { name: "Friday Night Duels #12" });
    expect(document.querySelector("header")?.textContent).toContain("Round2of 3");
  });

  it("shows the host the deck states and the You pill in the host tools", async () => {
    setup();
    render(<TournamentDetailPage />);
    await ready();
    const tools = await openHostTools();
    const decks = within(tools).getByRole("region", { name: "Decks" });
    expect(within(decks).getAllByText("Deck in")).toHaveLength(5);
    expect(within(decks).getByText("No deck yet")).toBeInTheDocument();
    expect(within(decks).getByText("You")).toBeInTheDocument();
    for (const player of sheetTournament.participants) expect(within(decks).getByRole("link", { name: player.displayName })).toHaveAttribute("href", `/player/${player.playerId}`);
    expect(within(tools).getByText("End the tournament early")).toBeInTheDocument();
  });

  it("gives another viewer no host tools and no deck state", async () => {
    setup({ ...sheetTournament, createdByUserId: "somebody-else" }, "spectator");
    render(<TournamentDetailPage />);
    await ready();
    expect(screen.queryByRole("button", { name: "Host tools" })).toBeNull();
    expect(screen.queryByText("End the tournament early")).toBeNull();
    expect(screen.queryByTestId("player-deck-marker-3")).toBeNull();
  });

  it("keeps Tab inside the host tools dialog", async () => {
    setup();
    render(<TournamentDetailPage />);
    await ready();
    const tools = await openHostTools();
    expect(tools).toHaveAttribute("aria-modal", "true");
    const close = within(tools).getByRole("button", { name: "Close host tools" });
    expect(close).toHaveFocus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(tools.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).not.toBe(close);
  });

  it("closes the host tools with Escape", async () => {
    setup();
    render(<TournamentDetailPage />);
    await ready();
    await openHostTools();
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Host tools" })).toBeNull());
  });

  it("ends the event only after confirmation and refreshes the same sheet", async () => {
    const fetchMock = setup();
    render(<TournamentDetailPage />);
    await ready();
    const tools = await openHostTools();
    fireEvent.click(within(tools).getByRole("button", { name: "End now" }));
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Yes, end now" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(`${SLUG}/complete`, { method: "POST" }));
    await waitFor(() => expect(detailFetches(fetchMock)).toHaveLength(2));
    expect(screen.getByRole("region", { name: "Standings" })).toBeInTheDocument();
  });

  it("cancels only after confirmation, then returns to the tournament list", async () => {
    const fetchMock = setup();
    render(<TournamentDetailPage />);
    await ready();
    const tools = await openHostTools();
    fireEvent.click(within(tools).getByRole("button", { name: "Cancel the tournament" }));
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "DELETE")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Yes, cancel" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(SLUG, { method: "DELETE" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/tournaments"));
  });

  it("going back from a confirm changes nothing", async () => {
    const fetchMock = setup();
    render(<TournamentDetailPage />);
    await ready();
    const tools = await openHostTools();
    fireEvent.click(within(tools).getByRole("button", { name: "End now" }));
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
    act(() => handlers.onInvalidate?.());
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

  it("lets the host reopen a result after a round robin completes, without the ending controls", async () => {
    setup({ ...sheetTournament, status: "completed" });
    render(<TournamentDetailPage />);
    const tools = await openHostTools();
    expect(within(tools).getAllByRole("button", { name: /Reopen/ }).length).toBeGreaterThan(0);
    expect(within(tools).queryByText("End the tournament early")).toBeNull();
    expect(within(tools).queryByRole("region", { name: "Ending early" })).toBeNull();
  });

  it("gives a finished single elimination no host tools, and a viewer none after a round robin completes", async () => {
    setup({ ...sheetTournament, status: "completed", format: "single_elim" });
    const first = render(<TournamentDetailPage />);
    await screen.findByRole("heading", { name: sheetTournament.name });
    expect(screen.queryByRole("button", { name: "Host tools" })).toBeNull();
    first.unmount();
    setup({ ...sheetTournament, status: "completed", createdByUserId: "somebody-else" }, "spectator");
    render(<TournamentDetailPage />);
    await screen.findByRole("heading", { name: sheetTournament.name });
    expect(screen.queryByRole("button", { name: "Host tools" })).toBeNull();
  });

  it.each(["cancelled"])("renders the closed sheet with no organizer tools in the %s rail", async (status) => {
    setup({ ...sheetTournament, status });
    render(<TournamentDetailPage />);
    await screen.findByRole("heading", { name: sheetTournament.name });
    const rail = screen.getByRole("complementary", { name: "Event details" });
    expect(within(rail).getByRole("region", { name: "Rules" })).toBeInTheDocument();
    expect(within(rail).getByRole("region", { name: "Results" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Host tools" })).toBeNull();
    expect(within(rail).queryByRole("region", { name: "Your deck" })).toBeNull();
  });

  it("keeps the pending lobby and the Add bot request, inside the sheet", async () => {
    const fetchMock = setup({ ...sheetTournament, status: "pending" });
    render(<TournamentDetailPage />);
    expect(await screen.findByRole("heading", { name: /Invite players/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "All tournaments" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Standings" })).toBeNull();
    fireEvent.click(await screen.findByRole("button", { name: /Add a bot/i }));
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
    act(() => handlers.onInvalidate?.());
    expect(screen.getByRole("region", { name: "Standings" })).toBe(standings);
    expect(screen.getByLabelText(/Deadline/)).toHaveValue("2099-01-01T12:30");
    await act(async () => update.resolve(Response.json({ ...sheetTournament, name: "Updated event" })));
    expect(screen.getByRole("heading", { name: "Updated event" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Standings" })).toBe(standings);
    expect(screen.getByLabelText(/Deadline/)).toHaveValue("2099-01-01T12:30");
  });

  it.each([404, 500])("keeps old data after a refresh fails with status %s and clears the quiet status on recovery", async (status) => {
    const fetchMock = setup();
    render(<TournamentDetailPage />);
    await ready();
    fetchMock.mockResolvedValueOnce(Response.json({}, { status }));
    act(() => handlers.onInvalidate?.());
    expect(await screen.findByRole("status")).toHaveTextContent("Couldn't refresh. Showing the last update.");
    expect(screen.getByRole("heading", { name: sheetTournament.name })).toBeInTheDocument();
    act(() => handlers.onInvalidate?.());
    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
  });

  it.each([200, 404, 500])("ignores an out-of-order tournament response with status %s", async (status) => {
    const fetchMock = setup();
    render(<TournamentDetailPage />);
    await ready();
    const old = deferred(), latest = deferred();
    const original = fetchMock.getMockImplementation()!;
    let requests = 0;
    fetchMock.mockImplementation((url, init) => String(url) === SLUG && !init?.method
      ? (++requests === 1 ? old.promise : latest.promise)
      : original(url, init));
    act(() => { handlers.onInvalidate?.(); handlers.onInvalidate?.(); });
    await act(async () => latest.resolve(Response.json({ ...sheetTournament, name: "Latest" })));
    await act(async () => old.resolve(Response.json({ ...sheetTournament, name: "Older" }, { status })));
    expect(screen.getByRole("heading", { name: "Latest" })).toBeInTheDocument();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("shows the missing tournament address and recovery links after an initial 404", async () => {
    routeSlug = "no-such-event";
    const fetchMock = setup();
    const original = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation((url, init) => String(url) === "/api/tournaments/no-such-event"
      ? Promise.resolve(Response.json({}, { status: 404 }))
      : original(url, init));
    render(<TournamentDetailPage />);
    const title = await screen.findByRole("heading", { name: "No tournament at this address" });
    expect(title.closest(".ms")).not.toBeNull();
    expect(screen.getByText("404")).toBeInTheDocument();
    const address = screen.getByText("/tournament/no-such-event");
    expect(address.tagName).toBe("CODE");
    expect(address.parentElement).toHaveTextContent("Nothing on this server matches /tournament/no-such-event. It may have been deleted, or the link has a typo.");
    expect(screen.getByRole("link", { name: "All tournaments" })).toHaveAttribute("href", "/tournaments");
    expect(screen.getByRole("link", { name: "Dashboard" })).toHaveAttribute("href", "/dashboard");
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Standings" })).toBeNull();
  });

  it("retries an initial 500 once while busy and renders the tournament on success", async () => {
    const fetchMock = setup();
    const original = fetchMock.getMockImplementation()!;
    const retry = deferred();
    let requests = 0;
    fetchMock.mockImplementation((url, init) => String(url) === SLUG && !init?.method
      ? (++requests === 1 ? Promise.resolve(Response.json({}, { status: 500 })) : retry.promise)
      : original(url, init));
    render(<TournamentDetailPage />);
    const title = await screen.findByRole("heading", { name: "This tournament didn't load" });
    expect(title.closest(".ms")).not.toBeNull();
    expect(screen.getByText("Error", { exact: true })).toBeInTheDocument();
    expect(screen.getByText("Nothing was changed. Try again, and if it keeps happening, tell whoever runs the bot.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Dashboard" })).toHaveAttribute("href", "/dashboard");
    const button = screen.getByRole("button", { name: "Try again" });
    expect(button).toBeEnabled();
    act(() => { fireEvent.click(button); fireEvent.click(button); });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    fireEvent.click(button);
    expect(detailFetches(fetchMock)).toHaveLength(2);
    await act(async () => retry.resolve(Response.json(sheetTournament)));
    expect(await screen.findByRole("heading", { name: sheetTournament.name })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "This tournament didn't load" })).toBeNull();
    expect(screen.getByRole("region", { name: "Standings" })).toBeInTheDocument();
  });

  it("shows the retry state for an initial network failure", async () => {
    const fetchMock = setup();
    const original = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation((url, init) => String(url) === SLUG && !init?.method
      ? Promise.reject(new TypeError("Failed to fetch"))
      : original(url, init));
    render(<TournamentDetailPage />);
    expect(await screen.findByRole("heading", { name: "This tournament didn't load" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeEnabled();
    expect(screen.queryByRole("heading", { name: "No tournament at this address" })).toBeNull();
  });

  it("lets the viewer try again after a retry also fails", async () => {
    const fetchMock = setup();
    const original = fetchMock.getMockImplementation()!;
    const retry = deferred();
    let requests = 0;
    fetchMock.mockImplementation((url, init) => String(url) === SLUG && !init?.method
      ? (++requests === 1 ? Promise.resolve(Response.json({}, { status: 500 })) : retry.promise)
      : original(url, init));
    render(<TournamentDetailPage />);
    const button = await screen.findByRole("button", { name: "Try again" });
    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-busy", "true");
    await act(async () => retry.resolve(Response.json({}, { status: 500 })));
    expect(button).toBeEnabled();
    expect(button).toHaveAttribute("aria-busy", "false");
    fetchMock.mockResolvedValueOnce(Response.json(sheetTournament));
    fireEvent.click(button);
    expect(await screen.findByRole("heading", { name: sheetTournament.name })).toBeInTheDocument();
  });

  it("announces the initial loading state inside the Match Sheet", async () => {
    const fetchMock = setup();
    const original = fetchMock.getMockImplementation()!;
    const loading = deferred();
    fetchMock.mockImplementation((url, init) => String(url) === SLUG && !init?.method ? loading.promise : original(url, init));
    render(<TournamentDetailPage />);
    const status = screen.getByRole("status", { name: "Loading tournament" });
    expect(status).toHaveTextContent("Loading tournament");
    expect(status.closest(".ms")).not.toBeNull();
    await act(async () => loading.resolve(Response.json(sheetTournament)));
    expect(await screen.findByRole("heading", { name: sheetTournament.name })).toBeInTheDocument();
    expect(screen.queryByRole("status", { name: "Loading tournament" })).toBeNull();
  });

  it("refreshes ratings on match updates and status changes, not on every refetch", async () => {
    const fetchMock = setup();
    render(<TournamentDetailPage />);
    await ready();
    const ratingsCalls = () => fetchMock.mock.calls.filter(([url]) => String(url) === "/api/leaderboard?scope=all");
    expect(ratingsCalls()).toHaveLength(1);
    act(() => handlers.onInvalidate?.());
    await act(async () => {});
    expect(ratingsCalls()).toHaveLength(1);
    act(() => handlers.onMatchUpdated?.());
    await act(async () => {});
    expect(ratingsCalls()).toHaveLength(2);
    fetchMock.mockResolvedValueOnce(Response.json({ ...sheetTournament, status: "completed" }));
    act(() => handlers.onInvalidate?.());
    await screen.findAllByText(/Ended early/); // the fixture has unplayed matches
    await waitFor(() => expect(ratingsCalls()).toHaveLength(3));
  });

  it("refetches the tournament on every invalidation, and a match update refetches ratings only", async () => {
    const fetchMock = setup();
    render(<TournamentDetailPage />);
    await ready();
    act(() => handlers.onInvalidate?.());
    await waitFor(() => expect(detailFetches(fetchMock)).toHaveLength(2));
    act(() => handlers.onMatchUpdated?.());
    await act(async () => {});
    expect(detailFetches(fetchMock)).toHaveLength(2);
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
    expect(await screen.findByRole("region", { name: "Standings" })).toBeInTheDocument();
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
    await ready();
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
    await ready();
    expect(scrolls).toHaveLength(0);
  });

  it("scrolls once, not again after a refetch", async () => {
    searchParams = new URLSearchParams({ tab: "standings" });
    setup();
    render(<TournamentDetailPage />);
    await waitFor(() => expect(scrolls).toHaveLength(1));
    act(() => handlers.onInvalidate?.());
    await act(async () => {});
    expect(scrolls).toHaveLength(1);
  });
});
