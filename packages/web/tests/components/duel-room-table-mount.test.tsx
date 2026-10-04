// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { DuelRoom } from "@yugidraft/shared/duels";

const state = vi.hoisted(() => ({ room: undefined as DuelRoom | undefined, error: undefined as unknown, syncing: false, recovering: false, revealed: true, reportEnabled: vi.fn().mockResolvedValue(false), mutate: vi.fn().mockResolvedValue(undefined), replace: vi.fn(), resync: vi.fn().mockResolvedValue(undefined), send: vi.fn().mockResolvedValue(undefined), surrender: vi.fn().mockResolvedValue(undefined), tagProps: vi.fn() }));
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
// The Rooftop is built by another branch; the room only has to mount it with the shared seams and the team names.
vi.mock("@/components/duel/tag/tag-shell", () => ({
  TagShell: (props: Record<string, unknown>) => {
    state.tagProps(props);
    return <div data-tag-shell data-testid="tag-shell">{props.headerTools as React.ReactNode}{props.modals as React.ReactNode}</div>;
  },
}));
import { DuelRoomView } from "@/components/duel/room";
import { FFA3_FIXTURES } from "@/components/duel/table/fixtures/ffa3";
import { FFA4_FIXTURES } from "@/components/duel/table/fixtures/ffa4";
import { TAG_FIXTURES } from "@/components/duel/tag/fixtures";
import { makeSeries } from "../helpers/duel-series";
import { duelWindowPath } from "@/components/duel/duel-window";

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
afterEach(() => { cleanup(); window.name = ""; });
function room(source: DuelRoom) {
  state.room = { ...source, session: { ...source.session, slug: "live" }, engine: { ...source.engine!, events: [],
    prompt: source.engine!.prompt ? { ...source.engine!.prompt, options: source.engine!.prompt.options.map((option) => ({ ...option })) } : null } };
}
function mount(windowed = true) { return render(<DuelRoomView slug="live" windowed={windowed}
  legacyStage={new URLSearchParams(window.location.search).get("stage") === "legacy"} />); }

