// @vitest-environment jsdom
import { fixtureUserId, fixtureDiscordId } from "../fixtures/identity";
import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { TournamentDetail } from "@/components/tournament/types";

vi.mock("next/font/google", () => {
  const font = () => ({ className: "font", variable: "font-var", style: {} });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});
const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }));
let routeSlug = "night-cup";
vi.mock("next/navigation", () => ({
  useParams: () => ({ slug: routeSlug }),
  useRouter: () => router,
  useSearchParams: () => new URLSearchParams(typeof window === "undefined" ? "" : window.location.search),
}));

/** Everything the landing does, in order: network calls, history writes and live connections. */
let events: string[];
vi.mock("@/lib/hooks/use-tournament-websocket", () => ({
  useTournamentWebsocket: (slug: string) => {
    React.useEffect(() => {
      if (slug) events.push(`socket ${slug}`);
    }, [slug]);
  },
}));

import TournamentDetailPage from "../../app/(app)/tournament/[slug]/page";
import { TournamentInviteGate } from "../../src/components/tournament/invite-gate";

const pending: TournamentDetail = {
  id: 7, name: "Night Cup", format: "round_robin", status: "pending", createdByUserId: fixtureUserId("host"),
  participants: [{ playerId: 1, displayName: "Ann" }], matches: [], isParticipant: false, currentUserPlayerId: null,
  startedAt: null, createdAt: "2026-10-01T00:00:00Z", visibility: "private", canJoin: true,
};

let redeemStatus = 200;
let redeemHeaders: Record<string, string> = {};
let detailStatus = 200;

beforeEach(() => {
  events = [];
  redeemStatus = 200;
  redeemHeaders = {};
  detailStatus = 200;
  routeSlug = "night-cup";
  router.push.mockReset();
  router.refresh.mockReset();
  window.history.replaceState(null, "", "/tournament/night-cup?invite=ABC123");
  const real = window.history.replaceState.bind(window.history);
  vi.spyOn(window.history, "replaceState").mockImplementation((state, unused, url) => {
    events.push(`replaceState ${String(url)}`);
    real(state, unused, url);
  });
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false })));
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    events.push(`${method} ${url}${init?.body ? ` ${init.body}` : ""}`);
    if (url === "/api/tournaments/night-cup/invite" && method === "POST") {
      return new Response(JSON.stringify(redeemStatus === 200 ? { ok: true } : { error: "x" }), { status: redeemStatus, headers: redeemHeaders });
    }
    if (url === "/api/auth/session") return Response.json({ user: { id: String(fixtureUserId("guest")), discordUserId: fixtureDiscordId("guest") } });
    if (url === "/api/leaderboard?scope=all") return Response.json({ rows: [] });
    if (url === "/api/tournaments/night-cup") {
      return detailStatus === 200 ? Response.json(pending) : Response.json({ error: "Tournament not found" }, { status: detailStatus });
    }
    return Response.json({});
  }));
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
});

const protectedCalls = () => events.filter((e) => e.startsWith("GET /api/tournaments/night-cup") || e.startsWith("socket"));

