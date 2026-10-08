// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SheetRoot } from "@/components/sheet";
import { DraftsList } from "@/components/draft/list/drafts-list";
import { draftFromApi, parseDraftConfig, type DraftApiItem, type DraftListItem } from "@/components/draft/list/drafts-list-model";
import { TournamentsList } from "@/components/tournament/tournaments-list";
import { tournamentFromApi, type TournamentListItem } from "@/components/tournament/tournaments-list-model";

const fetchMock = vi.fn();
beforeEach(() => vi.stubGlobal("fetch", fetchMock));
afterEach(() => {
  cleanup();
  fetchMock.mockReset();
  vi.unstubAllGlobals();
});

const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));
function deferred() {
  let resolve!: (res: Response) => void;
  const promise = new Promise<Response>((r) => { resolve = r; });
  return { promise, resolve };
}

const draft = (id: number, over: Partial<DraftListItem> = {}): DraftListItem => ({
  id, name: `Draft ${id}`, status: "completed", webSlug: `d${id}`, playerCount: 4, wave: 3, pick: 1,
  createdAt: "2026-09-01 10:00:00", endedAt: "2026-09-02 10:00:00", config: parseDraftConfig("{}"), ...over,
});
const apiDraft = (id: number, over: Partial<DraftApiItem> = {}): DraftApiItem => ({
  id, name: `Draft ${id}`, status: "completed", mode: "booster", webSlug: `d${id}`, currentPackRound: 3, currentPickStep: 1,
  playerCount: 4, createdAt: "2026-08-01T10:00:00Z", endedAt: "2026-08-02T10:00:00Z", ...over,
});
const tournament = (id: number, over: Partial<TournamentListItem> = {}): TournamentListItem => ({
  id, name: `Cup ${id}`, format: "single_elim", status: "completed", participantCount: 8, webSlug: `cup-${id}`, ...over,
});

const loadMore = () => screen.getByRole("button", { name: /^(Load more|Try again)$/ });