describe("live room table mount", () => {
  it.each([FFA3_FIXTURES, FFA4_FIXTURES])("mounts $format with every engine seat", (fixtures) => {
    room(fixtures.states.main.room);
    const { container } = mount();
    expect(container.querySelector("[data-table-shell]")).not.toBeNull();
    expect(container.querySelector("[data-table-stage]")).toHaveAttribute("data-format", fixtures.format);
    expect(container.querySelectorAll("[data-lp-seat]")).toHaveLength(state.room!.engine!.seats.length);
    expect(screen.queryByTestId("multi-seat-stage")).toBeNull();
    expect(screen.getByRole("button", { name: "Surrender" })).toBeTruthy();
    // The Report bug button sits in the table header, with the other header buttons.
    expect(container.querySelector("header [data-bug-header-button]")).not.toBeNull();
  });

  it.each([FFA3_FIXTURES, FFA4_FIXTURES])("keeps $format on MultiSeatStage with stage=legacy", (fixtures) => {
    window.history.replaceState(null, "", "/duels/live?stage=legacy");
    room(fixtures.states.main.room);
    const { container } = mount();
    expect(screen.getByTestId("multi-seat-stage")).toBeTruthy();
    expect(container.querySelector("[data-table-shell]")).toBeNull();
  });

  it("mounts the Rooftop for a tag player with the live seams and team names", () => {
    room(TAG_FIXTURES.states.main.room);
    const { container } = mount();
    expect(screen.getByTestId("tag-shell")).toBeTruthy();
    expect(container.querySelector("[data-table-shell]")).toBeNull();
    expect(screen.queryByTestId("multi-seat-stage")).toBeNull();
    expect(state.tagProps).toHaveBeenCalled();
    const props = state.tagProps.mock.calls.at(-1)![0];
    expect(props.teamNames).toEqual(["Team 1", "Team 2"]);
    expect(props.controller.engine.format).toBe("tag");
    expect(props.fillViewport).toBe(true);
    expect(Object.keys(props).sort()).toEqual(["actions", "boardRef", "busy", "connection", "controller", "fillViewport", "fxActive",
      "headerTools", "initialOutOrder", "inputSuspended", "modals", "notices", "pickContinuation", "preferences", "settingsTools", "teamNames"]);
    expect(screen.getByRole("button", { name: "Surrender" })).toBeTruthy();
    // The Rooftop shell puts headerTools in its header: the Report bug button is one of them.
    expect(container.querySelector("[data-tag-shell] [data-bug-header-button]")).not.toBeNull();
  });

  it("mounts the Rooftop for a tag spectator", () => {
    room(TAG_FIXTURES.states.main.room);
    state.room!.mySeat = null;
    const { container } = mount();
    expect(screen.getByTestId("tag-shell")).toBeTruthy();
    expect(container.querySelector("[data-table-shell]")).toBeNull();
    expect(screen.queryByRole("button", { name: "Surrender" })).toBeNull();
    expect(screen.getByRole("button", { name: "Leave room" })).toBeTruthy();
  });

  it("keeps tag on MultiSeatStage with stage=legacy", () => {
    window.history.replaceState(null, "", "/duels/live?stage=legacy");
    room(TAG_FIXTURES.states.main.room);
    const { container } = mount();
    expect(screen.getByTestId("multi-seat-stage")).toHaveAttribute("data-format", "tag");
    expect(screen.queryByTestId("tag-shell")).toBeNull();
    expect(container.querySelector("[data-table-shell]")).toBeNull();
  });

  it.each([FFA3_FIXTURES, FFA4_FIXTURES])("never mounts the Rooftop for $format", (fixtures) => {
    room(fixtures.states.main.room);
    mount();
    expect(screen.queryByTestId("tag-shell")).toBeNull();
    expect(state.tagProps).not.toHaveBeenCalled();
  });

  it("keeps the two-seat DuelField path off the Rooftop", () => {
    const source = TAG_FIXTURES.states.main.room;
    room({ ...source, session: { ...source.session, format: "1v1", seats: source.session.seats.slice(0, 2) }, engine: { ...source.engine!, format: "1v1", seats: source.engine!.seats.slice(0, 2) } });
    mount();
    expect(screen.queryByTestId("tag-shell")).toBeNull();
    expect(screen.queryByTestId("multi-seat-stage")).toBeNull();
  });

  it("tells a tag player that the whole team loses on surrender", async () => {
    room(TAG_FIXTURES.states.main.room);
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Surrender" }));
    const dialog = screen.getByRole("dialog", { name: "Surrender" });
    expect(dialog).toHaveTextContent("Your team loses now.");
    expect(dialog).not.toHaveTextContent("Leaving");
    await act(async () => { fireEvent.click(within(dialog).getByRole("button", { name: "Surrender" })); });
    expect(state.surrender).toHaveBeenCalledExactlyOnceWith("live");
  });

  describe("surrender from your own deck", () => {
    const deckOf = (container: HTMLElement, seat: number) =>
      container.querySelector<HTMLElement>(`[data-seat-field="${seat}"] [data-kind="deck"] button`)!;

    it("asks 'Are you sure?' and surrenders only after Surrender is confirmed", async () => {
      room(FFA3_FIXTURES.states.main.room);
      const { container } = mount();
      fireEvent.click(deckOf(container, 0));
      fireEvent.click(screen.getByRole("menuitem", { name: "Surrender" }));
      const dialog = screen.getByRole("dialog", { name: "Surrender" });
      expect(dialog).toHaveTextContent("Are you sure?");
      expect(state.surrender).not.toHaveBeenCalled();
      await act(async () => { fireEvent.click(within(dialog).getByRole("button", { name: "Surrender" })); });
      expect(state.surrender).toHaveBeenCalledExactlyOnceWith("live");
    });

    it("does not surrender when the confirm is cancelled", async () => {
      room(FFA3_FIXTURES.states.main.room);
      const { container } = mount();
      fireEvent.contextMenu(deckOf(container, 0));
      fireEvent.click(screen.getByRole("menuitem", { name: "Surrender" }));
      const dialog = screen.getByRole("dialog", { name: "Surrender" });
      await act(async () => { fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" })); });
      await waitFor(() => expect(screen.queryByRole("dialog", { name: "Surrender" })).toBeNull());
      expect(state.surrender).not.toHaveBeenCalled();
    });

    it("offers no Surrender on a rival's deck", () => {
      room(FFA3_FIXTURES.states.main.room);
      const { container } = mount();
      fireEvent.click(deckOf(container, 1));
      fireEvent.contextMenu(deckOf(container, 1));
      expect(screen.queryByRole("menu")).toBeNull();
      expect(screen.queryByRole("menuitem", { name: "Surrender" })).toBeNull();
    });

    it("offers no Surrender to a spectator or after the duel ends", () => {
      room(FFA3_FIXTURES.states.spectator.room);
      const view = mount();
      fireEvent.click(deckOf(view.container, 0));
      expect(screen.queryByRole("menu")).toBeNull();
      view.unmount();
      room(FFA3_FIXTURES.states.main.room);
      state.room!.engine!.result = { winnerSeat: 1, reason: "LP reached 0" };
      const ended = mount();
      fireEvent.click(deckOf(ended.container, 0));
      expect(screen.queryByRole("menu")).toBeNull();
    });
  });

  it("does not send a tag player to spectate when a seat is eliminated", () => {
    room(TAG_FIXTURES.states.main.room);
    state.room!.engine!.seats = state.room!.engine!.seats.map((seat) => ({ ...seat, eliminated: seat.seat === 0 }));
    mount();
    expect(state.replace).not.toHaveBeenCalled();
  });

  it.each([true, false])("preserves stage=legacy while following the next series game (windowed=%s)", (windowed) => {
    window.history.replaceState(null, "", "/duels/live?stage=legacy");
    room(FFA3_FIXTURES.states.main.room);
    state.room!.series = makeSeries({ currentDuelSlug: "next-game" });
    mount(windowed);
    const path = windowed ? `${duelWindowPath("next-game")}&stage=legacy` : "/duels/next-game?stage=legacy";
    expect(state.replace).toHaveBeenCalledWith(path);
  });

  it("keeps the two-seat DuelField path", () => {
    const source = FFA3_FIXTURES.states.main.room;
    room({ ...source, session: { ...source.session, format: "1v1", seats: source.session.seats.slice(0, 2) }, engine: { ...source.engine!, format: "1v1", seats: source.engine!.seats.slice(0, 2) } });
    const { container } = mount();
    expect(container.querySelector("[data-table-shell]")).toBeNull();
    expect(screen.queryByTestId("multi-seat-stage")).toBeNull();
    expect(container.querySelector("[data-hand-seat='0']")).not.toBeNull();
  });

  it("opens the board in place when a seated player lands on a live duel outside the duel window", () => {
    room(FFA3_FIXTURES.states.main.room);
    const { container } = mount(false);
    expect(screen.queryByTestId("duel-window-gate")).toBeNull();
    expect(container.querySelector("[data-table-shell]")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Pop out" })).toBeTruthy();
  });

  it("routes a table card action once through the room's prompt and revision", async () => {
    room(FFA3_FIXTURES.states.main.room);
    const { container } = mount();
    const card = container.querySelector("[data-hand-seat='0'] [data-zones][data-legal='true']")!;
    expect(container.querySelector("[data-table-shell]")).toHaveAttribute("data-can-act", "true");
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
    expect(container.querySelector("[data-table-shell]")).toHaveAttribute("data-can-act", "false");
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
    expect(screen.queryAllByRole("button", { name: /as the opponent$/ })).toHaveLength(0);
    const card = container.querySelector("[data-zones='1:4:0']")!;
    await act(async () => {
      fireEvent.click(card.querySelector("button") ?? card);
      fireEvent.keyDown(window, { key: "1" });
    });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(state.send).not.toHaveBeenCalled();
  });

  it.each(["eliminated", "pendingElimination"] as const)("hides stale own-card actions while %s", async (out) => {
    room(FFA3_FIXTURES.states.main.room);
    state.room!.engine!.seats = state.room!.engine!.seats.map((seat) => ({ ...seat, [out]: seat.seat === 0 }));
    const { container } = mount();
    const card = container.querySelector("[data-zones='0:2:0']")!;
    expect(card).not.toBeNull();
    await act(async () => { fireEvent.click(card.querySelector("button") ?? card); });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(screen.queryByRole("button", { name: "Battle Phase" })).toBeNull();
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

  it.each([FFA3_FIXTURES, FFA4_FIXTURES])("shows $format Leaving until loss, then automatically switches to spectating", (fixtures) => {
    room(fixtures.states.main.room);
    state.room!.engine!.seats = state.room!.engine!.seats.map(seat => seat.seat === 0 ? { ...seat, pendingElimination: true } : seat);
    const view = mount();
    expect(screen.getByTestId("self-leaving")).toHaveTextContent("Leaving — you surrendered; you leave at the end of this turn");
    expect(screen.queryByRole("button", { name: "Surrender" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Stay and watch" })).toBeNull();
    expect(state.replace).not.toHaveBeenCalled();
    expect(view.container.querySelector("[data-table-shell]")).toHaveAttribute("data-can-act", "false");
    state.room!.engine!.seats = state.room!.engine!.seats.map(seat => seat.seat === 0 ? { ...seat, pendingElimination: false, eliminated: true } : seat);
    view.rerender(<DuelRoomView slug="live" windowed />);
    expect(screen.queryByTestId("self-leaving")).toBeNull();
    expect(screen.queryByRole("region", { name: "You are eliminated" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Stay and watch" })).toBeNull();
    expect(state.replace).toHaveBeenCalledWith("/duels/live?spectate=1&window=1");
  });

  it.each(["surrender", "LP reached 0", "deck-out"])("automatically spectates a reloaded %s loss and preserves URL options", (reason) => {
    window.history.replaceState(null, "", "/duels/live?stage=legacy&window=1");
    room(FFA3_FIXTURES.states.main.room);
    state.room!.engine!.seats = state.room!.engine!.seats.map(seat => seat.seat === 0 ? { ...seat, eliminated: true } : seat);
    state.room!.engine!.log = [{ id: 1, text: `Player 1 is eliminated (${reason})` }];
    mount();
    expect(state.replace).toHaveBeenCalledWith("/duels/live?stage=legacy&window=1&spectate=1");
    expect(screen.queryByRole("button", { name: "Stay and watch" })).toBeNull();
  });

  it.each(["completed", "interrupted"] as const)("does not send an eliminated seat to spectate once the duel is %s", (status) => {
    room(FFA3_FIXTURES.states.result.room);
    // The fixture already carries engine.result; clear it so only the session status keeps the seat from spectating.
    state.room!.engine!.result = null;
    state.room!.session.status = status;
    state.room!.engine!.seats = state.room!.engine!.seats.map(seat => seat.seat === 0 ? { ...seat, eliminated: true } : seat);
    expect(state.room!.mySeat).toBe(0);
    mount();
    expect(state.replace).not.toHaveBeenCalled();
  });

  it("does not send an eliminated seat to spectate when the engine already holds a result", () => {
    room(FFA3_FIXTURES.states.main.room);
    state.room!.engine!.seats = state.room!.engine!.seats.map(seat => seat.seat === 0 ? { ...seat, eliminated: true } : seat);
    state.room!.engine!.result = { winnerSeat: 1, reason: "Last duelist standing" };
    mount();
    expect(state.replace).not.toHaveBeenCalled();
  });

  it("leaves a spectator room with the small header control without another surrender", () => {
    room(FFA3_FIXTURES.states.spectator.room);
    mount(false);
    fireEvent.click(screen.getByRole("button", { name: "Leave room" }));
    expect(state.replace).toHaveBeenCalledWith("/duels");
    expect(state.surrender).not.toHaveBeenCalled();
  });

  it("closes an open surrender dialog when an LP loss lands", async () => {
    room(FFA3_FIXTURES.states.main.room);
    const view = mount();
    fireEvent.click(screen.getByRole("button", { name: "Surrender" }));
    expect(screen.getByRole("dialog", { name: "Surrender" })).toBeVisible();
    state.room!.engine!.seats = state.room!.engine!.seats.map(seat => seat.seat === 0 ? { ...seat, lp: 0, eliminated: true } : seat);
    view.rerender(<DuelRoomView slug="live" windowed />);
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Surrender" })).toBeNull());
    room(FFA3_FIXTURES.states.spectator.room);
    view.rerender(<DuelRoomView slug="live" windowed spectate />);
    expect(screen.queryByRole("dialog", { name: "Surrender" })).toBeNull();
    expect(state.surrender).not.toHaveBeenCalled();
  });

  it.each([true, false])("keeps Archive table available only to a spectating organizer (organizer=%s)", (organizer) => {
    room(FFA3_FIXTURES.states.result.room);
    state.room!.mySeat = null;
    const actorPlayerId = organizer ? state.room!.session.organizerPlayerId : state.room!.session.organizerPlayerId + 1;
    render(<DuelRoomView slug="live" spectate actorPlayerId={actorPlayerId} />);
    fireEvent.click(screen.getByRole("tab", { name: "Settings" }));
    expect(screen.queryByRole("button", { name: "Archive table" }) != null).toBe(organizer);
  });

  it("shows Leaving and blocks stale response prompts in the legacy view", () => {
    window.history.replaceState(null, "", "/duels/live?stage=legacy");
    room(FFA3_FIXTURES.states["choose-opponent"].room);
    state.room!.engine!.seats = state.room!.engine!.seats.map(seat => seat.seat === 0 ? { ...seat, pendingElimination: true } : seat);
    mount();
    expect(screen.getByTestId("self-leaving")).toBeVisible();
    expect(screen.queryAllByRole("button", { name: /as the opponent$/ })).toHaveLength(0);
    expect(state.replace).not.toHaveBeenCalled();
  });

  it("answers an engine-offered Leaving opponent from the live LP panel", async () => {
    room(FFA3_FIXTURES.states["choose-opponent"].room);
    state.room!.engine!.seats = state.room!.engine!.seats.map(seat => seat.seat === 2 ? { ...seat, pendingElimination: true } : seat);
    mount();
    expect(screen.getByTestId("holo-pick-2")).toBeVisible();
    await act(async () => { fireEvent.click(screen.getByTestId("holo-pick-2")); });
    expect(state.send).toHaveBeenCalledExactlyOnceWith("live", {
      promptId: "choose-opponent", revision: state.room!.engine!.revision, answer: { choice: "opp-2" },
    });
  });

  it("explains a multiplayer surrender without promising to end everyone's duel", () => {
    room(FFA3_FIXTURES.states.main.room);
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Surrender" }));
    expect(screen.getByRole("dialog", { name: "Surrender" })).toHaveTextContent("Leaving");
    expect(screen.getByRole("dialog", { name: "Surrender" })).toHaveTextContent("automatically spectate");
    expect(screen.getByRole("dialog", { name: "Surrender" })).toHaveTextContent("your own turn");
    expect(screen.getByRole("dialog", { name: "Surrender" })).not.toHaveTextContent("This ends the duel.");
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
