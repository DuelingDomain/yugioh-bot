// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { SWRConfig } from "swr";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultDuelSettings } from "@yugidraft/shared/duels";
import type { DuelListItem } from "@yugidraft/shared/duels";
import { EMPTY_HISTORY_FILTERS, toLocalInput } from "../../src/components/duel/history-filters";
import { makeSeriesRoom } from "../helpers/duel-series";

vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

import { DuelLobby } from "../../src/components/duel/lobby";

function entry(slug: string, extra: Partial<DuelListItem> = {}): DuelListItem {
  const session = makeSeriesRoom({ slug, series: null, mySeat: null }).session;
  return {
    ...session, name: `Duel ${slug}`, settings: defaultDuelSettings("normal"), seriesId: null, status: "completed",
    format: "1v1", createdAt: "2026-10-10T21:00:00.000Z", startedAt: null, endedAt: "2026-10-10T21:42:00.000Z",
    durationMs: null, turnCount: null, engine: null, private: false, mySeat: null, lastActivityAt: "",
    series: null,
    seats: session.seats.map((seat) => ({ ...seat, team: null, result: null })),
    ...extra,
  } as DuelListItem;
}

const fetchMock = vi.fn();
function respond(page: { duels: DuelListItem[]; nextCursor?: string | null; canSeeAll?: boolean }) {
  fetchMock.mockImplementationOnce(async () => Response.json({ nextCursor: null, canSeeAll: true, ...page }));
}
function urls(): URL[] {
  return fetchMock.mock.calls.map((call) => new URL(String(call[0]), "http://localhost"));
}

function renderHistory(props: Partial<React.ComponentProps<typeof DuelLobby>> = {}) {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <DuelLobby initialView="history" {...props} />
    </SWRConfig>,
  );
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  window.history.replaceState(null, "", "/duels?view=history");
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

// Dates and "Yesterday" depend on the time zone and the clock: pin both.
const originalTz = process.env.TZ;
beforeAll(() => { process.env.TZ = "America/New_York"; });
afterAll(() => { if (originalTz === undefined) delete process.env.TZ; else process.env.TZ = originalTz; });

