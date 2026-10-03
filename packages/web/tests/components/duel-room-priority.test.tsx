// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DuelRoom } from "@yugidraft/shared/duels";
import { makeSeriesRoom } from "../helpers/duel-series";
import { newBoard } from "@/components/duel/fx-lab/board";

const { state, mutate, sendDuelAction } = vi.hoisted(() => ({
  state: { room: null as DuelRoom | null, error: null as Error | null, recovering: false, syncing: false, beats: false, revealed: true },
  mutate: vi.fn(async () => {}), sendDuelAction: vi.fn(),
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
vi.mock("@/components/duel/use-start-beats", () => ({ useStartBeats: () => ({ active: state.beats, phase: undefined, replayFrom: null, waiting: false }) }));
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
  state.room = makeSeriesRoom({ series: null, status: "active", mySeat: 0 });
  state.room.engine = { revision: 1, turn: 2, turnSeat: 1, phase: "main1", seats: newBoard().seats,
    prioritySeat: 0, prompt: { id: "p1", seat: 0, kind: "choice", title: "Respond?", options: [{ id: "pass", label: "Pass" }] },
    chain: [], events: [], log: [], result: null };
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const live = () => screen.getByTestId("priority").getAttribute("data-live");

describe("room priority gate", () => {
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