describe("tournament invite landing order", () => {
  it("redeems, then strips the invite, then reads the tournament and opens the live connection", async () => {
    render(<TournamentDetailPage />);
    expect(await screen.findByRole("heading", { name: "Night Cup" })).toBeInTheDocument();
    const order = events.filter((e) => e.startsWith("POST") || e.startsWith("replaceState") || e === "GET /api/tournaments/night-cup" || e.startsWith("socket"));
    expect(order).toEqual([
      'POST /api/tournaments/night-cup/invite {"code":"ABC123"}',
      "replaceState /tournament/night-cup",
      "GET /api/tournaments/night-cup",
      "socket night-cup",
    ]);
    expect(window.location.search).toBe("");
  });

  it("requests nothing protected, and shows nothing of the tournament, until the redeem answers", async () => {
    let release!: () => void;
    const hold = new Promise<void>((resolve) => { release = resolve; });
    const original = vi.mocked(fetch).getMockImplementation() as (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith("/invite") && init?.method === "POST") await hold;
      return original(input, init);
    }));
    render(<TournamentDetailPage />);
    expect(await screen.findByRole("status", { name: "Opening your invite" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Night Cup" })).toBeNull();
    expect(protectedCalls()).toEqual([]);
    await act(async () => { release(); });
    expect(await screen.findByRole("heading", { name: "Night Cup" })).toBeInTheDocument();
  });

  it("makes one redeem request even when it mounts twice, as React strict mode does", async () => {
    render(<React.StrictMode><TournamentDetailPage /></React.StrictMode>);
    await screen.findByRole("heading", { name: "Night Cup" });
    expect(events.filter((e) => e.startsWith("POST"))).toHaveLength(1);
  });

  it("keeps other parameters and the hash when it strips only invite", async () => {
    window.history.replaceState(null, "", "/tournament/night-cup?tab=players&invite=ABC123&x=1#top");
    events = [];
    render(<TournamentDetailPage />);
    await screen.findByRole("heading", { name: "Night Cup" });
    expect(events).toContain("replaceState /tournament/night-cup?tab=players&x=1#top");
    expect(window.location.search).toBe("?tab=players&x=1");
    expect(window.location.hash).toBe("#top");
  });

  it("without an invite there is no redeem and no history write", async () => {
    window.history.replaceState(null, "", "/tournament/night-cup");
    events = [];
    render(<TournamentDetailPage />);
    await screen.findByRole("heading", { name: "Night Cup" });
    expect(events.some((e) => e.startsWith("POST"))).toBe(false);
    expect(events.some((e) => e.startsWith("replaceState"))).toBe(false);
  });

  it("does not show a 404 to a not-yet-reader: the tournament is private until the redeem lands", async () => {
    let redeemed = false;
    const original = vi.mocked(fetch).getMockImplementation() as (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/tournaments/night-cup/invite" && init?.method === "POST") redeemed = true;
      if (String(input) === "/api/tournaments/night-cup" && !redeemed) return Response.json({ error: "Tournament not found" }, { status: 404 });
      return original(input, init);
    }));
    render(<TournamentDetailPage />);
    expect(await screen.findByRole("heading", { name: "Night Cup" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Tournament not found" })).toBeNull();
  });

  it("is a client page, so no server read can 404 before the invite is redeemed", () => {
    const source = readFileSync(resolve(__dirname, "../../app/(app)/tournament/[slug]/page.tsx"), "utf8");
    expect(source.trimStart().startsWith('"use client"')).toBe(true);
    expect(source).not.toMatch(/notFound\(|export default async/);
    expect(source).toContain("<TournamentInviteGate");
  });

  it("the landing joins a joinable lobby: Join is offered after the redeem", async () => {
    render(<TournamentDetailPage />);
    expect(await screen.findByRole("button", { name: "Join tournament" })).toBeInTheDocument();
  });
});

describe("tournament invite landing failures", () => {
  it("on a redeem 404 strips the invite and continues; the page's own check then shows the generic not found", async () => {
    redeemStatus = 404;
    detailStatus = 404;
    window.history.replaceState(null, "", "/tournament/night-cup?invite=ABC123&x=1#top");
    events = [];
    render(<TournamentDetailPage />);
    expect(await screen.findByRole("heading", { name: "Tournament not found" })).toBeInTheDocument();
    expect(events.filter((e) => e.startsWith("POST") || e.startsWith("replaceState") || e === "GET /api/tournaments/night-cup")).toEqual([
      'POST /api/tournaments/night-cup/invite {"code":"ABC123"}',
      "replaceState /tournament/night-cup?x=1#top",
      "GET /api/tournaments/night-cup",
    ]);
    expect(screen.queryByText("Night Cup")).toBeNull();
  });

  it("on 429 says to try again in a moment, never retries by itself, and retries once on the button", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    redeemStatus = 429;
    redeemHeaders = { "Retry-After": "12" };
    render(<TournamentDetailPage />);
    expect(await screen.findByRole("heading", { name: "Try again in a moment" })).toBeInTheDocument();
    expect(screen.getByText(/12 seconds/)).toBeInTheDocument();
    await act(async () => { vi.advanceTimersByTime(60_000); });
    expect(events.filter((e) => e.startsWith("POST"))).toHaveLength(1);
    expect(protectedCalls()).toEqual([]);
    expect(window.location.search).toBe("?invite=ABC123");

    redeemStatus = 200;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("heading", { name: "Night Cup" })).toBeInTheDocument();
    expect(events.filter((e) => e.startsWith("POST"))).toHaveLength(2);
    vi.useRealTimers();
  });

  it("on another failure offers Try again without claiming the tournament is missing", async () => {
    redeemStatus = 500;
    render(<TournamentDetailPage />);
    expect(await screen.findByRole("heading", { name: "This invite didn't open" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Tournament not found" })).toBeNull();
    expect(protectedCalls()).toEqual([]);
  });

  it("on 401 sends the visitor to sign in and back to this exact address, invite included, and loads nothing", async () => {
    redeemStatus = 401;
    window.history.replaceState(null, "", "/tournament/night-cup?invite=ABC123&x=1");
    render(<TournamentDetailPage />);
    await waitFor(() => expect(router.push).toHaveBeenCalledTimes(1));
    expect(router.push).toHaveBeenCalledWith(`/sign-in?redirect_url=${encodeURIComponent("/tournament/night-cup?invite=ABC123&x=1")}`);
    expect(protectedCalls()).toEqual([]);
  });

  it("sends a signed-out read of the page (401) to sign in too", async () => {
    window.history.replaceState(null, "", "/tournament/night-cup");
    detailStatus = 401;
    render(<TournamentDetailPage />);
    await waitFor(() => expect(router.push).toHaveBeenCalledWith(`/sign-in?redirect_url=${encodeURIComponent("/tournament/night-cup")}`));
  });
});

describe("TournamentInviteGate", () => {
  it("mounts its children at once when the address has no invite", async () => {
    window.history.replaceState(null, "", "/tournament/night-cup");
    render(<TournamentInviteGate slug="night-cup"><h1>Body</h1></TournamentInviteGate>);
    expect(await screen.findByRole("heading", { name: "Body" })).toBeInTheDocument();
  });
});