describe("Match history rows", () => {
  it("shows date and time, a Private chip and the admin hint", async () => {
    respond({ duels: [entry("a", { private: true }), entry("b", { private: false })], canSeeAll: true });
    renderHistory({ initialScope: "all" });
    const rows = await screen.findAllByRole("listitem");
    const first = rows.find((row) => within(row).queryByText("Duel a"))!;
    const second = rows.find((row) => within(row).queryByText("Duel b"))!;
    expect(within(first).getByText("Private")).toBeInTheDocument();
    expect(within(second).queryByText("Private")).toBeNull();
    const time = first.querySelector("time")!;
    expect(time.getAttribute("datetime")).toBe("2026-10-10T21:42:00.000Z");
    expect(time.textContent).toMatch(/2026/);
    expect(time.textContent).toMatch(/\d{1,2}:\d{2}/);
    expect(within(first).getByRole("link", { name: "Replay" })).toHaveAttribute("href", "/duels/a/replay");
    expect(within(first).getByRole("link", { name: "Final board" })).toHaveAttribute("href", "/duels/a");
    expect(screen.getByText("Admin: all duels, private included")).toBeInTheDocument();
  });

  it("hides the admin hint when the server does not allow seeing all", async () => {
    respond({ duels: [entry("a")], canSeeAll: false });
    renderHistory({ initialScope: "all" });
    await screen.findByText("Duel a");
    expect(screen.queryByText(/Admin: all duels/)).toBeNull();
  });

  it("shows the end time once and no duration for an older duel without a start time", async () => {
    respond({ duels: [entry("old", { durationMs: null, startedAt: null })] });
    renderHistory();
    const row = (await screen.findByText("Duel old")).closest("li")!;
    expect(row.querySelectorAll("time")).toHaveLength(1);
    expect(within(row).queryByText(/^Ended /)).toBeNull();
    expect(within(row).queryByText(/ to /)).toBeNull();
    expect(within(row).queryByText(/\d+m \d+s|\d+h \d+m|^\d+s$/)).toBeNull();
  });

  it("shows interrupted duels without a seat result and says it once", async () => {
    respond({ duels: [entry("cut", { status: "interrupted", winnerSeat: null })] });
    renderHistory();
    const row = (await screen.findByText("Duel cut")).closest("li")!;
    expect(within(row).getAllByText("Interrupted")).toHaveLength(1);
    const players = within(within(row).getByRole("list", { name: "Players" })).getAllByRole("listitem").map((item) => item.textContent);
    expect(players).toEqual(["Seat 1 Sulman", "Seat 2 Imran"]);
  });

  it("shows start to end time, length, turns, engine, players and a copyable id", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    respond({
      duels: [entry("tag-1", {
        format: "tag", winnerSeat: 0, startedAt: "2026-10-10T21:00:00.000Z", durationMs: 2_520_000, turnCount: 14, engine: "multi",
        seats: [
          { seat: 0, playerId: 1, displayName: "Sulman", ready: true, isBot: false, team: 0, result: "win" },
          { seat: 1, playerId: 2, displayName: "Imran", ready: true, isBot: false, team: 1, result: "loss" },
          { seat: 2, playerId: 3, displayName: "Ali", ready: true, isBot: false, team: 0, result: "win" },
          { seat: 3, playerId: null, displayName: "Practice bot", ready: true, isBot: true, team: 1, result: "loss" },
        ],
      })],
      canSeeAll: true,
    });
    renderHistory();
    const row = (await screen.findByText("Duel tag-1")).closest("li")!;
    expect(within(row).getByText("42m 0s")).toBeInTheDocument();
    expect(within(row).getByText("14 turns")).toBeInTheDocument();
    expect(within(row).getByText("multi engine")).toBeInTheDocument();
    expect(within(row).getByText("Finished")).toBeInTheDocument();
    const players = within(within(row).getByRole("list", { name: "Players" })).getAllByRole("listitem").map((item) => item.textContent);
    expect(players).toEqual([
      "Team 1 1A Sulman · Won",
      "Team 2 2A Imran · Lost",
      "Team 1 1B Ali · Won",
      "Team 2 2B Practice bot (bot) · Lost",
    ]);
    fireEvent.click(within(row).getByRole("button", { name: "Copy duel id tag-1" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("tag-1"));
    // Shown in the button and announced in a live region.
    expect((await within(row).findAllByText("Copied")).length).toBeGreaterThanOrEqual(1);
    expect(within(row).getByRole("status")).toHaveTextContent("Copied");
  });

  it("says so when the id cannot be copied", async () => {
    Object.defineProperty(navigator, "clipboard", { value: { writeText: vi.fn(async () => { throw new Error("blocked"); }) }, configurable: true });
    respond({ duels: [entry("a")] });
    renderHistory();
    const row = (await screen.findByText("Duel a")).closest("li")!;
    fireEvent.click(within(row).getByRole("button", { name: "Copy duel id a" }));
    await waitFor(() => expect(within(row).getByRole("status")).toHaveTextContent("Copy failed"));
    expect(within(row).getByRole("button", { name: /Copy failed/ })).toBeInTheDocument();
  });
});

describe("Match history result text", () => {
  const four = (results: ("win" | "loss" | "draw" | null)[], teams = true) => [0, 1, 2, 3].map((seat) => ({
    seat, playerId: seat + 1, displayName: ["Sulman", "Imran", "Ali", "Omar"][seat], ready: true, isBot: false,
    team: teams ? seat % 2 : null, result: results[seat],
  }));

  it("shows no result text for a cancelled duel", async () => {
    respond({ duels: [entry("gone", { status: "cancelled", winnerSeat: null })] });
    renderHistory();
    const row = (await screen.findByText("Duel gone")).closest("li")!;
    expect(within(row).getAllByText("Cancelled")).toHaveLength(1);
    expect(within(row).queryByText("Draw")).toBeNull();
  });

  it("shows a dash, not Draw, for a finished duel with no known result", async () => {
    respond({ duels: [entry("blank", { winnerSeat: null })] });
    renderHistory();
    const row = (await screen.findByText("Duel blank")).closest("li")!;
    expect(within(row).queryByText("Draw")).toBeNull();
    expect(within(row).getByText("No result")).toBeInTheDocument();
    expect(within(row).getByText("—")).toBeInTheDocument();
  });

  it("shows Draw only when a seat result says so", async () => {
    const seats = entry("d").seats.map((seat) => ({ ...seat, result: "draw" as const }));
    respond({ duels: [entry("d", { winnerSeat: null, seats })] });
    renderHistory();
    const row = (await screen.findByText("Duel d")).closest("li")!;
    expect(within(row).getByText("Draw", { selector: "span" })).toBeInTheDocument();
  });

  it("names the whole winning team in a Tag duel", async () => {
    respond({ duels: [entry("tag", { format: "tag", winnerSeat: 0, seats: four(["win", "loss", "win", "loss"]) })] });
    renderHistory();
    const row = (await screen.findByText("Duel tag")).closest("li")!;
    expect(within(row).getByText("Team 1 won")).toBeInTheDocument();
  });

  it("shows Won or Lost from my own seat result", async () => {
    const seats = entry("m").seats.map((seat, index) => ({ ...seat, result: index === 0 ? "loss" as const : "win" as const }));
    respond({ duels: [entry("m", { mySeat: 0, winnerSeat: 1, seats })] });
    renderHistory();
    const row = (await screen.findByText("Duel m")).closest("li")!;
    expect(within(row).getByText("Lost")).toBeInTheDocument();
  });
});

describe("Match history filters", () => {
  it("sends the scope, format, status and debounced text filters", async () => {
    respond({ duels: [entry("a")] });
    renderHistory({ initialScope: "all" });
    await screen.findByText("Duel a");
    expect(urls()[0].search).toBe("?archived=1&scope=all");
    await screen.findByLabelText("Card");

    respond({ duels: [entry("b")] });
    fireEvent.change(screen.getByLabelText("Format"), { target: { value: "ffa4" } });
    await screen.findByText("Duel b");
    respond({ duels: [entry("c")] });
    fireEvent.change(screen.getByLabelText("Status"), { target: { value: "interrupted" } });
    await screen.findByText("Duel c");

    respond({ duels: [entry("d")] });
    const before = fetchMock.mock.calls.length;
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fireEvent.change(screen.getByLabelText("Card"), { target: { value: "B" } });
    fireEvent.change(screen.getByLabelText("Card"), { target: { value: "Black Luster Soldier" } });
    fireEvent.change(screen.getByLabelText("Player or duel name"), { target: { value: "Imran" } });
    await act(async () => { await vi.advanceTimersByTimeAsync(250); });
    expect(fetchMock.mock.calls.length).toBe(before);
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    await screen.findByText("Duel d");
    const last = urls().at(-1)!;
    expect(Object.fromEntries(last.searchParams)).toEqual({
      archived: "1", scope: "all", format: "ffa4", status: "interrupted", q: "Imran", card: "Black Luster Soldier",
    });
    expect(fetchMock.mock.calls.length).toBe(before + 1);
    expect(window.location.search).toBe("?view=history&scope=all&format=ffa4&status=interrupted&q=Imran&card=Black+Luster+Soldier");
  });

  it("starts from filters read from the page URL and sends from/to as ISO instants", async () => {
    respond({ duels: [entry("a")] });
    renderHistory({ initialFilters: { ...EMPTY_HISTORY_FILTERS, from: "2026-10-10T00:00", to: "2026-10-10T23:59", q: "Imran" } });
    await screen.findByText("Duel a");
    const query = urls()[0].searchParams;
    expect(query.get("from")).toBe(new Date("2026-10-10T00:00").toISOString());
    expect(query.get("to")).toBe(new Date(new Date("2026-10-10T23:59").getTime() + 59_999).toISOString());
    expect(query.get("from")).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/);
    expect(query.get("to")).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/);
    expect(query.get("q")).toBe("Imran");
    expect(screen.getByLabelText("From")).toHaveValue("2026-10-10T00:00");
    expect(screen.getByLabelText("Player or duel name")).toHaveValue("Imran");
  });

  it("fills the date range from the quick chips", async () => {
    respond({ duels: [entry("a")] });
    renderHistory();
    await screen.findByText("Duel a");
    // Pin the clock to noon on 11 October 2026 (New York): yesterday is 10 October.
    vi.useFakeTimers({ shouldAdvanceTime: true, now: new Date(2026, 9, 11, 12, 0) });
    respond({ duels: [entry("b")] });
    fireEvent.click(screen.getByRole("button", { name: "Yesterday" }));
    await screen.findByText("Duel b");
    const query = urls().at(-1)!.searchParams;
    expect(query.get("from")).toBe("2026-10-10T04:00:00.000Z");
    expect(query.get("to")).toBe("2026-10-11T03:59:59.999Z");
    const from = new Date(query.get("from")!);
    const to = new Date(query.get("to")!);
    expect(screen.getByLabelText("From")).toHaveValue(toLocalInput(from));
    expect(screen.getByLabelText("To")).toHaveValue(toLocalInput(new Date(to.getTime() - 59_999)));
    expect(screen.getByLabelText("From")).toHaveValue("2026-10-10T00:00");
    expect(screen.getByLabelText("To")).toHaveValue("2026-10-10T23:59");
    expect(screen.getByRole("button", { name: "Yesterday" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Today" })).toHaveAttribute("aria-pressed", "false");
  });

  it("keeps the Last 7 days chip marked while the range stays", async () => {
    respond({ duels: [entry("a")] });
    renderHistory();
    await screen.findByText("Duel a");
    respond({ duels: [entry("b")] });
    fireEvent.click(screen.getByRole("button", { name: "Last 7 days" }));
    await screen.findByText("Duel b");
    expect(screen.getByRole("button", { name: "Last 7 days" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "2099-01-01T00:00" } });
    expect(screen.getByRole("button", { name: "Last 7 days" })).toHaveAttribute("aria-pressed", "false");
  });

  it("shows a message and sends no request when From is after To", async () => {
    respond({ duels: [entry("a")] });
    renderHistory({ initialFilters: { ...EMPTY_HISTORY_FILTERS, to: "2026-10-01T10:00" } });
    await screen.findByText("Duel a");
    const sent = fetchMock.mock.calls.length;
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-10-05T10:00" } });
    expect(await screen.findByRole("alert")).toHaveTextContent("From must be before To.");
    expect(screen.getByLabelText("To")).toHaveAttribute("aria-invalid", "true");
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(fetchMock.mock.calls.length).toBe(sent);
    respond({ duels: [entry("b")] });
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-09-01T10:00" } });
    await screen.findByText("Duel b");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows the empty state and clears the filters", async () => {
    respond({ duels: [] });
    renderHistory({ initialFilters: { ...EMPTY_HISTORY_FILTERS, card: "Nothing" } });
    expect(await screen.findByText("No duels match these filters.")).toBeInTheDocument();
    respond({ duels: [entry("a")] });
    expect(screen.getAllByRole("button", { name: "Clear filters" })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    await screen.findByText("Duel a");
    expect(urls().at(-1)!.search).toBe("?archived=1&scope=mine");
    expect(screen.getByLabelText("Card")).toHaveValue("");
    expect(window.location.search).toBe("?view=history");
  });

  it("hides the status and card filters for a member and drops bookmarked values", async () => {
    respond({ duels: [entry("a")], canSeeAll: false });
    renderHistory({ initialFilters: { ...EMPTY_HISTORY_FILTERS, card: "Nothing", status: "cancelled" } });
    await screen.findByText("Duel a");
    respond({ duels: [entry("a")], canSeeAll: false });
    await waitFor(() => expect(urls().at(-1)!.search).toBe("?archived=1&scope=mine"));
    expect(screen.queryByLabelText("Card")).toBeNull();
    expect(screen.queryByLabelText("Status")).toBeNull();
    expect(screen.getByLabelText("Format")).toBeInTheDocument();
    expect(window.location.search).toBe("?view=history");
  });

  it("says no finished duels when nothing is filtered", async () => {
    respond({ duels: [] });
    renderHistory();
    expect(await screen.findByText("No finished duels yet.")).toBeInTheDocument();
  });
});

describe("Match history page URL", () => {
  it("writes the URL with a null history state so Next takes it over", async () => {
    const replaceState = vi.spyOn(window.history, "replaceState");
    respond({ duels: [entry("a")] });
    renderHistory();
    await screen.findByText("Duel a");
    respond({ duels: [entry("b")] });
    fireEvent.change(screen.getByLabelText("Format"), { target: { value: "tag" } });
    await screen.findByText("Duel b");
    const calls = replaceState.mock.calls.filter((call) => String(call[2]).includes("format=tag"));
    expect(calls.length).toBeGreaterThan(0);
    for (const call of replaceState.mock.calls) expect(call[0]).toBeNull();
  });

  it("reads the first view, scope and filters from the page URL", async () => {
    window.history.replaceState(null, "", "/duels?view=history&scope=all&format=tag&status=cancelled&q=Imran&from=2026-10-10T00:00");
    respond({ duels: [entry("a")] });
    render(<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}><DuelLobby /></SWRConfig>);
    await screen.findByText("Duel a");
    const query = urls()[0].searchParams;
    expect(query.get("scope")).toBe("all");
    expect(query.get("format")).toBe("tag");
    expect(query.get("status")).toBe("cancelled");
    expect(query.get("q")).toBe("Imran");
    expect(query.get("from")).toBe("2026-10-10T04:00:00.000Z");
    expect(screen.getByLabelText("Player or duel name")).toHaveValue("Imran");
    expect(window.location.search).toBe("?view=history&scope=all&from=2026-10-10T00%3A00&format=tag&status=cancelled&q=Imran");
  });

  it("keeps other page params in both views", async () => {
    window.history.replaceState(null, "", "/duels?view=history&invite=abc");
    respond({ duels: [entry("a")] });
    render(<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}><DuelLobby /></SWRConfig>);
    await screen.findByText("Duel a");
    expect(window.location.search).toBe("?view=history&invite=abc");
    fireEvent.click(screen.getByRole("radio", { name: "Live tables" }));
    await waitFor(() => expect(window.location.search).toBe("?invite=abc"));
  });

  it("leaves an unrelated URL alone in the Live view", async () => {
    window.history.replaceState(null, "", "/duels?invite=abc");
    const replaceState = vi.spyOn(window.history, "replaceState");
    fetchMock.mockImplementation(async () => Response.json({ duels: [] }));
    render(<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}><DuelLobby /></SWRConfig>);
    await screen.findByText("No live duels right now.");
    expect(window.location.search).toBe("?invite=abc");
    expect(replaceState).not.toHaveBeenCalled();
  });

  it("remembers the history search for the replay page link", async () => {
    respond({ duels: [entry("a")] });
    renderHistory({ initialFilters: { ...EMPTY_HISTORY_FILTERS, q: "Imran" } });
    await screen.findByText("Duel a");
    expect(window.sessionStorage.getItem("duels.history-search")).toBe("?view=history&q=Imran");
  });
});