describe("DraftsList load more", () => {
  const renderList = (items: DraftListItem[], nextCursor: string | null) =>
    render(<SheetRoot><DraftsList initialItems={items} nextCursor={nextCursor} /></SheetRoot>);

  it("shows no button when there is no next page", () => {
    renderList([draft(1)], null);
    expect(screen.queryByRole("button", { name: /load more/i })).toBeNull();
    expect(screen.queryByText(/shown$/)).toBeNull();
  });

  it("appends the next page, keeps the first rows, and hides the button at the end", async () => {
    fetchMock.mockReturnValueOnce(json({ items: [apiDraft(2), apiDraft(3, { name: "Cube night" })], nextCursor: null }));
    renderList([draft(1)], "a b/c=");
    fireEvent.click(loadMore());

    expect(await screen.findByRole("link", { name: /Cube night/ })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(`/api/drafts?cursor=${encodeURIComponent("a b/c=")}`);
    expect(screen.getByRole("link", { name: /Draft 1/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Draft 2/ })).toHaveTextContent("Aug 2");
    expect(screen.queryByRole("button", { name: /load more/i })).toBeNull();
    const end = screen.getByText("All 3 drafts shown");
    expect(end).toHaveFocus();
    expect(screen.getByRole("status")).toHaveTextContent("Loaded 2 more drafts");
  });

  it("keeps the button while more pages remain and follows the new cursor", async () => {
    fetchMock
      .mockReturnValueOnce(json({ items: [apiDraft(2)], nextCursor: "c2" }))
      .mockReturnValueOnce(json({ items: [apiDraft(3)], nextCursor: null }));
    renderList([draft(1)], "c1");
    fireEvent.click(loadMore());
    await screen.findByRole("link", { name: /Draft 2/ });
    fireEvent.click(loadMore());
    await screen.findByRole("link", { name: /Draft 3/ });
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual(["/api/drafts?cursor=c1", "/api/drafts?cursor=c2"]);
  });

  it("skips a row that is already on the page", async () => {
    fetchMock.mockReturnValueOnce(json({ items: [apiDraft(1), apiDraft(2)], nextCursor: null }));
    renderList([draft(1)], "c1");
    fireEvent.click(loadMore());
    await screen.findByText("All 2 drafts shown");
    expect(screen.getAllByRole("link", { name: /Draft 1/ })).toHaveLength(1);
  });

  it("holds back Load more while the finished preview is collapsed, then shows it after Show all", async () => {
    const first = Array.from({ length: 12 }, (_, i) => draft(i + 1));
    fetchMock.mockReturnValueOnce(json({ items: [apiDraft(13)], nextCursor: "more" }));
    renderList(first, "c1");
    expect(screen.queryByRole("link", { name: /Draft 12/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Show all 12" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /load more/i })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Show all 12" }));
    expect(screen.getByRole("link", { name: /Draft 12/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /show all/i })).toBeNull();
    fireEvent.click(loadMore());
    expect(await screen.findByRole("link", { name: /Draft 13/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Load more" })).toBeInTheDocument();
  });

  it("shows Load more at once when nothing is hidden behind Show all", () => {
    renderList(Array.from({ length: 10 }, (_, i) => draft(i + 1)), "c1");
    expect(screen.queryByRole("button", { name: /show all/i })).toBeNull();
    expect(loadMore()).toBeInTheDocument();
  });

  it("disables the button with a spinner while loading, and a second click does not fetch again", async () => {
    const pending = deferred();
    fetchMock.mockReturnValueOnce(pending.promise);
    renderList([draft(1)], "c1");
    const button = loadMore();
    button.focus();
    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.click(button);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(button.querySelector("svg.spin")).not.toBeNull();
    expect(button).toHaveFocus();
    expect(screen.getByRole("status")).toHaveTextContent("Loading more drafts");

    await act(async () => { pending.resolve(await json({ items: [apiDraft(2)], nextCursor: "c2" })); });
    await screen.findByRole("link", { name: /Draft 2/ });
    expect(button).not.toHaveAttribute("aria-disabled");
    expect(button.querySelector("svg.spin")).toBeNull();
    expect(button).toHaveFocus();
    fireEvent.click(button);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("shows an inline error, keeps the rows, and retries from the same cursor", async () => {
    fetchMock
      .mockReturnValueOnce(json({ error: "Failed" }, 500))
      .mockReturnValueOnce(json({ items: [apiDraft(2)], nextCursor: null }));
    renderList([draft(1)], "c1");
    const button = loadMore();
    fireEvent.click(button);

    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn’t load more drafts.");
    expect(screen.getByRole("link", { name: /Draft 1/ })).toBeInTheDocument();
    const retry = screen.getByRole("button", { name: "Try again" });
    expect(retry).toBe(button);
    fireEvent.click(retry);

    await screen.findByRole("link", { name: /Draft 2/ });
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual(["/api/drafts?cursor=c1", "/api/drafts?cursor=c1"]);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("button", { name: /try again|load more/i })).toBeNull();
  });

  it("treats a network failure and a malformed body as errors", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("offline")).mockReturnValueOnce(json({ nope: true }));
    renderList([draft(1)], "c1");
    fireEvent.click(loadMore());
    await screen.findByRole("alert");
    fireEvent.click(loadMore());
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByRole("link", { name: /Draft 1/ })).toBeInTheDocument();
  });

  it("an appended live row has no setup: no pack total and no pick time, and nothing guessed", async () => {
    const live = apiDraft(2, { status: "active", currentPackRound: 2, currentPickStep: 3, createdAt: "2026-10-01T09:00:00Z", endedAt: undefined });
    fetchMock.mockReturnValueOnce(json({ items: [live], nextCursor: null }));
    renderList([draft(1)], "c1");
    fireEvent.click(loadMore());
    const row = await screen.findByRole("link", { name: /Draft 2/ });
    expect(row).toHaveTextContent("Pack 2, pick 3");
    expect(row).not.toHaveTextContent(/ of \d/);
    expect(row).not.toHaveTextContent("a pick");
    expect(within(row).getByText("Cube draft")).toBeInTheDocument();
    expect(within(row).getByText("4 players")).toBeInTheDocument();
  });

  it("keeps a theme appended draft a theme draft", async () => {
    fetchMock.mockReturnValueOnce(json({ items: [apiDraft(2, { status: "pending", mode: "theme" })], nextCursor: null }));
    renderList([draft(1)], "c1");
    fireEvent.click(loadMore());
    expect(await screen.findByRole("link", { name: /Draft 2/ })).toHaveTextContent("Theme draft");
  });
});

describe("draftFromApi", () => {
  it("maps the API names to the page names and carries only the mode as setup", () => {
    expect(draftFromApi(apiDraft(7, { mode: "theme", currentPackRound: 12, currentPickStep: 2 }))).toEqual({
      id: 7, name: "Draft 7", status: "completed", webSlug: "d7", wave: 12, pick: 2, playerCount: 4,
      createdAt: "2026-08-01T10:00:00Z", endedAt: "2026-08-02T10:00:00Z", config: { mode: "theme" },
    });
  });
});

describe("TournamentsList load more", () => {
  const renderList = (items: TournamentListItem[], nextCursor: string | null) =>
    render(<SheetRoot><TournamentsList initialItems={items} nextCursor={nextCursor} rounds={new Map()} viewerId={null} /></SheetRoot>);

  it("shows no button when there is no next page", () => {
    renderList([tournament(1)], null);
    expect(screen.queryByRole("button", { name: /load more/i })).toBeNull();
  });

  it("appends the next page and hides the button at the end", async () => {
    fetchMock.mockReturnValueOnce(json({
      items: [{ ...tournament(2), guildId: "g1", createdByUserId: 5 }, tournament(3, { name: "Spring open" })],
      nextCursor: null,
    }));
    renderList([tournament(1)], "t1");
    fireEvent.click(loadMore());
    expect(await screen.findByRole("link", { name: /Spring open/ })).toBeInTheDocument();
    expect(fetchMock.mock.calls[0][0]).toBe("/api/tournaments?cursor=t1");
    expect(screen.getByRole("link", { name: /Cup 1/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /load more/i })).toBeNull();
    expect(screen.getByText("All 3 tournaments shown")).toHaveFocus();
  });

  it("draws an appended running tournament without a round strip or duel action", async () => {
    fetchMock.mockReturnValueOnce(json({ items: [tournament(2, { name: "Live cup", status: "active" })], nextCursor: null }));
    renderList([tournament(1)], "t1");
    fireEvent.click(loadMore());
    const row = (await screen.findByRole("link", { name: "Live cup" })).closest("li")!;
    expect(row).toHaveTextContent("In progress");
    expect(row).toHaveTextContent("Single elimination");
    expect(row).toHaveTextContent("8 players");
    expect(within(row).queryByRole("button")).toBeNull();
    expect(row.querySelector("[aria-label$='rounds']")).toBeNull();
  });

  it("holds back Load more while the finished preview is collapsed, then shows it after Show all", async () => {
    const first = Array.from({ length: 7 }, (_, i) => tournament(i + 1));
    fetchMock.mockReturnValueOnce(json({ items: [tournament(8)], nextCursor: "t3" }));
    renderList(first, "t2");
    expect(screen.queryByRole("link", { name: /Cup 7/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /load more/i })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show all 7" }));
    expect(screen.getByRole("link", { name: /Cup 7/ })).toBeInTheDocument();
    fireEvent.click(loadMore());
    await screen.findByRole("link", { name: /Cup 8/ });
    expect(screen.getByRole("button", { name: "Load more" })).toBeInTheDocument();
  });

  it("prevents a double click, then shows an error and retries", async () => {
    const pending = deferred();
    fetchMock.mockReturnValueOnce(pending.promise).mockReturnValueOnce(json({ items: [tournament(2)], nextCursor: null }));
    renderList([tournament(1)], "t1");
    const button = loadMore();
    fireEvent.click(button);
    fireEvent.click(button);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(button).toHaveAttribute("aria-disabled", "true");

    await act(async () => { pending.resolve(await json({ error: "Failed" }, 500)); });
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn’t load more tournaments.");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await screen.findByRole("link", { name: /Cup 2/ });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("tournamentFromApi", () => {
  it("drops fields the list does not read", () => {
    expect(tournamentFromApi({ ...tournament(4), guildId: "g1", createdByUserId: 9 })).toEqual(tournament(4));
  });
});
