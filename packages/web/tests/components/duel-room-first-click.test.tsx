// @vitest-environment jsdom
import React from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DuelRoom } from "@yugidraft/shared/duels";
import { makeSeriesRoom } from "../helpers/duel-series";
import { newBoard } from "@/components/duel/fx-lab/board";

// One click on a prompt button must act at once: a routine re-read of the room (a change notice that is not the
// player's own echo, a window focus, a clock tick) is not a reason to shut the buttons.
const { state, mutate, sendDuelAction, startBeats } = vi.hoisted(() => ({
  state: { room: null as DuelRoom | null, recovering: false, syncing: false, beats: false },
  mutate: vi.fn(async () => {}), sendDuelAction: vi.fn(), startBeats: vi.fn(),
}));
vi.mock("swr", () => ({ default: () => ({ data: state.room, error: null, isLoading: false, mutate }) }));
vi.mock("next/font/google", () => {
  const font = () => ({ variable: "font-var", className: "font-class" });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});
vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));
vi.mock("@/lib/hooks/use-duel-websocket", () => ({ useDuelWebsocket: () => ({ syncing: state.syncing, recovering: state.recovering, connected: true, presence: null, resync: vi.fn() }) }));
vi.mock("@/lib/hooks/use-duel-leave-guard", () => ({ useDuelLeaveGuard: vi.fn() }));
vi.mock("@/components/duel/use-start-beats", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/components/duel/use-start-beats")>(), useStartBeats: startBeats,
}));
vi.mock("@/components/duel/prompt-reveal", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/components/duel/prompt-reveal")>(), usePromptReveal: () => true,
}));
vi.mock("@/components/duel/field", () => ({ DuelField: () => <div />, DeckMasterRail: () => null }));
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

function roomWithPrompt(clockTick = 0): DuelRoom {
  const room = makeSeriesRoom({ series: null, status: "active", mySeat: 0 });
  room.engine = { revision: 1, turn: 2, turnSeat: 0, phase: "battle", seats: newBoard().seats,
    prioritySeat: 0, chain: [], events: [], log: [], result: null,
    prompt: { id: "p1", seat: 0, kind: "choice", title: "Return this Deck Master to the Deck Master Zone?",
      options: [{ id: "yes", label: "Yes" }, { id: "no", label: "No" }] } };
  return { ...room, serverTime: 1_000 + clockTick } as DuelRoom;
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: false, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  Object.assign(state, { recovering: false, syncing: false, beats: false });
  startBeats.mockImplementation(() => ({ active: state.beats, phase: undefined, replayFrom: null, waiting: false }));
  sendDuelAction.mockResolvedValue(undefined);
  state.room = roomWithPrompt();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("first click on a prompt button", () => {
  it("answers on the first click", async () => {
    render(<DuelRoomView slug="game-1" windowed />);
    await userEvent.click(await screen.findByRole("button", { name: "Yes" }));
    expect(sendDuelAction).toHaveBeenCalledTimes(1);
    expect(sendDuelAction.mock.calls[0][1]).toMatchObject({ promptId: "p1", answer: { choice: "yes" } });
  });

  it("answers on the first click while the room re-reads for a change notice that is not the player's echo", async () => {
    state.syncing = true;
    render(<DuelRoomView slug="game-1" windowed />);
    const yes = await screen.findByRole("button", { name: "Yes" });
    expect((yes as HTMLButtonElement).disabled).toBe(false);
    await userEvent.click(yes);
    expect(sendDuelAction).toHaveBeenCalledTimes(1);
  });

  it("keeps a press that straddles the start of a re-read", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<DuelRoomView slug="game-1" windowed />);
    const yes = await screen.findByRole("button", { name: "Yes" });
    await user.pointer({ keys: "[MouseLeft>]", target: yes });
    state.syncing = true;
    rerender(<DuelRoomView slug="game-1" windowed />);
    await user.pointer({ keys: "[/MouseLeft]", target: yes });
    expect(sendDuelAction).toHaveBeenCalledTimes(1);
  });

  it("keeps the same button across a clock tick and a prompt refresh, so the press is not lost", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<DuelRoomView slug="game-1" windowed />);
    const yes = await screen.findByRole("button", { name: "Yes" });
    await user.pointer({ keys: "[MouseLeft>]", target: yes });
    state.syncing = true;
    state.room = roomWithPrompt(1);
    rerender(<DuelRoomView slug="game-1" windowed />);
    state.syncing = false;
    state.room = roomWithPrompt(2);
    rerender(<DuelRoomView slug="game-1" windowed />);
    expect(screen.getByRole("button", { name: "Yes" })).toBe(yes);
    await user.pointer({ keys: "[/MouseLeft]", target: yes });
    expect(sendDuelAction).toHaveBeenCalledTimes(1);
  });

  it("still holds the buttons while the connection recovers", async () => {
    state.recovering = true;
    render(<DuelRoomView slug="game-1" windowed />);
    await act(async () => {});
    const yes = screen.queryByRole("button", { name: "Yes" });
    if (yes) await userEvent.click(yes);
    expect(sendDuelAction).not.toHaveBeenCalled();
  });
});
