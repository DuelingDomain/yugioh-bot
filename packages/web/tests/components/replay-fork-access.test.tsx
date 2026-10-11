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
