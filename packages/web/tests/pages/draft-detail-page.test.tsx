// @vitest-environment jsdom
import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDraftStore } from "../../src/lib/stores/draft-store";

// ---------------------------------------------------------------------------
// Next.js navigation mocks — stable object references prevent fetchDraft
// useCallback from recreating on every render (router is in its dep array).
// ---------------------------------------------------------------------------
const mockRouter = { push: vi.fn(), refresh: vi.fn() };
const mockParams = vi.hoisted(() => ({ slug: "test-draft" }));
vi.mock("next/navigation", () => ({
  useParams: () => ({ slug: mockParams.slug }),
  useRouter: () => mockRouter,
}));

// ---------------------------------------------------------------------------
// Hook mocks — these have side-effects (WebSocket, timers) we don't want in
// page-level tests.
// ---------------------------------------------------------------------------
vi.mock("../../src/lib/hooks/use-draft-websocket", () => ({
  useDraftWebsocket: vi.fn(),
}));
vi.mock("../../src/lib/hooks/use-draft-countdown", () => ({
  useDraftCountdown: vi.fn(),
}));
vi.mock("../../src/lib/hooks/use-draft-expiry-resync", () => ({
  useDraftExpiryResync: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Child component mocks — render minimal stand-ins so we can assert on which
// view is shown without needing full component trees.
// ---------------------------------------------------------------------------
vi.mock("../../src/components/draft/draft-manage-view", () => ({
  DraftManageView: function DraftManageView(props: {
    discordEnabled?: boolean;
    botsEnabled?: boolean;
    draft: { name: string; lobby?: { revision: number } };
    onUpdate: (data: { name?: string; config?: unknown }) => Promise<void>;
    onChanged?: () => void;
  }) {
    const [message, setMessage] = React.useState("");
    return (
      <div
        data-testid="draft-manage-view"
        data-discord={String(props.discordEnabled)}
        data-bots={String(props.botsEnabled)}
        data-name={props.draft.name}
        data-revision={String(props.draft.lobby?.revision)}
      >
        Manage
        <button type="button" onClick={() => void props.onUpdate({ name: "Renamed" }).catch((e: Error) => setMessage(e.message))}>save</button>
        <button type="button" onClick={() => props.onChanged?.()}>changed</button>
        {message && <p role="alert">{message}</p>}
      </div>
    );
  },
}));
vi.mock("../../src/components/draft/theme/theme-table-lobby", () => ({
  ThemeTableLobby: (props: { discordEnabled?: boolean; isCreator: boolean; botsEnabled?: boolean; draft: { lobby?: { revision: number } } }) => (
    <div
      data-testid="theme-table"
      data-discord={String(props.discordEnabled)}
      data-host={String(props.isCreator)}
      data-bots={String(props.botsEnabled)}
      data-revision={String(props.draft.lobby?.revision)}
    >
      Table
    </div>
  ),
}));
vi.mock("../../src/components/draft/draft-summary-view", () => ({
  DraftSummaryView: () => <div data-testid="draft-summary-view">Summary</div>,
}));
vi.mock("../../src/components/draft/room/draft-room", () => ({
  DraftRoom: () => <div data-testid="draft-room">Room</div>,
}));
vi.mock("../../src/components/draft/room/finale", () => ({
  DraftFinale: ({ onClose, pool, canCreateTournament }: { onClose: () => void; pool: Array<{ id: number; name: string }>; canCreateTournament: boolean }) => (
    <button data-testid="draft-finale" data-can-create={String(canCreateTournament)} onClick={onClose}>
      Finale
      {pool.map((card) => <span key={card.id}>{card.name}</span>)}
    </button>
  ),
}));

// ---------------------------------------------------------------------------
// Import page AFTER mocks are set up
// ---------------------------------------------------------------------------
import DraftDetailPage from "../../app/(app)/draft/[slug]/page";
import { useDraftWebsocket } from "../../src/lib/hooks/use-draft-websocket";

const DRAFT_STATUS = {
  active: "active",
  completed: "completed",
} as const;

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------
const baseStoreState = {
  slug: "test-draft",
  packRound: 1,
  pickStep: 1,
  currentPack: [],
  myPool: [],
  seats: [],
  timerSeconds: 0,
  isMyTurn: false,
  completed: false,
  pickSeconds: 60,
  selectedCardId: null,
  highlightedIndex: -1,
};

const activeDraftResponse = {
  id: 1,
  name: "Test Draft",
  status: DRAFT_STATUS.active,
  createdByUserId: "user-1",
  createdAt: "2026-05-06T12:00:00.000Z",
  config: { packSize: 5, packsPerPlayer: 3, pickSeconds: 60, setNames: [] },
  players: [],
  playerCount: 1,
  isParticipant: true,
  packRound: 1,
  pickStep: 1,
  currentPack: [],
  myPool: [],
  seats: [],
  timerSeconds: 30,
  isMyTurn: false,
  completed: false,
  pickSeconds: 60,
};

const completedDraftResponse = {
  ...activeDraftResponse,
  status: DRAFT_STATUS.completed,
  completed: true,
  endedAt: "2026-05-06T12:30:00.000Z",
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("DraftDetailPage — completion transition", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useDraftStore.setState(baseStoreState);
  });

  afterEach(() => {
    useDraftStore.setState(baseStoreState);
  });

  it("renders the active draft view when status is active", async () => {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url === "/api/auth/session") {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ user: { id: "user-1" } }) } as Response);
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(activeDraftResponse),
      } as Response);
    });

    render(<DraftDetailPage />);

    await waitFor(() => {
      expect(screen.getByTestId("draft-room")).toBeTruthy();
    });

    expect(screen.queryByTestId("draft-summary-view")).toBeNull();
    expect(screen.queryByTestId("draft-manage-view")).toBeNull();
  });

  it("hands the active draft its config and shows the finale, then the summary, when you finish in the room", async () => {
    let calls = 0;
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url === "/api/auth/session") {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ user: { id: "user-1" } }) } as Response);
      }
      calls += 1;
      const body = calls === 1 ? activeDraftResponse : completedDraftResponse;
      return Promise.resolve({ ok: true, json: () => Promise.resolve(body) } as Response);
    });
    render(<DraftDetailPage />);
    await waitFor(() => expect(screen.getByTestId("draft-room")).toBeTruthy());
    // a pick made in the room lands in the store before the draft completes
    act(() => {
      useDraftStore.setState({
        myPool: [
          { id: 1, passcode: 100001, name: "A", type: "Effect Monster", frameType: "effect", effectText: "", imageUrl: "", imageUrlSmall: "" },
        ],
      });
    });
    act(() => {
      useDraftStore.getState().setFromServer({ completed: true });
    });
    await waitFor(() => expect(screen.getByTestId("draft-finale")).toBeTruthy());
    expect(screen.getByTestId("draft-finale").textContent).toContain("A");
    expect(screen.getByTestId("draft-summary-view")).toBeTruthy();
    act(() => screen.getByTestId("draft-finale").click());
    expect(screen.queryByTestId("draft-finale")).toBeNull();
  });

  it.each([
    ["the host when the server refuses", "user-1", false, "false"],
    ["a guild admin who is not the host", "admin-9", true, "true"],
  ])("gives the finale the server's canCreateTournament for %s", async (_label, userId, canCreateTournament, expected) => {
    const card = { id: 1, passcode: 100001, name: "A", type: "Effect Monster", frameType: "effect", effectText: "", imageUrl: "", imageUrlSmall: "" };
    let completed = false;
    global.fetch = vi.fn().mockImplementation((url: string) => {
      const body = url === "/api/auth/session"
        ? { user: { id: userId } }
        : url === "/api/drafts/test-draft/pool"
          ? { cards: [] }
          : completed
            ? { ...completedDraftResponse, myPool: [card], canCreateTournament }
            : { ...activeDraftResponse, myPool: [card] };
      return Promise.resolve({ ok: true, json: async () => body } as Response);
    });
    render(<DraftDetailPage />);
    await waitFor(() => expect(screen.getByTestId("draft-room")).toBeTruthy());

    completed = true;
    act(() => vi.mocked(useDraftWebsocket).mock.calls.at(-1)?.[1]?.onResync?.());

    await waitFor(() => expect(screen.getByTestId("draft-finale")).toBeTruthy());
    expect(screen.getByTestId("draft-finale").getAttribute("data-can-create")).toBe(expected);
  });

  it("uses the completed response pool including the final timer pick", async () => {
    const firstCard = { id: 1, passcode: 100001, name: "First card", type: "Effect Monster", frameType: "effect", effectText: "", imageUrl: "", imageUrlSmall: "" };
    const finalCard = { ...firstCard, id: 2, passcode: 100002, name: "Final timer card" };
    let completed = false;
    global.fetch = vi.fn().mockImplementation((url: string) => {
      const body = url === "/api/auth/session"
        ? { user: { id: "user-1" } }
        : url === "/api/drafts/test-draft/pool"
          ? { cards: [] }
          : completed
            ? { ...completedDraftResponse, myPool: [firstCard, finalCard] }
            : { ...activeDraftResponse, myPool: [firstCard] };
      return Promise.resolve({ ok: true, json: async () => body } as Response);
    });
    render(<DraftDetailPage />);
    await waitFor(() => expect(screen.getByTestId("draft-room")).toBeTruthy());

    completed = true;
    const options = vi.mocked(useDraftWebsocket).mock.calls.at(-1)?.[1];
    act(() => options?.onResync?.());

    await waitFor(() => expect(screen.getByTestId("draft-finale").textContent).toContain("Final timer card"));
    expect(screen.getByTestId("draft-finale").textContent).toContain("First card");
    expect(useDraftStore.getState().myPool.map((card) => card.id)).toEqual([1]);
  });

  it("transitions to DraftSummaryView when storeCompleted becomes true while draft.status is active", async () => {
    // Track how many times the draft API has been called so we can serve
    // active on the first call and completed on the second.
    let draftApiCallCount = 0;

    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url === "/api/auth/session") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ user: { id: "user-1" } }),
        } as Response);
      }
      // Pool image-prefetch endpoint (fires while active) — not the draft-detail
      // call this test counts.
      if (url === "/api/drafts/test-draft/pool") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ cards: [] }),
        } as Response);
      }
      // Draft API
      draftApiCallCount += 1;
      if (draftApiCallCount === 1) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(activeDraftResponse),
        } as Response);
      }
      // Second call (triggered by storeCompleted effect) → completed
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(completedDraftResponse),
      } as Response);
    });

    render(<DraftDetailPage />);

    // Wait for initial active view to render
    await waitFor(() => {
      expect(screen.getByTestId("draft-room")).toBeTruthy();
    });

    // Simulate pick API response setting completed: true in the store,
    // as the room's pick would via setFromServer(data).
    act(() => {
      useDraftStore.getState().setFromServer({ completed: true });
    });

    // The useEffect watching storeCompleted should fire fetchDraft, which
    // returns completedDraftResponse; the page transitions to DraftSummaryView.
    await waitFor(() => {
      expect(screen.getByTestId("draft-summary-view")).toBeTruthy();
    });

    expect(screen.queryByTestId("draft-room")).toBeNull();
    expect(draftApiCallCount).toBe(2);
  });

  it("does NOT re-fetch if storeCompleted becomes true but draft.status is already completed", async () => {
    vi.useFakeTimers();

    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url === "/api/auth/session") {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ user: { id: "user-1" } }) } as Response);
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(completedDraftResponse),
      } as Response);
    });
    global.fetch = fetchMock;

    render(<DraftDetailPage />);

    // Switch back to real timers so waitFor can work, then wait for initial load
    vi.useRealTimers();

    // Wait for the completed summary view to appear
    await waitFor(() => {
      expect(screen.getByTestId("draft-summary-view")).toBeTruthy();
    });

    // Capture call count once the page has settled
    const callCountAfterLoad = fetchMock.mock.calls.length;

    // Setting storeCompleted true while draft.status is already "completed"
    // must NOT trigger another fetchDraft call.
    act(() => {
      useDraftStore.getState().setFromServer({ completed: true });
    });

    // Use waitFor with a stable assertion: confirm the call count does NOT
    // increase even after effects have had time to run. The 50 ms interval
    // and 200 ms timeout give React enough time to flush any effects without
    // making the suite slow.
    await waitFor(
      () => {
        expect(fetchMock.mock.calls.length).toBe(callCountAfterLoad);
      },
      { interval: 50, timeout: 200 },
    );
  });

  it("renders DraftManageView for a pending draft", async () => {
    const pendingDraftResponse = {
      ...activeDraftResponse,
      status: "pending",
      completed: false,
      currentPack: undefined,
      myPool: undefined,
      seats: undefined,
    };

    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url === "/api/auth/session") {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ user: { id: "user-1" } }) } as Response);
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(pendingDraftResponse),
      } as Response);
    });

    render(<DraftDetailPage />);

    await waitFor(() => {
      expect(screen.getByTestId("draft-manage-view")).toBeTruthy();
    });

    expect(screen.queryByTestId("draft-room")).toBeNull();
    expect(screen.queryByTestId("draft-summary-view")).toBeNull();
  });

  it("re-fetches the draft when websocket status changes", async () => {
    let draftApiCallCount = 0;

    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url === "/api/auth/session") {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ user: { id: "user-1" } }) } as Response);
      }
      if (url === "/api/drafts/test-draft") {
        draftApiCallCount += 1;
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(activeDraftResponse),
      } as Response);
    });

    render(<DraftDetailPage />);

    await waitFor(() => {
      expect(screen.getByTestId("draft-room")).toBeTruthy();
    });

    const options = vi.mocked(useDraftWebsocket).mock.calls.at(-1)?.[1];

    act(() => {
      options?.onStatusChange?.(DRAFT_STATUS.active);
    });

    await waitFor(() => {
      expect(draftApiCallCount).toBe(2);
    });
  });

  it("re-fetches the draft when websocket resync fires", async () => {
    let draftApiCallCount = 0;

    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url === "/api/auth/session") {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ user: { id: "user-1" } }) } as Response);
      }
      if (url === "/api/drafts/test-draft") {
        draftApiCallCount += 1;
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(activeDraftResponse),
      } as Response);
    });

    render(<DraftDetailPage />);

    await waitFor(() => {
      expect(screen.getByTestId("draft-room")).toBeTruthy();
    });

    const options = vi.mocked(useDraftWebsocket).mock.calls.at(-1)?.[1];

    act(() => {
      options?.onResync?.();
    });

    await waitFor(() => {
      expect(draftApiCallCount).toBe(2);
    });
  });
});

