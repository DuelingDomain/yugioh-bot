// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DraftInviteGate } from "../../src/components/draft/invite-gate";
import { readInviteParam, signInHref, stripInviteParam } from "../../src/lib/draft-invite";

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router, useParams: () => ({ slug: "night" }) }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));

/** Everything the landing does, in order: network calls and history writes. */
let events: string[];
let redeemStatus = 200;
let redeemHeaders: Record<string, string> = {};

function Body() {
  React.useEffect(() => {
    events.push(`mount@${window.location.pathname}${window.location.search}${window.location.hash}`);
    void fetch("/api/drafts/night");
  }, []);
  return <h1>Lobby</h1>;
}

beforeEach(() => {
  events = [];
  redeemStatus = 200;
  redeemHeaders = {};
  router.push.mockReset();
  window.history.replaceState(null, "", "/draft/night?invite=ABC123");
  const real = window.history.replaceState.bind(window.history);
  vi.spyOn(window.history, "replaceState").mockImplementation((state, unused, url) => {
    events.push(`replaceState ${String(url)}`);
    real(state, unused, url);
  });
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    events.push(`${method} ${String(input)}${init?.body ? ` ${init.body}` : ""}`);
    if (method === "POST") {
      return new Response(JSON.stringify(redeemStatus === 200 ? { ok: true } : { error: "x" }), { status: redeemStatus, headers: redeemHeaders });
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

describe("invite landing order", () => {
  it("redeems, then strips the invite, then mounts the page that reads the draft", async () => {
    render(<DraftInviteGate slug="night"><Body /></DraftInviteGate>);
    expect(await screen.findByRole("heading", { name: "Lobby" })).toBeInTheDocument();
    await waitFor(() => expect(events).toContain("GET /api/drafts/night"));
    expect(events).toEqual([
      'POST /api/drafts/night/invite {"code":"ABC123"}',
      "replaceState /draft/night",
      "mount@/draft/night",
      "GET /api/drafts/night",
    ]);
    expect(window.location.search).toBe("");
  });

  it("requests nothing protected while the redeem is still running", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      events.push(`${init?.method ?? "GET"} ${String(input)}`);
      if (init?.method === "POST") await gate;
      return Response.json({ ok: true });
    }));
    render(<DraftInviteGate slug="night"><Body /></DraftInviteGate>);
    expect(await screen.findByText("Opening your invite…")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Lobby" })).toBeNull();
    expect(events).toEqual(["POST /api/drafts/night/invite"]);
    await act(async () => { release(); });
    expect(await screen.findByRole("heading", { name: "Lobby" })).toBeInTheDocument();
  });

  it("makes one redeem request even when the landing mounts twice, as React strict mode does", async () => {
    render(<React.StrictMode><DraftInviteGate slug="night"><Body /></DraftInviteGate></React.StrictMode>);
    await screen.findByRole("heading", { name: "Lobby" });
    expect(events.filter((e) => e.startsWith("POST"))).toHaveLength(1);
  });

  it("keeps other parameters and the hash when it strips only invite", async () => {
    window.history.replaceState(null, "", "/draft/night?a=1&invite=ABC123&b=2#seats");
    events = [];
    render(<DraftInviteGate slug="night"><Body /></DraftInviteGate>);
    await screen.findByRole("heading", { name: "Lobby" });
    expect(events).toContain("replaceState /draft/night?a=1&b=2#seats");
    expect(window.location.search).toBe("?a=1&b=2");
    expect(window.location.hash).toBe("#seats");
  });

  it("mounts the page at once, with no redeem, when the address has no invite", async () => {
    window.history.replaceState(null, "", "/draft/night");
    events = [];
    render(<DraftInviteGate slug="night"><Body /></DraftInviteGate>);
    await screen.findByRole("heading", { name: "Lobby" });
    expect(events.some((e) => e.startsWith("POST"))).toBe(false);
    expect(events.some((e) => e.startsWith("replaceState"))).toBe(false);
  });
});

describe("invite landing failures", () => {
  it("on 404 strips the expired invite and mounts the body so its own access check decides", async () => {
    redeemStatus = 404;
    window.history.replaceState(null,"","/draft/night?invite=ABC123&x=1#top");
    events=[];
    render(<DraftInviteGate slug="night"><Body /></DraftInviteGate>);
    expect(await screen.findByRole("heading",{name:"Lobby"})).toBeInTheDocument();
    expect(events).toEqual([
      'POST /api/drafts/night/invite {"code":"ABC123"}',
      'replaceState /draft/night?x=1#top',
      'mount@/draft/night?x=1#top',
      'GET /api/drafts/night',
    ]);
    expect(window.location.search).toBe("?x=1");
  });

  it("on 429 says to try again in a moment, never retries by itself, and retries once on the button", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    redeemStatus = 429;
    redeemHeaders = { "Retry-After": "12" };
    render(<DraftInviteGate slug="night"><Body /></DraftInviteGate>);
    expect(await screen.findByRole("heading", { name: "Try again in a moment" })).toBeInTheDocument();
    expect(screen.getByText(/12 seconds/)).toBeInTheDocument();
    await act(async () => { vi.advanceTimersByTime(60_000); });
    expect(events.filter((e) => e.startsWith("POST"))).toHaveLength(1);
    expect(events.some((e) => e.startsWith("GET"))).toBe(false);

    redeemStatus = 200;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("heading", { name: "Lobby" })).toBeInTheDocument();
    expect(events.filter((e) => e.startsWith("POST"))).toHaveLength(2);
    vi.useRealTimers();
  });

  it("on another failure offers Try again without claiming the draft is missing", async () => {
    redeemStatus = 500;
    render(<DraftInviteGate slug="night"><Body /></DraftInviteGate>);
    expect(await screen.findByRole("heading", { name: "This invite didn't open" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Draft not found" })).toBeNull();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  it("on 401 sends the visitor to sign in and back to this exact address, invite included", async () => {
    redeemStatus = 401;
    window.history.replaceState(null, "", "/draft/night?invite=ABC123&x=1");
    render(<DraftInviteGate slug="night"><Body /></DraftInviteGate>);
    await waitFor(() => expect(router.push).toHaveBeenCalledTimes(1));
    const href = router.push.mock.calls[0][0] as string;
    expect(href).toBe(`/sign-in?redirect_url=${encodeURIComponent("/draft/night?invite=ABC123&x=1")}`);
    expect(new URL(href, "http://x").searchParams.get("redirect_url")).toBe("/draft/night?invite=ABC123&x=1");
  });
});

describe("address helpers", () => {
  it("reads the invite value and nothing else", () => {
    window.history.replaceState(null, "", "/draft/night?invite=Zz9&other=1");
    expect(readInviteParam()).toBe("Zz9");
    window.history.replaceState(null, "", "/draft/night?other=1");
    expect(readInviteParam()).toBeNull();
  });

  it("does not write history when there is no invite to strip", () => {
    window.history.replaceState(null, "", "/draft/night?other=1");
    (window.history.replaceState as unknown as { mockClear(): void }).mockClear?.();
    events = [];
    stripInviteParam();
    expect(events).toEqual([]);
  });

  it("builds a sign-in link that returns to the same path, query and hash", () => {
    window.history.replaceState(null, "", "/draft/night?invite=A%26B#top");
    expect(signInHref()).toBe(`/sign-in?redirect_url=${encodeURIComponent("/draft/night?invite=A%26B#top")}`);
  });
});