describe("Match history scope", () => {
  const segment = (name: string) => screen.getByRole("radio", { name });

  it("shows Status and the admin hint only on All, and sends status only there", async () => {
    respond({ duels: [entry("a")], canSeeAll: true });
    renderHistory({ initialFilters: { ...EMPTY_HISTORY_FILTERS, status: "cancelled" } });
    await screen.findByText("Duel a");
    // Admin on Mine: the server ignores status, so the box, the hint and the request field are gone.
    expect(screen.queryByLabelText("Status")).toBeNull();
    expect(screen.queryByText(/Admin: all duels/)).toBeNull();
    expect(urls()[0].searchParams.has("status")).toBe(false);
    expect(screen.getByLabelText("Card")).toBeInTheDocument();
    expect(window.location.search).toBe("?view=history");

    respond({ duels: [entry("b")], canSeeAll: true });
    fireEvent.click(segment("All"));
    await screen.findByText("Duel b");
    expect(screen.getByLabelText("Status")).toHaveValue("cancelled");
    expect(screen.getByText(/Admin: all duels/)).toBeInTheDocument();
    expect(urls().at(-1)!.searchParams.get("status")).toBe("cancelled");
    expect(window.location.search).toBe("?view=history&scope=all&status=cancelled");

    respond({ duels: [entry("c")], canSeeAll: true });
    fireEvent.click(segment("Mine"));
    await screen.findByText("Duel c");
    expect(urls().at(-1)!.searchParams.has("status")).toBe(false);
    expect(screen.queryByLabelText("Status")).toBeNull();
  });
});

