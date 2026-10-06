// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { DuelPrompt, DuelRoom } from "@yugidraft/shared/duels";

const state = vi.hoisted(() => ({ room: undefined as DuelRoom | undefined, send: vi.fn().mockResolvedValue(undefined), mutate: vi.fn(), replace: vi.fn() }));
vi.mock("next/font/google", () => {
  const font = () => ({ className: "font", variable: "font-var" });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: state.replace }), useSearchParams: () => new URLSearchParams() }));
vi.mock("swr", () => ({ default: () => ({ data: state.room, isLoading: false, mutate: state.mutate }) }));
vi.mock("@/lib/hooks/use-duel-websocket", () => ({ useDuelWebsocket: () => ({ connected: true, syncing: false, recovering: false, presence: null, resync: vi.fn() }) }));
vi.mock("@/lib/hooks/use-duel-leave-guard", () => ({ useDuelLeaveGuard: vi.fn() }));
vi.mock("@/components/duel/api", async original => ({ ...await original<object>(), sendDuelAction: state.send,
  reportEnabled: vi.fn().mockResolvedValue(false), getDuelRoom: async () => state.room, listDuelPresets: async () => ({ presets: [] }) }));
import { DuelRoomView } from "@/components/duel/room";
import { solidFixture } from "@/components/duel/solid/fixtures/states";
import { cardAt, HAND } from "@/components/duel/table/fixtures/common";
import { LOCATION_DMZONE } from "@/components/duel/constants";
import { clearPromptRevealHold, holdPromptReveal } from "@/components/duel/prompt-reveal";

const jet = { code: 30576089, name: "Blue-Eyes Jet Dragon", description: "Special Summon this card from your hand or GY.", type: 33, attack: 3000, defense: 0, level: 8, attribute: 16, race: "Dragon" };
beforeAll(() => {
  class RO { observe() {} disconnect() {} unobserve() {} }
  vi.stubGlobal("ResizeObserver", RO);
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} }));
  HTMLElement.prototype.getAnimations = () => [];
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 1100 });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 860 });
});
beforeEach(() => { vi.clearAllMocks(); vi.useFakeTimers(); clearPromptRevealHold(); });
afterEach(() => { cleanup(); clearPromptRevealHold(); vi.useRealTimers(); window.localStorage.clear(); });

function room(seat: number, chain: boolean) {
  const source = structuredClone(solidFixture("m1").room);
  const prompt: DuelPrompt = chain ? {
    id: "hand-chain", seat, kind: "choice", title: "Select a chain link or pass", cancelable: true,
    context: { type: "chain", forced: false }, options: [{ id: "card:7", label: jet.name, card: jet, ...HAND(seat, 0) }],
  } : {
    id: "hand-trigger", seat, kind: "choice", title: "Use Jet Dragon from hand?", min: 1, max: 1,
    source: { code: jet.code, name: jet.name, seat, text: jet.description, zone: HAND(seat, 0) },
    options: [{ id: "yes", label: "Yes", card: jet }, { id: "no", label: "No", card: jet }],
  };
  source.mySeat = seat; source.session.slug = "live"; source.engine!.prompt = prompt;
  source.engine!.turnSeat = 1 - seat; source.engine!.events = []; source.engine!.chain = [];
  source.engine!.seats[seat]!.hand = [cardAt(jet, HAND(seat, 0))];
  state.room = source;
}

describe.each([0, 1])("live 1v1 hand effects, seat %s", seat => {
  it.each([false, true])("holds card actions through the real reveal timer, then sends one answer (chain %s)", async chain => {
    room(seat, chain); holdPromptReveal(2000);
    const { container } = render(<DuelRoomView slug="live" windowed />);
    const card = () => container.querySelector<HTMLElement>(`[data-hand-seat='${seat}'] [data-zones='${seat}:2:0']`)!;
    const click = () => fireEvent.click(card().querySelector("button") ?? card());
    expect(card()).toBeTruthy();
    click(); expect(screen.queryByRole("menu")).toBeNull(); expect(state.send).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(6500); });
    click();
    const item = screen.getByRole("menuitem", { name: chain ? jet.name : `Activate ${jet.name}` });
    await act(async () => { fireEvent.click(item); });
    expect(state.send).toHaveBeenCalledTimes(1);
    expect(state.send.mock.calls[0]![1].answer).toEqual({ choice: chain ? "card:7" : "yes" });
  });
});

describe("live 1v1 Deck Master during the reveal hold", () => {
  it("shows no pick glow on the Deck Master plate until the reveal, then glows", async () => {
    room(0, false);
    const source = state.room!;
    source.session.mode = "domain";
    source.engine!.seats[0]!.deckMaster = { card: jet, inZone: true, returns: 0, nextCost: 0 } as never;
    source.engine!.prompt = {
      id: "master-trigger", seat: 0, kind: "choice", title: "Use Jet Dragon?", min: 1, max: 1,
      options: [{ id: "yes", label: "Yes", card: jet, controller: 0, location: LOCATION_DMZONE, sequence: 0 }, { id: "no", label: "No", card: jet }],
    };
    holdPromptReveal(2000);
    render(<DuelRoomView slug="live" windowed />);
    const plate = () => screen.getByTestId("hud-master").querySelector("section")!;
    expect(plate().getAttribute("data-legal")).toBe("false");
    await act(async () => { await vi.advanceTimersByTimeAsync(6500); });
    expect(plate().getAttribute("data-legal")).toBe("true");
  });
});
