// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { DuelRoom } from "@yugidraft/shared/duels";

// Same harness as duel-room-table-mount.test.tsx (that file is not edited): the room runs for real, the API is mocked.
const state = vi.hoisted(() => ({ room: undefined as DuelRoom | undefined, mutate: vi.fn().mockResolvedValue(undefined), replace: vi.fn(), resync: vi.fn().mockResolvedValue(undefined), send: vi.fn(), surrender: vi.fn() }));
vi.mock("next/font/google", () => {
  const font = () => ({ variable: "font-var", className: "font-class" });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: state.replace }), useSearchParams: () => new URLSearchParams(window.location.search) }));
vi.mock("swr", () => ({ default: () => ({ data: state.room, error: undefined, isLoading: !state.room, mutate: state.mutate }) }));
vi.mock("@/lib/hooks/use-duel-websocket", () => ({ useDuelWebsocket: () => ({ connected: true, syncing: false, recovering: false, presence: null, resync: state.resync }) }));
vi.mock("@/lib/hooks/use-duel-leave-guard", () => ({ useDuelLeaveGuard: vi.fn() }));
vi.mock("@/components/duel/prompt-reveal", async (original) => ({ ...await original<object>(), usePromptReveal: () => true, usePromptAnswerable: () => true }));
vi.mock("@/components/duel/api", async (original) => ({ ...await original<object>(), sendDuelAction: state.send, surrenderDuel: state.surrender,
  reportEnabled: vi.fn().mockResolvedValue(false), getDuelRoom: async () => state.room, listDuelPresets: async () => ({ presets: [] }) }));
import { DuelRoomView } from "@/components/duel/room";
import { DuelRequestError } from "@/components/duel/api";
import { FFA3_FIXTURES } from "@/components/duel/table/fixtures/ffa3";
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
  state.mutate.mockResolvedValue(undefined);
  window.history.replaceState(null, "", "/duels/live");
});
afterEach(() => { cleanup(); window.name = ""; });

function room(source: DuelRoom) {
  state.room = { ...source, session: { ...source.session, slug: "live" }, engine: { ...source.engine!, events: [],
    prompt: source.engine!.prompt ? { ...source.engine!.prompt, options: source.engine!.prompt.options.map((option) => ({ ...option })) } : null } };
}
const mount = () => render(<DuelRoomView slug="live" windowed />);
const notice = () => screen.queryByRole("alert");

describe("duel room failed requests", () => {
  it("answers a plain 400 on an opponent pick with a general notice and refreshes the room", async () => {
    room(FFA3_FIXTURES.states["choose-opponent"].room);
    state.send.mockRejectedValueOnce(new DuelRequestError("Invalid answer", 400));
    mount();
    await act(async () => { fireEvent.click(screen.getByTestId("holo-pick-2")); });
    await waitFor(() => expect(notice()).toHaveTextContent("That choice is no longer open. Pick again."));
    expect(notice()).not.toHaveTextContent("Invalid answer");
    expect(notice()).not.toHaveTextContent(/left/i);
    expect(state.mutate).toHaveBeenCalled();
  });

  it("shows a short notice for a stale 409 and refreshes the room", async () => {
    room(FFA3_FIXTURES.states["choose-opponent"].room);
    state.send.mockRejectedValueOnce(new DuelRequestError("That choice is stale. Refresh the current duel state.", 409));
    mount();
    await act(async () => { fireEvent.click(screen.getByTestId("holo-pick-2")); });
    await waitFor(() => expect(notice()).toHaveTextContent("That choice is no longer open."));
    expect(notice()).not.toHaveTextContent("stale");
    expect(state.mutate).toHaveBeenCalled();
  });

  it("tells a player the surrender did not happen when the core cannot eliminate", async () => {
    room(FFA3_FIXTURES.states.main.room);
    state.surrender.mockRejectedValueOnce(new DuelRequestError("This engine cannot eliminate a surrendering duelist", 409));
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Surrender" }));
    const dialog = screen.getByRole("dialog", { name: "Surrender" });
    await act(async () => { fireEvent.click(within(dialog).getByRole("button", { name: "Surrender" })); });
    await waitFor(() => expect(notice()).toHaveTextContent("This duel can't accept a surrender right now."));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Surrender" })).toBeNull());
    expect(notice()).not.toHaveTextContent("engine");
    expect(state.mutate).toHaveBeenCalled();
    // The seat is unchanged, so the player can still surrender later.
    expect(screen.getAllByRole("button", { name: "Surrender" })[0]).toBeEnabled();
  });

  it("keeps the server text of an error it has no notice for", async () => {
    room(FFA3_FIXTURES.states["choose-opponent"].room);
    state.send.mockRejectedValueOnce(new DuelRequestError("You surrendered this duel", 409));
    mount();
    await act(async () => { fireEvent.click(screen.getByTestId("holo-pick-2")); });
    await waitFor(() => expect(notice()).toHaveTextContent("You surrendered this duel"));
  });
});

