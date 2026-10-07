// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDraftStore } from "../../src/lib/stores/draft-store";
import { installVirtualizerJsdomEnv } from "../helpers/virtualizer-jsdom";
import { fixtureUserId } from "../fixtures/identity";

// The real page with the real lobby screens, talking to a fake draft server.
// Only the socket, the room, the finale and the summary are stand-ins.
const mockParams = vi.hoisted(() => ({ slug: "s" }));
// A stable router, like Next's: the page's read callback depends on it.
const mockRouter = vi.hoisted(() => ({ push: () => {}, refresh: () => {} }));
vi.mock("next/navigation", () => ({
  useParams: () => ({ slug: mockParams.slug }),
  useRouter: () => mockRouter,
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));
vi.mock("next/image", () => ({
  default: ({ alt, fill: _fill, ...props }: React.ImgHTMLAttributes<HTMLImageElement> & { fill?: boolean }) => <img alt={alt} {...props} />,
}));
vi.mock("../../src/lib/hooks/use-draft-websocket", () => ({ useDraftWebsocket: vi.fn() }));
vi.mock("../../src/lib/hooks/use-draft-countdown", () => ({ useDraftCountdown: vi.fn() }));
vi.mock("../../src/lib/hooks/use-draft-expiry-resync", () => ({ useDraftExpiryResync: vi.fn() }));
vi.mock("../../src/components/draft/draft-summary-view", () => ({ DraftSummaryView: () => <div data-testid="draft-summary-view" /> }));
vi.mock("../../src/components/draft/room/draft-room", () => ({ DraftRoom: () => <div data-testid="draft-room">Room</div> }));
vi.mock("../../src/components/draft/room/finale", () => ({
  DraftFinale: () => <div data-testid="draft-finale">Finale</div>,
}));

import DraftDetailPage from "../../app/(app)/draft/[slug]/page";
import { useDraftWebsocket } from "../../src/lib/hooks/use-draft-websocket";

const NOW = Date.parse("2026-10-07T12:00:00.000Z");

interface FakePlayer { id: number; name: string; userId: number; ready: boolean; cubeId: number | null }

/** One draft on the fake server. The same state answers every viewer; `isYou` and `isParticipant` follow the viewer. */
interface FakeServer {
  status: "pending" | "active" | "completed";
  theme: boolean;
  revision: number;
  players: FakePlayer[];
  autoStart: { enabled: boolean; held: boolean };
  start: { token: string; kind: "auto" | "manual"; startsAt: string } | null;
  viewer: number;
  calls: Array<{ url: string; method: string; body?: Record<string, unknown> }>;
}

const HOST_USER = fixtureUserId("u1");
const ANA_USER = fixtureUserId("u2");
const cube = (id: number, name: string) => ({
  id, name, archetype: name, mainCount: 60, extraCount: 15, mainDistinct: 30, extraDistinct: 8, mainCopies: 60, extraCopies: 15, sampleImages: [],
});

function newServer(over: Partial<FakeServer> = {}): FakeServer {
  return {
    status: "pending",
    theme: false,
    revision: 5,
    players: [
      { id: 1, name: "Imran", userId: HOST_USER, ready: true, cubeId: null },
      { id: 2, name: "Ana", userId: ANA_USER, ready: false, cubeId: null },
      { id: 3, name: "Bob", userId: fixtureUserId("u3"), ready: true, cubeId: null },
    ],
    autoStart: { enabled: true, held: false },
    start: null,
    viewer: HOST_USER,
    calls: [],
    ...over,
  };
}

function lobbyOf(s: FakeServer) {
  const ready = s.players.filter((p) => p.ready).length;
  return {
    revision: s.revision,
    serverNow: new Date(Date.now()).toISOString(),
    targetSeats: 4,
    joined: s.players.length,
    ready,
    allReady: ready === s.players.length,
    autoStart: { ...s.autoStart, eligible: false },
    start: s.start,
    errors: [] as string[],
    warnings: [] as string[],
    lastStartError: null,
  };
}

function playersOf(s: FakeServer) {
  return s.players.map((p) => ({
    playerId: p.id,
    displayName: p.name,
    pickCount: 0,
    joinedAt: "2026-10-07T11:00:00.000Z",
    isHost: p.userId === HOST_USER,
    isYou: p.userId === s.viewer,
    isBot: false,
    ready: p.ready,
    readyAt: null,
    cubeId: p.cubeId,
  }));
}

function draftOf(s: FakeServer) {
  const member = s.players.some((p) => p.userId === s.viewer);
  const base = {
    id: 1,
    name: s.theme ? "Theme night" : "Legendary Draft",
    status: s.status,
    createdByUserId: HOST_USER,
    createdAt: "2026-10-07T10:00:00.000Z",
    config: s.theme
      ? { mode: "theme", themeSelection: "player_pick", uniqueThemes: true, cardsPerPlayer: 40, themePackSize: 3, extraDeckEnabled: true, extraDeckSize: 15, pickSeconds: 45, lobbySeats: 4, copyLimit: true, burnUnpicked: false }
      : { packSize: 5, packsPerPlayer: 3, cardsPerPlayer: 45, pickSeconds: 60, lobbySeats: 4, setNames: ["Legend of Blue Eyes White Dragon"] },
    players: playersOf(s),
    playerCount: s.players.length,
    isParticipant: member,
    discordEnabled: false,
    botsEnabled: false,
    allowedCubes: s.theme ? [cube(10, "Blue-Eyes"), cube(11, "Mermail")] : undefined,
  };
  if (s.status === "pending") return { ...base, lobby: lobbyOf(s) };
  return {
    ...base,
    packRound: 1, pickStep: 1, currentPack: [], myPool: [], seats: [], timerSeconds: 30, isMyTurn: false,
    completed: s.status === "completed", pickSeconds: 60,
  };
}

function lobbyAnswer(s: FakeServer) {
  return { lobby: lobbyOf(s), players: playersOf(s) };
}

/** Installs the fake server as `fetch`. Mutations bump the revision, like the real routes. */
function serve(s: FakeServer) {
  const json = (body: unknown, status = 200) => Promise.resolve(Response.json(body, { status }));
  vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined;
    s.calls.push({ url, method, body });
    const me = s.players.find((p) => p.userId === s.viewer);
    if (url === "/api/auth/session") return json({ user: { id: String(s.viewer) } });
    if (url === "/api/drafts/s" && method === "GET") return json(draftOf(s));
    if (url === "/api/drafts/s/ready" && method === "POST" && me) {
      me.ready = body?.ready === true;
      s.revision += 1;
      return json(lobbyAnswer(s));
    }
    if (url === "/api/drafts/s/auto-start" && method === "PUT") {
      s.autoStart = { enabled: body?.enabled === true, held: body?.held === true };
      s.revision += 1;
      return json(lobbyAnswer(s));
    }
    if (url === "/api/drafts/s/start" && method === "DELETE") {
      s.start = null;
      s.autoStart = { enabled: true, held: true };
      s.revision += 1;
      return json(lobbyAnswer(s));
    }
    if (url === "/api/drafts/s/claim-cube" && method === "POST" && me) {
      me.cubeId = Number(body?.cubeId);
      s.revision += 1;
      return json({ ok: true, cubeId: me.cubeId });
    }
    return json({ cards: [], cubes: [], archetypes: [], errors: [], warnings: [] });
  }));
}

