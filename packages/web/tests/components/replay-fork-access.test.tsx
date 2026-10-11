// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SWRConfig } from "swr";
import type { DuelRoom, ReplayForkControl } from "@yugidraft/shared/duels";
import { resetCoinTossState } from "@/components/duel/coin-toss-lock";
import { frame, session } from "./replay-fixtures";

// The real SWR is used here on purpose: the laggy "previous data" fallback is part of what this file proves is gone.
vi.mock("next/font/google", () => {
  const font = () => ({ variable: "font-var", className: "font-class" });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));
const nav = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => nav, usePathname: () => "/", useSearchParams: () => new URLSearchParams() }));
vi.mock("@/lib/hooks/use-duel-websocket", () => ({
  useDuelWebsocket: () => ({ syncing: false, recovering: false, connected: true, presence: null, resync: vi.fn() }),
}));
vi.mock("@/lib/hooks/use-duel-leave-guard", () => ({ useDuelLeaveGuard: vi.fn() }));
vi.mock("@/components/duel/field", () => ({
  DuelField: (props: { onInspect?: (target: { type: "pile"; title: string; cards: [] }) => void }) => (
    <div data-testid="field">
      <button type="button" onClick={() => props.onInspect?.({ type: "pile", title: "Private hand", cards: [] })}>Inspect fixture hand</button>
    </div>
  ),
  DeckMasterRail: () => null,
}));
for (const name of ["feedback:DuelFeedback", "summon-fx:SummonFx", "move-fx:MoveFx", "position-fx:PositionFx", "chain-fx:ChainFx",
  "master-return-fx:MasterReturnFx", "battle-fx:BattleFx", "destroy-fx:DestroyFx"]) {
  const [file, exported] = name.split(":");
  vi.doMock(`@/components/duel/${file}`, () => ({ [exported!]: () => null }));
}

import { DuelRoomView } from "@/components/duel/room";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const control = (over: Partial<ReplayForkControl> = {}): ReplayForkControl => ({
  identitySeat: 0, actingSeat: 0, manualSeats: [0, 1], revealHands: true, chainModes: { 0: "auto", 1: "auto" },
  origin: { sourceSlug: "game-1", sourceFrameId: "f2", sourceStep: 2, sourceSeats: [{ seat: 0, displayName: "Ada" }, { seat: 1, displayName: "Bo" }] },
  ...over,
});
const forkRoom = (fork: ReplayForkControl = control()): DuelRoom => ({
  session: session("1v1", { slug: "fork-1", kind: "replay-fork", status: "active", endedAt: null }),
  role: "player", mySeat: 0, myDeck: null, engine: { ...frame({ step: 2 }).view, prioritySeat: 1 },
  clock: null, metadataOnly: false, fork,
});

beforeEach(() => {
  resetCoinTossState();
  window.localStorage.clear();
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: false, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); resetCoinTossState(); });

describe("a fork view that loses access", () => {
  it("drops the private view for good: no laggy fallback, no cached key left, and it only returns for a newer room", async () => {
    let refuse = true;
    const urls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string) => {
      urls.push(input);
      if (input === "/api/duels/fork-1") return json(forkRoom());
      return refuse ? json({ error: "No access", code: "ACCESS_DENIED" }, 404) : json(forkRoom(control({ actingSeat: 1 })));
    }));
    const cache = new Map();
    render(
      <SWRConfig value={{ provider: () => cache, dedupingInterval: 0 }}>
        <DuelRoomView slug="fork-1" />
      </SWRConfig>,
    );
    await screen.findByTestId("field");
    fireEvent.click(screen.getByRole("button", { name: "Inspect fixture hand" }));
    expect(screen.getByText("Private hand")).toBeTruthy();

    // The creator picks seat 1; the host refuses that view. The room that was cached for seat 0 must not stand in for it.
    fireEvent.click(within(screen.getByRole("group", { name: "Acting seat" })).getByRole("button", { name: /Bo/ }));
    await waitFor(() => expect(urls).toContain("/api/duels/fork-1?as=1"));
    await waitFor(() => expect(screen.queryByTestId("field")).toBeNull());
    expect(document.querySelector("[data-replay-fork-bar]")).toBeNull();
    expect(screen.queryByText("Private hand")).toBeNull();
    // Give any laggy or revalidated copy time to come back; it must not.
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(screen.queryByTestId("field")).toBeNull();
    expect(screen.queryByText("Private hand")).toBeNull();
    for (const [key, value] of cache) {
      if (typeof key === "string" && key.startsWith("$") === false && key.includes("/api/duels/fork-1")) {
        expect((value as { data?: unknown }).data).toBeUndefined();
      }
    }

    // Access comes back and the viewer asks again: a room that arrived after the refusal shows.
    refuse = false;
    fireEvent.click(await screen.findByRole("button", { name: "Retry" }));
    await screen.findByTestId("field");
    expect(document.querySelector("[data-replay-fork-bar]")).not.toBeNull();
  });
});