describe("duel room role", () => {
  it("clears the notice and every seat-only overlay when the role becomes spectator", async () => {
    room(FFA3_FIXTURES.states["choose-opponent"].room);
    state.send.mockRejectedValueOnce(new DuelRequestError("Invalid answer", 400));
    const view = mount();
    await act(async () => { fireEvent.click(screen.getByTestId("holo-pick-2")); });
    await waitFor(() => expect(notice()).toBeInTheDocument());
    room(FFA3_FIXTURES.states.spectator.room);
    expect(state.room!.role).toBe("spectator");
    view.rerender(<DuelRoomView slug="live" windowed spectate />);
    await waitFor(() => expect(notice()).toBeNull());
  });

  it.each([["legacy", true], ["table", false]])("closes an open pile viewer when the viewer stops playing (%s view)", async (_name, legacyStage) => {
    room(FFA3_FIXTURES.states.main.room);
    const view = render(<DuelRoomView slug="live" windowed legacyStage={legacyStage} />);
    fireEvent.click(screen.getByRole("button", { name: "Open Your Extra Deck" }));
    expect(screen.getByRole("dialog", { name: /Extra Deck/ })).toBeInTheDocument();
    room(FFA3_FIXTURES.states.spectator.room);
    view.rerender(<DuelRoomView slug="live" windowed legacyStage={legacyStage} spectate />);
    await waitFor(() => expect(screen.queryByRole("dialog", { name: /Extra Deck/ })).toBeNull());
  });

  it("keeps an open pile viewer while the role stays player", () => {
    room(FFA3_FIXTURES.states.main.room);
    const view = render(<DuelRoomView slug="live" windowed legacyStage />);
    fireEvent.click(screen.getByRole("button", { name: "Open Your Extra Deck" }));
    room(FFA3_FIXTURES.states.main.room);
    view.rerender(<DuelRoomView slug="live" windowed legacyStage />);
    expect(screen.getByRole("dialog", { name: /Extra Deck/ })).toBeInTheDocument();
  });

  it("keeps role player and the own result for an FFA draw, with no redirect", () => {
    room(FFA3_FIXTURES.states.result.room);
    state.room!.engine!.result = { winnerSeat: null, winnerTeam: null, reason: "Draw" };
    // Seat 1 left first. Seats 0 and 2 lost together in the final group.
    state.room!.engine!.seats = state.room!.engine!.seats.map((seat) => ({ ...seat, lp: 0, eliminated: true }));
    state.room!.engine!.eliminationOrder = [[1], [0, 2]];
    expect(state.room!.role).toBe("player");
    expect(state.room!.mySeat).toBe(0);
    mount();
    const result = screen.getByTestId("duel-result");
    expect(result).toHaveAttribute("data-outcome", "draw");
    expect(result.querySelector("[data-seat='0']")).toHaveAttribute("data-out", "true");
    expect(state.replace).not.toHaveBeenCalled();
  });

  it("shows the result to a Tag player after a surrender", async () => {
    room(TAG_FIXTURES.states.main.room);
    const view = mount();
    fireEvent.click(screen.getAllByRole("button", { name: "Surrender" })[0]);
    const dialog = screen.getByRole("dialog", { name: "Surrender" });
    await act(async () => { fireEvent.click(within(dialog).getByRole("button", { name: "Surrender" })); });
    expect(state.surrender).toHaveBeenCalledExactlyOnceWith("live");
    // The server completes a Tag surrender at once: the room now holds the result and the viewer stays a player.
    room(TAG_FIXTURES.states.result.room);
    state.room!.engine!.result = { winnerSeat: 1, winnerTeam: 1, reason: "Surrender" };
    state.room!.engine!.seats = state.room!.engine!.seats.map((seat) => ({ ...seat, eliminated: seat.team === 0 }));
    expect(state.room!.role).toBe("player");
    view.rerender(<DuelRoomView slug="live" windowed />);
    expect(screen.getByTestId("duel-result")).toBeInTheDocument();
    expect(state.replace).not.toHaveBeenCalled();
  });
});