const reads = (s: FakeServer) => s.calls.filter((c) => c.url === "/api/drafts/s" && c.method === "GET");
const sent = (s: FakeServer, url: string, method: string) => s.calls.filter((c) => c.url === `/api/drafts/s${url}` && c.method === method);

beforeEach(() => {
  installVirtualizerJsdomEnv();
  mockParams.slug = "s";
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(NOW);
  useDraftStore.setState({ slug: "s" } as never);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("draft lobby flow — Seats First", () => {
  it("lets a player mark Ready and shows the server's answer", async () => {
    const s = newServer({ viewer: ANA_USER });
    serve(s);
    render(<DraftDetailPage />);
    const ready = await screen.findByRole("button", { name: /i'm ready/i });
    fireEvent.click(ready);
    await waitFor(() => expect(sent(s, "/ready", "POST")).toHaveLength(1));
    expect(sent(s, "/ready", "POST")[0].body).toEqual({ ready: true });
    await waitFor(() => expect(screen.getByRole("button", { name: /ready/i, pressed: true })).toBeInTheDocument());
  });

  it("shows the other tab's Ready after the idle poll, with no socket message", async () => {
    const s = newServer();
    serve(s);
    render(<DraftDetailPage />);
    await screen.findByRole("heading", { name: "Seats" });
    expect(screen.getAllByText("Not ready")).toHaveLength(1);
    // Ana presses Ready in another tab.
    s.players[1].ready = true;
    s.revision += 1;
    await act(async () => { await vi.advanceTimersByTimeAsync(10_100); });
    await waitFor(() => expect(screen.queryByText("Not ready")).not.toBeInTheDocument());
  });

  it("takes the Ready button away from a player the host removed", async () => {
    const s = newServer({ viewer: ANA_USER });
    serve(s);
    render(<DraftDetailPage />);
    await screen.findByRole("button", { name: /i'm ready/i });
    s.players = s.players.filter((p) => p.userId !== ANA_USER);
    s.revision += 1;
    await act(async () => { await vi.advanceTimersByTimeAsync(10_100); });
    await waitFor(() => expect(screen.queryByRole("button", { name: /i'm ready/i })).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: /join draft/i })).toBeInTheDocument();
  });

  it("sends Hold with the lobby revision and shows Resume after the answer", async () => {
    const s = newServer();
    serve(s);
    render(<DraftDetailPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Hold" }));
    await waitFor(() => expect(sent(s, "/auto-start", "PUT")).toHaveLength(1));
    expect(sent(s, "/auto-start", "PUT")[0].body).toEqual({ enabled: true, held: true, revision: 5 });
    expect(await screen.findByRole("button", { name: "Resume" })).toBeInTheDocument();
  });

  it("keeps the countdown across a reload and opens the room only when the server says active", async () => {
    const s = newServer({
      autoStart: { enabled: true, held: false },
      start: { token: "tok", kind: "auto", startsAt: new Date(NOW + 7_000).toISOString() },
    });
    serve(s);
    const first = render(<DraftDetailPage />);
    expect(await screen.findByRole("dialog", { name: /draft starting/i })).toBeInTheDocument();
    first.unmount();

    // A reload three seconds later: the remaining time comes from the server deadline, not from a fresh 10 s.
    await act(async () => { await vi.advanceTimersByTimeAsync(3_000); });
    render(<DraftDetailPage />);
    const title = await screen.findByRole("heading", { name: /starting in \d+ s/i });
    const left = Number(/(\d+) s/.exec(title.textContent ?? "")?.[1]);
    expect(left).toBeGreaterThanOrEqual(3);
    expect(left).toBeLessThanOrEqual(4);

    // The deadline passes. The server has not moved: the page stays on the lobby and sends no Start.
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    expect(screen.queryByTestId("draft-room")).not.toBeInTheDocument();
    expect(sent(s, "/start", "POST")).toHaveLength(0);

    // The server starts the draft. The next read opens the room.
    s.status = "active";
    s.start = null;
    await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
    expect(await screen.findByTestId("draft-room")).toBeInTheDocument();
    expect(sent(s, "/start", "POST")).toHaveLength(0);
  });

  it("lets the host stop a countdown with Esc, sending the token", async () => {
    const s = newServer({ start: { token: "tok", kind: "auto", startsAt: new Date(NOW + 9_000).toISOString() } });
    serve(s);
    render(<DraftDetailPage />);
    await screen.findByRole("dialog", { name: /draft starting/i });
    // Let the dialog's effects run before the key press: the Esc listener is added in an effect.
    await act(async () => {});
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(sent(s, "/start", "DELETE")).toHaveLength(1));
    expect(sent(s, "/start", "DELETE")[0].body).toEqual({ token: "tok" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: /draft starting/i })).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Resume" })).toBeInTheDocument();
  });

  it("reads the draft again each second while a start is scheduled", async () => {
    const s = newServer({ start: { token: "tok", kind: "manual", startsAt: new Date(NOW + 30_000).toISOString() } });
    serve(s);
    render(<DraftDetailPage />);
    await screen.findByRole("dialog", { name: /draft starting/i });
    const before = reads(s).length;
    await act(async () => { await vi.advanceTimersByTimeAsync(3_100); });
    expect(reads(s).length - before).toBeGreaterThanOrEqual(2);
    expect(reads(s).length - before).toBeLessThanOrEqual(4);
  });
});

describe("draft lobby flow — Theme Table", () => {
  it("shows the Theme Table for a pending theme draft and shows a claim to the other viewer after the poll", async () => {
    const s = newServer({ theme: true, viewer: ANA_USER });
    serve(s);
    const mine = render(<DraftDetailPage />);
    expect(await screen.findByRole("heading", { level: 1, name: "Theme Table" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancel draft" })).not.toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: "Take Mermail" }));
    await waitFor(() => expect(sent(s, "/claim-cube", "POST")).toHaveLength(1));
    expect(sent(s, "/claim-cube", "POST")[0].body).toEqual({ cubeId: 11 });
    await waitFor(() => expect(screen.getByLabelText("Your theme")).toHaveValue("11"));
    mine.unmount();

    // The host opens the page and sees Ana's claim as taken.
    s.viewer = HOST_USER;
    render(<DraftDetailPage />);
    expect(await screen.findByText("Taken by Ana")).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Cancel draft" })).toBeInTheDocument();
  });

  it("opens the room for a theme draft only when the server says active", async () => {
    const s = newServer({ theme: true });
    serve(s);
    render(<DraftDetailPage />);
    await screen.findByRole("heading", { level: 1, name: "Theme Table" });
    s.status = "active";
    await act(async () => { await vi.advanceTimersByTimeAsync(10_100); });
    expect(await screen.findByTestId("draft-room")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 1, name: "Theme Table" })).not.toBeInTheDocument();
  });
});

describe("draft lobby flow — rooms still work", () => {
  it("opens the booster room for an active draft and the finale after it completes", async () => {
    const s = newServer({ status: "active" });
    serve(s);
    render(<DraftDetailPage />);
    expect(await screen.findByTestId("draft-room")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Seats" })).not.toBeInTheDocument();
    // An active draft is not polled by the lobby clock.
    const before = reads(s).length;
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(reads(s).length).toBe(before);
    // The room's resync reads the draft again; with no card in the pool the finale stays closed.
    s.status = "completed";
    act(() => { vi.mocked(useDraftWebsocket).mock.calls.at(-1)?.[1]?.onResync?.(); });
    await waitFor(() => expect(screen.getByTestId("draft-summary-view")).toBeInTheDocument());
  });
});