// The default dedupingInterval (2 s) is kept on purpose: it is what the app runs with.
describe("a fork view that is asked for again within the dedupe window", () => {
  const fetchBySeat = (urls: string[]) => vi.fn(async (input: string) => {
    urls.push(input);
    const as = new URL(input, "http://x").searchParams.get("as");
    return json(forkRoom(control({ actingSeat: as === "1" ? 1 : 0 })));
  });
  const chip = (name: RegExp) => within(screen.getByRole("group", { name: "Acting seat" })).getByRole("button", { name });

  it("settles: plain -> as=1 -> plain within 2 s is not left on catching up", async () => {
    const urls: string[] = [];
    vi.stubGlobal("fetch", fetchBySeat(urls));
    render(
      <SWRConfig value={{ provider: () => new Map() }}>
        <DuelRoomView slug="fork-1" />
      </SWRConfig>,
    );
    await screen.findByTestId("field");
    await waitFor(() => expect((chip(/Bo/) as HTMLButtonElement).disabled).toBe(false));
    const plainFetches = () => urls.filter((url) => url === "/api/duels/fork-1").length;
    const before = plainFetches();

    fireEvent.click(chip(/Bo/));
    await waitFor(() => expect(urls).toContain("/api/duels/fork-1?as=1"));
    await waitFor(() => expect((chip(/Bo/) as HTMLButtonElement).getAttribute("aria-pressed")).toBe("true"));
    // Back to Follow within the dedupe window: the plain view was fetched less than 2 s ago.
    fireEvent.click(screen.getByRole("button", { name: /Fork controls/ }));
    // Follow is on; turning it off holds seat 1 (same view), turning it on again returns to the plain view.
    fireEvent.click(within(screen.getByRole("dialog")).getByLabelText("Follow prompt"));
    fireEvent.click(within(screen.getByRole("dialog")).getByLabelText("Follow prompt"));
    await waitFor(() => expect(plainFetches()).toBeGreaterThan(before));
    // The table is not stuck: seat chips work again and the plain view is on screen.
    await waitFor(() => expect((chip(/Ada/) as HTMLButtonElement).disabled).toBe(false), { timeout: 1500 });
    expect(chip(/Ada/).getAttribute("aria-pressed")).toBe("true");
  });

  it("sends one room request for each view change", async () => {
    const urls: string[] = [];
    vi.stubGlobal("fetch", fetchBySeat(urls));
    render(
      <SWRConfig value={{ provider: () => new Map() }}>
        <DuelRoomView slug="fork-1" />
      </SWRConfig>,
    );
    await screen.findByTestId("field");
    await waitFor(() => expect((chip(/Bo/) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(chip(/Bo/));
    await waitFor(() => expect((chip(/Bo/) as HTMLButtonElement).getAttribute("aria-pressed")).toBe("true"));
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(urls.filter((url) => url === "/api/duels/fork-1?as=1")).toHaveLength(1);
  });

  it("does not flash the no-access screen on later seat switches once access is back", async () => {
    let refuse = false;
    let calls = 0;
    vi.stubGlobal("fetch", vi.fn(async (input: string) => {
      calls += 1;
      if (refuse) return json({ error: "No access", code: "ACCESS_DENIED" }, 404);
      const as = new URL(input, "http://x").searchParams.get("as");
      return json(forkRoom(control({ actingSeat: as === "1" ? 1 : 0 })));
    }));
    render(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <DuelRoomView slug="fork-1" />
      </SWRConfig>,
    );
    await screen.findByTestId("field");
    refuse = true;
    fireEvent.click(chip(/Bo/));
    await waitFor(() => expect(screen.queryByTestId("field")).toBeNull());
    refuse = false;
    fireEvent.click(await screen.findByRole("button", { name: "Retry" }));
    await screen.findByTestId("field");
    // Watch every frame of the next switches: the refusal screen must not come back, even for one render.
    let flashed = false;
    const watch = new MutationObserver(() => { if (screen.queryByRole("button", { name: "Retry" })) flashed = true; });
    watch.observe(document.body, { childList: true, subtree: true });
    const before = calls;
    // The refused pick (seat 1) is the view that came back; the next switches go to seat 0 and back.
    fireEvent.click(chip(/Ada/));
    await waitFor(() => expect(calls).toBeGreaterThan(before));
    await waitFor(() => expect(chip(/Ada/).getAttribute("aria-pressed")).toBe("true"));
    fireEvent.click(chip(/Bo/));
    await waitFor(() => expect(chip(/Bo/).getAttribute("aria-pressed")).toBe("true"));
    watch.disconnect();
    expect(flashed).toBe(false);
  });
});

