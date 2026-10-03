// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DuelRoom } from "@yugidraft/shared/duels";
import { makeSeriesRoom } from "../helpers/duel-series";
import { newBoard } from "@/components/duel/fx-lab/board";

const { state, mutate, sendDuelAction, startBeats } = vi.hoisted(() => ({
  state: { room: null as DuelRoom | null, error: null as Error | null, recovering: false, syncing: false, beats: false, revealed: true },
  mutate: vi.fn(async () => {}), sendDuelAction: vi.fn(), startBeats: vi.fn(),
}));
vi.mock("swr", () => ({ default: () => ({ data: state.room, error: state.error, isLoading: false, mutate }) }));
vi.mock("next/font/google", () => {
  const font = () => ({ variable: "font-var", className: "font-class" });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});
vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));
vi.mock("@/lib/hooks/use-duel-websocket", () => ({ useDuelWebsocket: () => ({ syncing: state.syncing, recovering: state.recovering, connected: true, presence: null, resync: vi.fn() }) }));
vi.mock("@/lib/hooks/use-duel-leave-guard", () => ({ useDuelLeaveGuard: vi.fn() }));
vi.mock("@/components/duel/use-start-beats", () => ({ useStartBeats: startBeats }));
vi.mock("@/components/duel/prompt-reveal", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/components/duel/prompt-reveal")>(), usePromptReveal: () => state.revealed,
}));
vi.mock("@/components/duel/field", () => ({
  DuelField: ({ priorityLive }: { priorityLive?: boolean }) => <div data-testid="priority" data-live={String(priorityLive)} />,
  DeckMasterRail: () => null,
}));
vi.mock("@/components/duel/prompt-center", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/components/duel/prompt-center")>(),
  PromptCenter: ({ revealed, onSubmit }: { revealed: boolean; onSubmit: (answer: { choice: string }) => void }) =>
    <button data-testid="panel" data-revealed={String(revealed)} onClick={() => onSubmit({ choice: "pass" })}>Respond</button>,
  centerKind: () => "choice",
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
vi.mock("@/components/duel/api", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/components/duel/api")>(), sendDuelAction,
}));
import { DuelRoomView } from "@/components/duel/room";

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: false, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  Object.assign(state, { error: null, recovering: false, syncing: false, beats: false, revealed: true });
  startBeats.mockImplementation(() => ({ active: state.beats, phase: undefined, replayFrom: null, waiting: false }));
  state.room = makeSeriesRoom({ series: null, status: "active", mySeat: 0 });
  state.room.engine = { revision: 1, turn: 2, turnSeat: 1, phase: "main1", seats: newBoard().seats,
    prioritySeat: 0, prompt: { id: "p1", seat: 0, kind: "choice", title: "Respond?", options: [{ id: "pass", label: "Pass" }] },
    chain: [], events: [], log: [], result: null };
});
let openSpy: { mockRestore(): void } | null = null;
afterEach(() => {
  cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); window.name = "";
  openSpy?.mockRestore(); openSpy = null;
});
const live = () => screen.getByTestId("priority").getAttribute("data-live");

describe("room header", () => {
  it("links the duel menu as Duelists Kingdom", () => {
    render(<DuelRoomView slug="game-1" windowed />);
    expect(screen.getByRole("link", { name: "Duelists Kingdom" }).getAttribute("href")).toBe("/duels");
    expect(screen.queryByText(/yugidraft/i)).toBeNull();
  });
});

