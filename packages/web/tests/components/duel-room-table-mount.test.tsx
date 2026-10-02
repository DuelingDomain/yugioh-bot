// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { DuelRoom } from "@yugidraft/shared/duels";

const state = vi.hoisted(() => ({ room: undefined as DuelRoom | undefined, error: undefined as unknown, syncing: false, recovering: false, revealed: true, reportEnabled: vi.fn().mockResolvedValue(false), mutate: vi.fn().mockResolvedValue(undefined), replace: vi.fn(), resync: vi.fn().mockResolvedValue(undefined), send: vi.fn().mockResolvedValue(undefined), surrender: vi.fn().mockResolvedValue(undefined) }));
vi.mock("next/font/google", () => {
  const font = () => ({ variable: "font-var", className: "font-class" });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: state.replace }), useSearchParams: () => new URLSearchParams(window.location.search) }));
vi.mock("swr", () => ({ default: () => ({ data: state.room, error: state.error, isLoading: !state.room, mutate: state.mutate }) }));
vi.mock("@/lib/hooks/use-duel-websocket", () => ({ useDuelWebsocket: () => ({ connected: true, syncing: state.syncing, recovering: state.recovering, presence: null, resync: state.resync }) }));
vi.mock("@/lib/hooks/use-duel-leave-guard", () => ({ useDuelLeaveGuard: vi.fn() }));
vi.mock("@/components/duel/prompt-reveal", async (original) => ({ ...await original<object>(), usePromptReveal: () => state.revealed, usePromptAnswerable: () => true }));
vi.mock("@/components/duel/api", async (original) => ({ ...await original<object>(), sendDuelAction: state.send, surrenderDuel: state.surrender,
  reportEnabled: state.reportEnabled, getDuelRoom: async () => state.room, listDuelPresets: async () => ({ presets: [] }) }));
import { DuelRoomView } from "@/components/duel/room";
import { FFA3_FIXTURES } from "@/components/duel/table/fixtures/ffa3";
import { FFA4_FIXTURES } from "@/components/duel/table/fixtures/ffa4";
import { TAG_FIXTURES } from "@/components/duel/tag/fixtures";

beforeAll(() => {
  class RO { constructor(private cb: () => void) {} observe() { this.cb(); } disconnect() {} }
  vi.stubGlobal("ResizeObserver", RO);
  HTMLElement.prototype.getAnimations = () => [];
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} }));
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 1100 });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 860 });
});
beforeEach(() => {
  vi.clearAllMocks();
  state.error = undefined; state.syncing = false; state.recovering = false; state.revealed = true;
  state.reportEnabled.mockResolvedValue(false);
  window.history.replaceState(null, "", "/duels/live");
});
afterEach(cleanup);
function room(source: DuelRoom) {
  state.room = { ...source, session: { ...source.session, slug: "live" }, engine: { ...source.engine!, events: [],
    prompt: source.engine!.prompt ? { ...source.engine!.prompt, options: source.engine!.prompt.options.map((option) => ({ ...option })) } : null } };
}
function mount(windowed = true) { return render(<DuelRoomView slug="live" windowed={windowed} />); }