describe("DraftDetailPage — load failures", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useDraftStore.setState(baseStoreState);
  });

  const respondWith = (status: number, body: unknown) =>
    vi.fn().mockImplementation((url: string) => {
      if (url === "/api/auth/session") {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ user: { id: "user-2" } }) } as Response);
      }
      return Promise.resolve({ ok: false, status, json: () => Promise.resolve(body) } as Response);
    });

  it("shows a private-draft sheet on 403, not a load failure", async () => {
    global.fetch = respondWith(403, { error: "This draft is only open to its players." });

    render(<DraftDetailPage />);

    expect(await screen.findByRole("heading", { name: "This draft is only open to its players" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "All drafts" }).getAttribute("href")).toBe("/drafts");
    expect(screen.getByRole("link", { name: "Dashboard" }).getAttribute("href")).toBe("/dashboard");
    expect(screen.queryByText(/Failed to load draft/)).toBeNull();
  });

  it("shows a not-found sheet on 404 with the slug in the code element", async () => {
    global.fetch = respondWith(404, { error: "Draft not found" });

    render(<DraftDetailPage />);

    expect(await screen.findByRole("heading", { name: "No draft at this address" })).toBeTruthy();
    expect(document.querySelector("code")?.textContent).toBe("/draft/test-draft");
    expect(screen.getByRole("link", { name: "All drafts" })).toBeTruthy();
  });

  it("shows a retry sheet on 500 and refetches when Try again is clicked", async () => {
    const fetchMock = respondWith(500, { error: "boom" });
    global.fetch = fetchMock;
    const draftCalls = () => fetchMock.mock.calls.filter(([url]) => url === "/api/drafts/test-draft").length;

    render(<DraftDetailPage />);

    expect(await screen.findByRole("heading", { name: "This draft didn't load" })).toBeTruthy();
    const before = draftCalls();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Try again/ }));
    });

    await waitFor(() => expect(draftCalls()).toBe(before + 1));
  });

  it("offers the drafts list next to Try again when the load fails", async () => {
    global.fetch = respondWith(500, { error: "boom" });

    render(<DraftDetailPage />);

    expect(await screen.findByRole("heading", { name: "This draft didn't load" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Try again/ })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Drafts" }).getAttribute("href")).toBe("/drafts");
    expect(screen.queryByText(/tell whoever runs the bot/)).toBeNull();
  });

  it("keeps the room on screen when a later refresh fails with a server error", async () => {
    let draftCalls = 0;
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url === "/api/auth/session") {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ user: { id: "user-1" } }) } as Response);
      }
      draftCalls += 1;
      if (draftCalls === 1) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(activeDraftResponse) } as Response);
      }
      return Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({ error: "boom" }) } as Response);
    });

    render(<DraftDetailPage />);
    await waitFor(() => expect(screen.getByTestId("draft-room")).toBeTruthy());

    // The pick that completes the draft makes the page refresh; that refresh fails.
    act(() => {
      useDraftStore.getState().setFromServer({ completed: true });
    });
    await waitFor(() => expect(draftCalls).toBeGreaterThanOrEqual(2));

    expect(screen.getByTestId("draft-room")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "This draft didn't load" })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Pending lobby wiring: which screen, what it is told, and how reads settle.