describe("room priority gate", () => {
  it("mounts the card layers at once when the player lands on the duel outside the duel window", () => {
    state.room!.engine!.revision = 0;
    state.room!.engine!.turn = 1;
    render(<DuelRoomView slug="game-2" />);
    expect(screen.queryByTestId("duel-window-gate")).toBeNull();
    expect(screen.getByTestId("priority")).toBeTruthy();
    expect(startBeats.mock.lastCall?.[0].ready).toBe(true);
  });

  it("shows the own-window screen after Pop out, and the board again after Open here instead", () => {
    const popupWindow = { closed: false, location: { href: "about:blank" }, focus: vi.fn() };
    const open = vi.spyOn(window, "open").mockReturnValue(popupWindow as unknown as Window);
    openSpy = open;
    render(<DuelRoomView slug="game-3" />);
    fireEvent.click(screen.getByRole("button", { name: "Pop out" }));
    expect(open).toHaveBeenCalledWith("", "yugidraft-duel-game-3");
    expect(popupWindow.location.href).toBe("/duels/game-3?window=1");
    expect(screen.getByTestId("duel-window-gate")).toBeTruthy();
    expect(screen.queryByTestId("priority")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Open here instead" }));
    expect(screen.getByTestId("priority")).toBeTruthy();
  });

  it("keeps the own-window screen after a remount, so a second board never opens next to the pop-up", () => {
    const popupWindow = { closed: false, name: "yugidraft-duel-bo3-1", location: { href: "about:blank" }, focus: vi.fn() };
    openSpy = vi.spyOn(window, "open").mockReturnValue(popupWindow as unknown as Window);
    const first = render(<DuelRoomView slug="bo3-1" />);
    fireEvent.click(screen.getByRole("button", { name: "Pop out" }));
    expect(screen.getByTestId("duel-window-gate")).toBeTruthy();
    first.unmount();
    // Back from the tables list: same duel, fresh mount.
    const again = render(<DuelRoomView slug="bo3-1" />);
    expect(screen.getByTestId("duel-window-gate")).toBeTruthy();
    expect(screen.queryByTestId("priority")).toBeNull();
    again.unmount();
    // Game 2 of the series: the window follows and names itself for the new game.
    popupWindow.name = "yugidraft-duel-bo3-2";
    render(<DuelRoomView slug="bo3-2" />);
    expect(screen.getByTestId("duel-window-gate")).toBeTruthy();
    expect(screen.queryByTestId("priority")).toBeNull();
  });

  it("says so when the browser blocks Pop out, and keeps the board", () => {
    vi.useFakeTimers();
    openSpy = vi.spyOn(window, "open").mockReturnValue(null);
    render(<DuelRoomView slug="game-7" />);
    fireEvent.click(screen.getByRole("button", { name: "Pop out" }));
    expect(screen.getByText("Your browser blocked the window.").getAttribute("role")).toBe("status");
    expect(screen.getByTestId("priority")).toBeTruthy();
    act(() => { vi.advanceTimersByTime(4100); });
    expect(screen.queryByText("Your browser blocked the window.")).toBeNull();
  });

  it("closes the duel window when the player chooses Open here instead", () => {
    const popupWindow = { closed: false, name: "yugidraft-duel-game-8", location: { href: "about:blank" }, focus: vi.fn(),
      close: vi.fn(() => { popupWindow.closed = true; }) };
    openSpy = vi.spyOn(window, "open").mockReturnValue(popupWindow as unknown as Window);
    const first = render(<DuelRoomView slug="game-8" />);
    fireEvent.click(screen.getByRole("button", { name: "Pop out" }));
    fireEvent.click(screen.getByRole("button", { name: "Open here instead" }));
    expect(popupWindow.close).toHaveBeenCalledOnce();
    expect(screen.getByTestId("priority")).toBeTruthy();
    expect(screen.queryByTestId("duel-window-gate")).toBeNull();
    // A remount does not find the closed window again.
    first.unmount();
    render(<DuelRoomView slug="game-8" />);
    expect(screen.queryByTestId("duel-window-gate")).toBeNull();
  });

  it("keeps the board and offers no Pop out inside the duel window", () => {
    render(<DuelRoomView slug="game-1" windowed />);
    expect(screen.queryByRole("button", { name: "Pop out" })).toBeNull();
    expect(screen.getByTestId("priority")).toBeTruthy();
  });

  it("brings the board back in this tab when the duel window is closed", () => {
    vi.useFakeTimers();
    const popupWindow = { closed: false, location: { href: "about:blank" }, focus: vi.fn() };
    openSpy = vi.spyOn(window, "open").mockReturnValue(popupWindow as unknown as Window);
    render(<DuelRoomView slug="game-4" />);
    fireEvent.click(screen.getByRole("button", { name: "Pop out" }));
    expect(screen.getByTestId("duel-window-gate")).toBeTruthy();
    popupWindow.closed = true;
    act(() => { vi.advanceTimersByTime(1100); });
    expect(screen.queryByTestId("duel-window-gate")).toBeNull();
    expect(screen.getByTestId("priority")).toBeTruthy();
  });

  it("shares the local prompt reveal with the field", () => {
    state.revealed = false;
    const { rerender } = render(<DuelRoomView slug="game-1" windowed />);
    expect(live()).toBe("false");
    expect(screen.getByTestId("panel").getAttribute("data-revealed")).toBe("false");
    state.revealed = true;
    rerender(<DuelRoomView slug="game-1" windowed />);
    expect(live()).toBe("true");
    expect(screen.getByTestId("panel").getAttribute("data-revealed")).toBe("true");
  });

  it.each(["recovering", "syncing", "beats", "error"] as const)("clears priority while %s", (reason) => {
    const { rerender } = render(<DuelRoomView slug="game-1" windowed />);
    expect(live()).toBe("true");
    if (reason === "error") state.error = new Error("Connection lost");
    else state[reason] = true;
    rerender(<DuelRoomView slug="game-1" windowed />);
    expect(live()).toBe("false");
  });

  it("clears stale priority while an answer is in flight", async () => {
    let finish!: () => void;
    sendDuelAction.mockImplementation(() => new Promise<void>((resolve) => { finish = resolve; }));
    render(<DuelRoomView slug="game-1" windowed />);
    expect(live()).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Respond" }));
    expect(sendDuelAction).toHaveBeenCalled();
    expect(live()).toBe("false");
    await act(async () => { finish(); });
    expect(live()).toBe("true");
  });

  it("does not use the local reveal for a private opponent prompt", () => {
    state.room!.engine!.prioritySeat = 1;
    state.room!.engine!.prompt = null;
    state.revealed = false;
    render(<DuelRoomView slug="game-1" windowed />);
    expect(live()).toBe("true");
  });
});