describe("live room table mount", () => {
  it.each([FFA3_FIXTURES, FFA4_FIXTURES])("mounts $format with every engine seat", (fixtures) => {
    room(fixtures.states.main.room);
    const { container } = mount();
    expect(container.querySelector("[data-table-shell]")).not.toBeNull();
    expect(container.querySelector("[data-table-stage]")).toHaveAttribute("data-format", fixtures.format);
    expect(container.querySelectorAll("[data-lp-seat]")).toHaveLength(state.room!.engine!.seats.length);
    expect(screen.queryByTestId("multi-seat-stage")).toBeNull();
    expect(screen.getByRole("button", { name: "Surrender" })).toBeTruthy();
  });

  it.each([FFA3_FIXTURES, FFA4_FIXTURES])("keeps $format on MultiSeatStage with stage=legacy", (fixtures) => {
    window.history.replaceState(null, "", "/duels/live?stage=legacy");
    room(fixtures.states.main.room);
    const { container } = mount();
    expect(screen.getByTestId("multi-seat-stage")).toBeTruthy();
    expect(container.querySelector("[data-table-shell]")).toBeNull();
  });

  it("keeps tag on MultiSeatStage", () => {
    room(TAG_FIXTURES.states.main.room);
    const { container } = mount();
    expect(screen.getByTestId("multi-seat-stage")).toHaveAttribute("data-format", "tag");
    expect(container.querySelector("[data-table-shell]")).toBeNull();
  });

  it("keeps the two-seat DuelField path", () => {
    const source = FFA3_FIXTURES.states.main.room;
    room({ ...source, session: { ...source.session, format: "1v1", seats: source.session.seats.slice(0, 2) }, engine: { ...source.engine!, format: "1v1", seats: source.engine!.seats.slice(0, 2) } });
    const { container } = mount();
    expect(container.querySelector("[data-table-shell]")).toBeNull();
    expect(screen.queryByTestId("multi-seat-stage")).toBeNull();
    expect(container.querySelector("[data-hand-seat='0']")).not.toBeNull();
  });

  it("keeps the own-window gate in the room", () => {
    room(FFA3_FIXTURES.states.main.room);
    const { container } = mount(false);
    expect(screen.getByTestId("duel-window-gate")).toBeTruthy();
    expect(container.querySelector("[data-table-shell]")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Open here instead" }));
    expect(container.querySelector("[data-table-shell]")).not.toBeNull();
  });

  it("routes a table card action once through the room's prompt and revision", async () => {
    room(FFA3_FIXTURES.states.main.room);
    const { container } = mount();
    const card = container.querySelector("[data-hand-seat='0'] [data-zones][data-legal='true']")!;
    fireEvent.click(card.querySelector("button") ?? card);
    const item = screen.getAllByRole("menuitem")[0];
    await act(async () => { fireEvent.click(item); });
    expect(state.send).toHaveBeenCalledTimes(1);
    expect(state.send).toHaveBeenCalledWith("live", { promptId: state.room!.engine!.prompt!.id, revision: state.room!.engine!.revision, answer: { choice: expect.any(String) } });
  });

  it("submits a live material toggle exactly once", async () => {
    room(FFA3_FIXTURES.states.main.room);
    state.room!.engine!.prompt = { id: "materials", seat: 0, kind: "toggle", title: "Select Synchro Material",
      options: [{ id: "select:0", label: "Material", controller: 0, location: 4, sequence: 0 }] };
    const { container } = mount();
    const card = container.querySelector("[data-zones='0:4:0']")!;
    await act(async () => { fireEvent.click(card.querySelector("button") ?? card); });
    expect(state.send).toHaveBeenCalledExactlyOnceWith("live", {
      promptId: "materials", revision: state.room!.engine!.revision, answer: { choice: "select:0" },
    });
  });

  it("waits for the reveal gate before a material card can answer", async () => {
    room(FFA3_FIXTURES.states.main.room);
    state.room!.engine!.prompt = { id: "materials", seat: 0, kind: "toggle", title: "Select Synchro Material",
      options: [{ id: "select:0", label: "Material", controller: 0, location: 4, sequence: 0 }] };
    state.revealed = false;
    const view = mount();
    const card = view.container.querySelector("[data-zones='0:4:0']")!;
    await act(async () => { fireEvent.click(card.querySelector("button") ?? card); });
    expect(state.send).not.toHaveBeenCalled();
    state.revealed = true;
    view.rerender(<DuelRoomView slug="live" windowed />);
    await act(async () => { fireEvent.click(card.querySelector("button") ?? card); });
    expect(state.send).toHaveBeenCalledTimes(1);
  });

  it.each(["error", "syncing", "recovering"] as const)("blocks actions during %s", async (gate) => {
    room(FFA3_FIXTURES.states.main.room);
    if (gate === "error") state.error = new Error("offline"); else state[gate] = true;
    const { container } = mount();
    const card = container.querySelector("[data-zones='0:2:0']")!;
    expect(card).not.toBeNull();
    await act(async () => { fireEvent.click(card.querySelector("button") ?? card); });
    const item = screen.queryAllByRole("menuitem")[0];
    if (item) await act(async () => { fireEvent.click(item); });
    expect(screen.queryByRole("button", { name: "Battle Phase" })).toBeNull();
    expect(state.send).not.toHaveBeenCalled();
  });

  it("answers a live opponent pick from the seat strip exactly once", async () => {
    room(FFA3_FIXTURES.states["choose-opponent"].room);
    mount();
    await act(async () => { fireEvent.click(screen.getByTestId("seat-strip-pick-2")); });
    expect(state.send).toHaveBeenCalledExactlyOnceWith("live", {
      promptId: "choose-opponent", revision: state.room!.engine!.revision, answer: { choice: "opp-2" },
    });
  });

  it("locks a live direct attack in OpponentBar and confirms one room action", async () => {
    room(FFA3_FIXTURES.states["direct-attack"].room);
    state.room!.engine!.prompt!.options[0].id = "opt:0";
    const { container } = mount();
    fireEvent.click(container.querySelector("[data-opponent-bar='direct'] [data-rival-seat='1']")!);
    expect(state.send).not.toHaveBeenCalled();
    expect(container.querySelector("[data-rival-seat='1'][data-locked='true']")).not.toBeNull();
    await act(async () => { fireEvent.click(screen.getByTestId("aim-confirm")); });
    expect(state.send).toHaveBeenCalledExactlyOnceWith("live", {
      promptId: "direct-attack", revision: state.room!.engine!.revision, answer: { choice: "opt:0" },
    });
  });

  it.each(["spectator", "eliminated self"])("does not offer or send actions for an %s", async (role) => {
    room(FFA3_FIXTURES.states["choose-opponent"].room);
    if (role === "spectator") state.room!.mySeat = null;
    else state.room!.engine!.seats = state.room!.engine!.seats.map((seat) => ({ ...seat, eliminated: seat.seat === 0 }));
    const { container } = mount();
    expect(screen.queryByTestId("seat-strip-pick-1")).toBeNull();
    const card = container.querySelector("[data-zones='1:4:0']")!;
    await act(async () => {
      fireEvent.click(card.querySelector("button") ?? card);
      fireEvent.keyDown(window, { key: "1" });
    });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(state.send).not.toHaveBeenCalled();
  });

  it("passes surrender confirmation and exit actions to the shell", async () => {
    room(FFA3_FIXTURES.states.main.room);
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Surrender" }));
    const dialog = screen.getByRole("dialog", { name: "Surrender" });
    await act(async () => { fireEvent.click(within(dialog).getByRole("button", { name: "Surrender" })); });
    expect(state.surrender).toHaveBeenCalledExactlyOnceWith("live");
  });

  it("keeps manual catch-up available while recovering", async () => {
    room(FFA3_FIXTURES.states.main.room);
    state.recovering = true;
    mount();
    fireEvent.click(screen.getByRole("tab", { name: "Settings" }));
    const retry = screen.getByRole("button", { name: "Catch up now" });
    expect(retry).not.toBeDisabled();
    await act(async () => { fireEvent.click(retry); });
    expect(state.resync).toHaveBeenCalledTimes(1);
    expect(state.send).not.toHaveBeenCalled();
  });

  it("does not answer seat hotkeys behind the room's surrender modal", async () => {
    room(FFA3_FIXTURES.states["choose-opponent"].room);
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Surrender" }));
    await act(async () => { fireEvent.keyDown(screen.getByRole("dialog", { name: "Surrender" }), { key: "1" }); });
    expect(state.send).not.toHaveBeenCalled();
  });

  it.each(["dialog button", "window"])("pauses seat and camera keys while Report is open (%s)", async (target) => {
    room(FFA3_FIXTURES.states["choose-opponent"].room);
    state.reportEnabled.mockResolvedValue(true);
    const { container } = mount();
    fireEvent.click(await screen.findByRole("button", { name: "Report" }));
    const dialog = screen.getByRole("dialog", { name: "Report a problem" });
    const camera = container.querySelector("[data-camera-mode]")!;
    const mode = camera.getAttribute("data-camera-mode");
    const keyTarget = target === "window" ? window : within(dialog).getByRole("button", { name: "Save report" });
    await act(async () => {
      fireEvent.keyDown(keyTarget, { key: "1" });
      fireEvent.keyDown(keyTarget, { key: "o" });
    });
    expect(state.send).not.toHaveBeenCalled();
    expect(camera).toHaveAttribute("data-camera-mode", mode);
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Report a problem" })).toBeNull());
    fireEvent.keyDown(window, { key: "o" });
    expect(camera).toHaveAttribute("data-camera-mode", "fly");
    await act(async () => { fireEvent.keyDown(window, { key: "1" }); });
    expect(state.send).toHaveBeenCalledTimes(1);
  });

  it("restores ordered placings from the live log on a completed room", () => {
    room(FFA3_FIXTURES.states.result.room);
    state.room!.engine!.log = [{ id: 10, text: "Player 3 is eliminated (surrender)" }, { id: 20, text: "Player 2 is eliminated (LP reached 0)" }];
    mount(false);
    expect(screen.getByTestId("duel-result").querySelectorAll("[data-place]")).toHaveLength(3);
    expect([...screen.getByTestId("duel-result").querySelectorAll("[data-place]")].map((node) => node.textContent)).toEqual(["1st", "2nd", "3rd"]);
    fireEvent.click(screen.getByTestId("duel-result").querySelector("button[data-kind=primary]")!);
    expect(state.replace).toHaveBeenCalledWith("/duels");
  });

  it("keeps simultaneous live losses tied and restores engine ties after remount", () => {
    room(FFA3_FIXTURES.states.main.room);
    const view = mount();
    room(FFA3_FIXTURES.states.result.room);
    state.room!.engine!.result = { winnerSeat: 0, reason: "Surrender" };
    state.room!.engine!.log = [{ id: 1, text: "Player 2 is eliminated" }, { id: 2, text: "Player 3 is eliminated" }];
    view.rerender(<DuelRoomView slug="live" windowed />);
    const places = () => [...screen.getByTestId("duel-result").querySelectorAll("[data-place]")].map((node) => node.textContent);
    expect(places()).toEqual(["1st", "2nd", "2nd"]);
    view.unmount();
    state.room!.engine!.eliminationOrder = [[1, 2]];
    mount();
    expect(places()).toEqual(["1st", "2nd", "2nd"]);
  });
});
