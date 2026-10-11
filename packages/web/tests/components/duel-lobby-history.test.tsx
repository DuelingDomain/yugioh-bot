// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { SWRConfig } from "swr";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultDuelSettings } from "@yugidraft/shared/duels";
import type { DuelListEntry } from "../../src/components/duel/api";
import { EMPTY_HISTORY_FILTERS, toLocalInput } from "../../src/components/duel/history-filters";
import { makeSeriesRoom } from "../helpers/duel-series";

vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));

import { DuelLobby } from "../../src/components/duel/lobby";

function entry(slug: string, extra: Partial<DuelListEntry> = {}): DuelListEntry {
  const session = makeSeriesRoom({ slug, series: null, mySeat: null }).session;
  return {
    ...session, name: `Duel ${slug}`, settings: defaultDuelSettings("normal"), seriesId: null, status: "completed",
    format: "1v1", createdAt: "2026-10-10 21:00:00", endedAt: "2026-10-10 21:42:00", mySeat: null, lastActivityAt: "",
    series: null, ...extra,
  } as DuelListEntry;
}

const fetchMock = vi.fn();
function respond(page: { duels: DuelListEntry[]; nextCursor?: string | null; canSeeAll?: boolean }) {
  fetchMock.mockImplementationOnce(async () => Response.json({ nextCursor: null, canSeeAll: false, ...page }));
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
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("Match history rows", () => {
  it("shows date and time, a Private chip and the admin hint", async () => {
    respond({ duels: [entry("a", { private: true }), entry("b", { private: false })], canSeeAll: true });
    renderHistory();
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
    renderHistory();
    await screen.findByText("Duel a");
    expect(screen.queryByText(/Admin: all duels/)).toBeNull();
  });

  it("shows start to end time, length, turns, engine, players and a copyable id", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    respond({
      duels: [entry("tag-1", {
        format: "tag", winnerSeat: 0, startedAt: "2026-10-10T21:00:00Z", durationMs: 2_520_000, turnCount: 14, engine: "multi",
        seats: [
          { seat: 0, playerId: 1, displayName: "Sulman", ready: true, isBot: false },
          { seat: 1, playerId: 2, displayName: "Imran", ready: true, isBot: false },
          { seat: 2, playerId: 3, displayName: "Ali", ready: true, isBot: false, result: "Won" },
          { seat: 3, playerId: null, displayName: "Practice bot", ready: true, isBot: true },
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
    expect(await within(row).findByText("Copied")).toBeInTheDocument();
  });
});

describe("Match history filters", () => {
  it("sends the scope, format, status and debounced text filters", async () => {
    respond({ duels: [entry("a")] });
    renderHistory({ initialScope: "all" });
    await screen.findByText("Duel a");
    expect(urls()[0].search).toBe("?archived=1&scope=all");

    respond({ duels: [entry("b")] });
    fireEvent.change(screen.getByLabelText("Format"), { target: { value: "ffa4" } });
    await screen.findByText("Duel b");
    respond({ duels: [entry("c")] });
    fireEvent.change(screen.getByLabelText("Status"), { target: { value: "interrupted" } });
    await screen.findByText("Duel c");

    respond({ duels: [entry("d")] });
    const before = fetchMock.mock.calls.length;
    fireEvent.change(screen.getByLabelText("Card"), { target: { value: "B" } });
    fireEvent.change(screen.getByLabelText("Card"), { target: { value: "Black Luster Soldier" } });
    fireEvent.change(screen.getByLabelText("Player or duel name"), { target: { value: "Imran" } });
    expect(fetchMock.mock.calls.length).toBe(before);
    await screen.findByText("Duel d", {}, { timeout: 2000 });
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
    expect(query.get("q")).toBe("Imran");
    expect(screen.getByLabelText("From")).toHaveValue("2026-10-10T00:00");
    expect(screen.getByLabelText("Player or duel name")).toHaveValue("Imran");
  });

  it("fills the date range from the quick chips", async () => {
    respond({ duels: [entry("a")] });
    renderHistory();
    await screen.findByText("Duel a");
    respond({ duels: [entry("b")] });
    fireEvent.click(screen.getByRole("button", { name: "Yesterday" }));
    await screen.findByText("Duel b");
    const query = urls().at(-1)!.searchParams;
    const from = new Date(query.get("from")!);
    const to = new Date(query.get("to")!);
    expect(from.getHours()).toBe(0);
    expect(from.getMinutes()).toBe(0);
    expect(to.getHours()).toBe(23);
    expect(to.getMinutes()).toBe(59);
    expect(to.getDate()).toBe(from.getDate());
    expect(screen.getByLabelText("From")).toHaveValue(toLocalInput(from));
    expect(screen.getByLabelText("To")).toHaveValue(toLocalInput(to));
  });

  it("shows the empty state and clears the filters", async () => {
    respond({ duels: [] });
    renderHistory({ initialFilters: { ...EMPTY_HISTORY_FILTERS, card: "Nothing" } });
    expect(await screen.findByText("No duels match these filters.")).toBeInTheDocument();
    respond({ duels: [entry("a")] });
    fireEvent.click(screen.getAllByRole("button", { name: "Clear filters" })[0]);
    await screen.findByText("Duel a");
    expect(urls().at(-1)!.search).toBe("?archived=1&scope=mine");
    expect(screen.getByLabelText("Card")).toHaveValue("");
    expect(window.location.search).toBe("?view=history");
  });

  it("says no finished duels when nothing is filtered", async () => {
    respond({ duels: [] });
    renderHistory();
    expect(await screen.findByText("No finished duels yet.")).toBeInTheDocument();
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
});