// ---------------------------------------------------------------------------
describe("DraftDetailPage — pending lobby wiring", () => {
  const NOW = Date.parse("2026-10-07T12:00:00.000Z");
  const lobby = (revision: number, over: Record<string, unknown> = {}) => ({
    revision,
    serverNow: new Date(NOW).toISOString(),
    targetSeats: 4,
    joined: 2,
    ready: 1,
    allReady: false,
    autoStart: { enabled: true, held: false, eligible: false },
    start: null,
    errors: [],
    warnings: [],
    lastStartError: null,
    ...over,
  });
  const pending = (over: Record<string, unknown> = {}) => ({
    ...activeDraftResponse,
    status: "pending",
    name: "Lobby draft",
    config: { packSize: 5, packsPerPlayer: 3, pickSeconds: 60 },
    currentPack: [],
    myPool: [],
    seats: [],
    lobby: lobby(5),
    ...over,
  });
  const theme = (over: Record<string, unknown> = {}) =>
    pending({ name: "Theme night", config: { mode: "theme", themeSelection: "player_pick", cardsPerPlayer: 40, pickSeconds: 45 }, ...over });

  const json = (body: unknown, status = 200) =>
    Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) } as Response);

  /** A fetch that answers the session and the draft GET from `next`, and records every call. */
  function serve(next: (call: number, slug: string) => unknown | Promise<unknown>, userId = "user-1") {
    const calls: Array<{ url: string; method: string; body?: Record<string, unknown> }> = [];
    let reads = 0;
    global.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      const method = (init?.method ?? "GET").toUpperCase();
      calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (url === "/api/auth/session") return json({ user: { id: userId } });
      const read = /^\/api\/drafts\/([^/]+)$/.exec(url);
      if (read && method === "GET") {
        reads += 1;
        return Promise.resolve(next(reads, read[1])).then((body) => json(body));
      }
      return json({});
    });
    return { calls, reads: () => reads, drafts: (method = "GET") => calls.filter((c) => c.url.startsWith("/api/drafts/") && c.method === method) };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockParams.slug = "test-draft";
    useDraftStore.setState(baseStoreState);
  });
  afterEach(() => {
    vi.useRealTimers();
    mockParams.slug = "test-draft";
  });

  it.each([
    [true, "true"],
    [false, "false"],
    [undefined, "false"],
  ])("tells the booster lobby the Discord flag from the draft GET (%s)", async (flag, expected) => {
    serve(() => pending({ discordEnabled: flag, botsEnabled: true }));
    render(<DraftDetailPage />);
    const view = await screen.findByTestId("draft-manage-view");
    expect(view.getAttribute("data-discord")).toBe(expected);
    expect(view.getAttribute("data-bots")).toBe("true");
    expect(screen.queryByTestId("theme-table")).toBeNull();
  });

  it("shows a pending theme draft on the Theme Table with the Discord flag, not on the booster lobby", async () => {
    serve(() => theme({ discordEnabled: true, botsEnabled: true }));
    render(<DraftDetailPage />);
    const table = await screen.findByTestId("theme-table");
    expect(table.getAttribute("data-discord")).toBe("true");
    expect(table.getAttribute("data-bots")).toBe("true");
    expect(table.getAttribute("data-host")).toBe("true");
    expect(screen.queryByTestId("draft-manage-view")).toBeNull();
    expect(screen.getByRole("heading", { level: 1, name: "Theme Table" })).toBeTruthy();
  });

  it("lets only the host cancel a theme draft, after a confirm", async () => {
    const server = serve(() => theme());
    render(<DraftDetailPage />);
    await screen.findByTestId("theme-table");
    fireEvent.click(screen.getByRole("button", { name: "Cancel draft" }));
    expect(screen.getByRole("dialog", { name: "Cancel this draft?" })).toBeTruthy();
    expect(server.drafts("DELETE")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Go back" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Cancel draft" }));
    fireEvent.click(screen.getByRole("button", { name: "Yes, cancel" }));
    await waitFor(() => expect(server.drafts("DELETE")).toHaveLength(1));
  });

  it("gives a guest on the Theme Table no Cancel draft", async () => {
    serve(() => theme({ createdByUserId: "someone-else" }), "user-9");
    render(<DraftDetailPage />);
    const table = await screen.findByTestId("theme-table");
    await waitFor(() => expect(table.getAttribute("data-host")).toBe("false"));
    expect(screen.queryByRole("button", { name: "Cancel draft" })).toBeNull();
  });

  it("keeps the newer lobby when an older read comes back later", async () => {
    const revisions = [5, 4, 6];
    serve((call) => pending({ name: `read ${call}`, lobby: lobby(revisions[call - 1] ?? 6) }));
    render(<DraftDetailPage />);
    const view = await screen.findByTestId("draft-manage-view");
    expect(view.getAttribute("data-revision")).toBe("5");
    await act(async () => { vi.mocked(useDraftWebsocket).mock.calls.at(-1)?.[1]?.onResync?.(); });
    await waitFor(() => expect(vi.mocked(global.fetch).mock.calls.filter(([url]) => url === "/api/drafts/test-draft")).toHaveLength(2));
    expect(screen.getByTestId("draft-manage-view").getAttribute("data-revision")).toBe("5");
    expect(screen.getByTestId("draft-manage-view").getAttribute("data-name")).toBe("read 1");
    await act(async () => { vi.mocked(useDraftWebsocket).mock.calls.at(-1)?.[1]?.onResync?.(); });
    await waitFor(() => expect(screen.getByTestId("draft-manage-view").getAttribute("data-revision")).toBe("6"));
  });

  it("makes at most two reads for a burst of events and shows the newest answer", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const server = serve(async (call) => {
      if (call === 2) await gate;
      return pending({ name: `read ${call}`, lobby: lobby(5 + call) });
    });
    render(<DraftDetailPage />);
    await screen.findByTestId("draft-manage-view");
    const options = vi.mocked(useDraftWebsocket).mock.calls.at(-1)![1]!;
    act(() => {
      options.onResync?.();
      options.onSeatsChange?.();
      options.onStatusChange?.("active");
      options.onResync?.();
      options.onSeatsChange?.();
    });
    expect(server.reads()).toBe(2);
    await act(async () => { release(); });
    await waitFor(() => expect(server.reads()).toBe(3));
    await waitFor(() => expect(screen.getByTestId("draft-manage-view").getAttribute("data-name")).toBe("read 3"));
    expect(server.reads()).toBe(3);
  });

  it("drops the old draft's answer and clears its state when the address changes", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    serve(async (call, slug) => {
      if (slug === "draft-a" && call > 1) await gate;
      return slug === "draft-a" && call === 1 ? activeDraftResponse : pending({ name: `Draft ${slug}` });
    });
    mockParams.slug = "draft-a";
    const { rerender } = render(<DraftDetailPage />);
    await screen.findByTestId("draft-room");
    act(() => {
      useDraftStore.setState({ myPool: [{ id: 1, passcode: 1, name: "A", type: "Effect Monster", frameType: "effect", effectText: "", imageUrl: "", imageUrlSmall: "" }] });
    });
    // A read of draft A is still in flight when the viewer moves to draft B.
    await act(async () => { vi.mocked(useDraftWebsocket).mock.calls.at(-1)?.[1]?.onResync?.(); });
    mockParams.slug = "draft-b";
    rerender(<DraftDetailPage />);
    await waitFor(() => expect(screen.getByTestId("draft-manage-view").getAttribute("data-name")).toBe("Draft draft-b"));
    expect(screen.queryByTestId("draft-room")).toBeNull();
    expect(useDraftStore.getState().myPool).toEqual([]);
    expect(useDraftStore.getState().slug).toBe("draft-b");
    await act(async () => { release(); });
    expect(screen.getByTestId("draft-manage-view").getAttribute("data-name")).toBe("Draft draft-b");
  });

  it("does not show the last draft's finale under another draft", async () => {
    const card = { id: 1, passcode: 1, name: "A", type: "Effect Monster", frameType: "effect", effectText: "", imageUrl: "", imageUrlSmall: "" };
    let finished = false;
    serve((_call, slug) => (slug === "draft-b" ? pending({ name: "Draft draft-b" }) : finished ? { ...completedDraftResponse, myPool: [card] } : { ...activeDraftResponse, myPool: [card] }));
    mockParams.slug = "draft-a";
    const { rerender } = render(<DraftDetailPage />);
    await screen.findByTestId("draft-room");
    finished = true;
    act(() => { vi.mocked(useDraftWebsocket).mock.calls.at(-1)?.[1]?.onResync?.(); });
    await screen.findByTestId("draft-finale");
    mockParams.slug = "draft-b";
    rerender(<DraftDetailPage />);
    await screen.findByTestId("draft-manage-view");
    expect(screen.queryByTestId("draft-finale")).toBeNull();
  });

  it("sends the lobby revision with an edit and explains a stale one after reading the new lobby", async () => {
    let stale = false;
    const base = serve((call) => pending({ lobby: lobby(call === 1 ? 5 : 6) }));
    const original = global.fetch as ReturnType<typeof vi.fn>;
    global.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url === "/api/drafts/test-draft" && init?.method === "PUT") {
        base.calls.push({ url, method: "PUT", body: JSON.parse(String(init.body)) });
        return stale ? json({ code: "STALE_LOBBY", error: "Lobby changed; refresh before editing" }, 409) : json({});
      }
      return original(url, init);
    });
    render(<DraftDetailPage />);
    await screen.findByTestId("draft-manage-view");
    fireEvent.click(screen.getByRole("button", { name: "save" }));
    await waitFor(() => expect(base.drafts("PUT")).toHaveLength(1));
    expect(base.drafts("PUT")[0].body).toEqual({ name: "Renamed", revision: 5 });

    stale = true;
    fireEvent.click(screen.getByRole("button", { name: "save" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/lobby changed while you edited/i);
    await waitFor(() => expect(screen.getByTestId("draft-manage-view").getAttribute("data-revision")).toBe("6"));
    expect(base.drafts("PUT")[1].body).toEqual({ name: "Renamed", revision: 6 });
  });

  it("reads a pending lobby again on the idle poll and never starts the draft itself", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    // The scheduled start is already past on the server clock, but the server still says pending.
    const start = { token: "t", kind: "auto", startsAt: new Date(NOW - 3_000).toISOString() };
    const server = serve((call) => (call < 4 ? pending({ lobby: lobby(5, { start }) }) : { ...activeDraftResponse }));
    render(<DraftDetailPage />);
    await screen.findByTestId("draft-manage-view");
    expect(server.reads()).toBe(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(1_100); });
    expect(server.reads()).toBeGreaterThanOrEqual(2);
    // Past the deadline the page stays on the lobby until a read says active.
    expect(screen.getByTestId("draft-manage-view")).toBeTruthy();
    expect(screen.queryByTestId("draft-room")).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(3_000); });
    await waitFor(() => expect(screen.getByTestId("draft-room")).toBeTruthy());
    expect(server.drafts("POST")).toHaveLength(0);
    expect(server.calls.some((c) => c.url.endsWith("/start"))).toBe(false);
  });

  it("stops polling once the draft is active", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const server = serve(() => activeDraftResponse);
    render(<DraftDetailPage />);
    await screen.findByTestId("draft-room");
    const before = server.reads();
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    // The room's own resync mock is a no-op here, so no lobby clock read may appear.
    expect(server.reads()).toBe(before);
  });
});