describe("Load more", () => {
  it("appends the next page with the cursor and hides the button at the end", async () => {
    respond({ duels: [entry("a"), entry("b")], nextCursor: "cur-1" });
    renderHistory();
    await screen.findByText("Duel b");
    respond({ duels: [entry("b"), entry("c")], nextCursor: null });
    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    await screen.findByText("Duel c");
    expect(urls().at(-1)!.searchParams.get("cursor")).toBe("cur-1");
    expect(screen.getAllByText(/^Duel [abc]$/).map((node) => node.textContent)).toEqual(["Duel a", "Duel b", "Duel c"]);
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
  });

  it("keeps the loaded rows and shows the error when a page fails", async () => {
    respond({ duels: [entry("a")], nextCursor: "cur-1" });
    renderHistory();
    await screen.findByText("Duel a");
    fetchMock.mockImplementationOnce(async () => Response.json({ error: "Bad cursor" }, { status: 400 }));
    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    expect(await screen.findByText("Bad cursor")).toBeInTheDocument();
    expect(screen.getByText("Duel a")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Load more" })).toBeEnabled();
  });

  it("does not refetch the first page when the window gets focus", async () => {
    respond({ duels: [entry("a")], nextCursor: "cur-1" });
    renderHistory();
    await screen.findByText("Duel a");
    const count = fetchMock.mock.calls.length;
    // SWR ignores focus in its first 5 seconds: move the clock past that.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date(Date.now() + 10_000));
    fetchMock.mockImplementation(async () => Response.json({ duels: [entry("moved")], nextCursor: "cur-9", canSeeAll: true }));
    act(() => { window.dispatchEvent(new Event("focus")); document.dispatchEvent(new Event("visibilitychange")); });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(fetchMock.mock.calls.length).toBe(count);
    expect(screen.queryByText("Duel moved")).toBeNull();
  });

  it("keeps keyboard focus on the button while loading and announces the new rows", async () => {
    respond({ duels: [entry("a"), entry("b")], nextCursor: "cur-1" });
    renderHistory();
    await screen.findByText("Duel b");
    expect(screen.getByText(/^Showing /)).toHaveTextContent("Showing 2 duels, more available");
    const button = screen.getByRole("button", { name: "Load more" });
    button.focus();
    let release: (value: Response) => void = () => undefined;
    fetchMock.mockImplementationOnce(() => new Promise<Response>((resolve) => { release = resolve; }));
    fireEvent.click(button);
    const loading = await screen.findByRole("button", { name: "Loading…" });
    expect(loading).toHaveAttribute("aria-disabled", "true");
    expect(loading).not.toBeDisabled();
    expect(document.activeElement).toBe(loading);
    release(Response.json({ duels: [entry("c")], nextCursor: "cur-2", canSeeAll: true }));
    await screen.findByText("Duel c");
    expect(screen.getByText(/^Showing /)).toHaveTextContent("Showing 3 duels, more available");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Load more" }));
  });

  it("moves focus to the end note when the last page loads", async () => {
    respond({ duels: [entry("a")], nextCursor: "cur-1" });
    renderHistory();
    await screen.findByText("Duel a");
    screen.getByRole("button", { name: "Load more" }).focus();
    respond({ duels: [entry("b")], nextCursor: null });
    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    const note = await screen.findByText("All duels are loaded.");
    await waitFor(() => expect(document.activeElement).toBe(note));
  });

  it("drops a page that arrives after a filter change and starts again from page 1", async () => {
    respond({ duels: [entry("a")], nextCursor: "cur-1" });
    renderHistory();
    await screen.findByText("Duel a");
    let release: (value: Response) => void = () => undefined;
    fetchMock.mockImplementationOnce(() => new Promise<Response>((resolve) => { release = resolve; }));
    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    await screen.findByRole("button", { name: "Loading…" });

    respond({ duels: [entry("x")], nextCursor: "cur-x" });
    fireEvent.change(screen.getByLabelText("Format"), { target: { value: "tag" } });
    await screen.findByText("Duel x");
    release(Response.json({ duels: [entry("late")], nextCursor: null, canSeeAll: true }));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByText("Duel late")).toBeNull();
    expect(screen.queryByText("Duel a")).toBeNull();
    expect(screen.getByRole("button", { name: "Load more" })).toBeInTheDocument();
    expect(urls().at(-2)!.searchParams.get("cursor")).toBe("cur-1");
  });
});
