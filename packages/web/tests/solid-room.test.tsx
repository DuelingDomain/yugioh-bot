// @vitest-environment jsdom
// ?view=3d: the room renders the Solid Vision table through the real field logic; classic stays the default.
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DuelRoom } from "@yugidraft/shared/duels";

const { state, mutate } = vi.hoisted(() => ({ state: { room: null as DuelRoom | null }, mutate: vi.fn(async () => {}) }));
vi.mock("swr", () => ({ default: () => ({ data: state.room, error: null, isLoading: false, mutate }) }));
vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));
vi.mock("@/lib/hooks/use-duel-websocket", () => ({ useDuelWebsocket: () => ({ syncing: false, recovering: false, connected: true, presence: null, resync: vi.fn() }) }));
vi.mock("@/lib/hooks/use-duel-leave-guard", () => ({ useDuelLeaveGuard: vi.fn() }));
vi.mock("@/components/duel/use-start-beats", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/components/duel/use-start-beats")>(),
  useStartBeats: () => ({ active: false, dealing: false, phase: undefined, replayFrom: null, skipThrough: null, waiting: false }),
}));
vi.mock("@/components/duel/prompt-reveal", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/components/duel/prompt-reveal")>(), usePromptReveal: () => true,
}));
vi.mock("@/components/duel/feedback", () => ({ DuelFeedback: () => null }));
vi.mock("@/components/duel/summon-fx", () => ({ SummonFx: () => null }));
vi.mock("@/components/duel/move-fx", () => ({ MoveFx: () => null }));
vi.mock("@/components/duel/position-fx", () => ({ PositionFx: () => null }));
vi.mock("@/components/duel/chain-fx", () => ({ ChainFx: () => null }));
vi.mock("@/components/duel/master-return-fx", () => ({ MasterReturnFx: () => null }));
vi.mock("@/components/duel/battle-fx", () => ({ BattleFx: () => null }));
vi.mock("@/components/duel/destroy-fx", () => ({ DestroyFx: () => null }));
vi.mock("@/components/decks/api", () => ({ listSavedDecks: vi.fn(async () => []) }));
import { DuelRoomView } from "@/components/duel/room";
import { solidRoom } from "./helpers/solid-board";


beforeEach(() => {
  window.localStorage.clear();
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: false, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("3D mode room", () => {
  it("keeps the classic board unless 3D mode is asked for", () => {
    state.room = solidRoom();
    const { container } = render(<DuelRoomView slug="solid" />);
    expect(container.querySelector("[data-look=solid]")).toBeNull();
    expect(container.querySelector("[data-duel-field]")).not.toBeNull();
  });

  it("renders the solid table with ?view=3d, with both clocks and the plane", async () => {
    state.room = solidRoom({ domain: true });
    state.room.clock = { serverNow: 1000, turn: 3, remainingMs: [120000, 90000], activeSeat: 0, startedAt: 1000 };
    const { container } = render(<DuelRoomView slug="solid" viewOverride="3d" />);
    await screen.findByLabelText("Duel field");
    const root = container.querySelector("[data-look=solid]") as HTMLElement;
    expect(root.getAttribute("data-view")).toBe("tilt");
    expect(root.getAttribute("data-domain")).toBe("true");
    expect(container.querySelectorAll("[data-duel-field]")).toHaveLength(1);
    expect(container.querySelector("[data-sv-plane]")).not.toBeNull();
    expect(container.querySelector('[data-sv-clock="opp"]')).not.toBeNull();
    expect(container.querySelector('[data-sv-clock="you"]')).not.toBeNull();
    // One clock per seat stays in the plane gaps, never on the phase bar; the header also shows the top-left block
    // with every seat's clock (the answering seat marked).
    expect(container.querySelectorAll('[data-sv-clock] [role=timer]')).toHaveLength(2);
    const bank = container.querySelector('header [role=timer][data-count="2"]') as HTMLElement;
    expect(bank.querySelectorAll('[data-testid="clock-cell"]')).toHaveLength(2);
    expect(bank.querySelectorAll('[data-active="true"]')).toHaveLength(1);
    expect(container.querySelectorAll('[role=timer]')).toHaveLength(3);
    expect(container.querySelectorAll("[data-hand-seat]").length).toBe(2);
    expect(container.querySelectorAll("[data-zones]").length).toBeGreaterThan(20);
    // Brand text: the 3D header says Dueling Domain, never Yugidraft.
    expect(screen.getByRole("link", { name: "Dueling Domain" }).getAttribute("href")).toBe("/duels");
    expect(container.textContent ?? "").not.toMatch(/yugidraft/i);
  });

  it("reads the Flat setting from the store", async () => {
    window.localStorage.setItem("yugidraft.duelBoardView.v1", JSON.stringify({ v: 1, mode: "3d", tilt: "flat" }));
    state.room = solidRoom();
    const { container } = render(<DuelRoomView slug="solid" />);
    await screen.findByLabelText("Duel field");
    expect((container.querySelector("[data-look=solid]") as HTMLElement).getAttribute("data-view")).toBe("flat");
  });
});
