// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DuelRoom } from "@yugidraft/shared/duels";

const api = vi.hoisted(() => ({
  getDuelRoom: vi.fn(),
  setSandboxSeatControl: vi.fn(),
  sandboxGoToPhase: vi.fn(),
  sandboxNextTurn: vi.fn(),
  restartSandbox: vi.fn(),
  eliminateSandboxSeat: vi.fn(),
  saveSandboxState: vi.fn(),
  closeSandbox: vi.fn(),
}));
vi.mock("@/components/duel/api", () => api);
vi.mock("../src/components/duel/api", () => api);
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }) }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));

import { SandboxBar, explainWalk, sandboxInfoOf, type SandboxRoomInfo } from "@/components/duel/sandbox-bar";

const info = (over: Partial<SandboxRoomInfo> = {}): SandboxRoomInfo => ({
  board: {} as SandboxRoomInfo["board"],
  run: { bots: { "1": "pass", "2": "practice", "3": "pass" } },
  ...over,
});

function room(over: {
  phase?: string; turn?: number; turnSeat?: number; revision?: number; prioritySeat?: number | null; prompt?: unknown; format?: string;
  out?: number[]; name?: string; status?: string;
} = {}): DuelRoom {
  const count = over.format === "ffa4" ? 4 : over.format === "ffa3" ? 3 : 2;
  return {
    session: { format: over.format ?? "1v1", status: over.status ?? "active", name: over.name ?? "Column test" },
    engine: {
      turnSeat: over.turnSeat ?? 0, phase: over.phase ?? "Main 1", turn: over.turn ?? 1, revision: over.revision ?? 5,
      prioritySeat: over.prioritySeat ?? 0, prompt: over.prompt ?? null, result: null,
      seats: Array.from({ length: count }, (_, seat) => ({ seat, eliminated: over.out?.includes(seat) ? true : undefined })),
    },
  } as unknown as DuelRoom;
}

function mount(overrides: Partial<React.ComponentProps<typeof SandboxBar>> = {}) {
  const props = {
    slug: "abc", room: room(), info: info(), acting: 0, reveal: true, follow: false,
    onActAs: vi.fn(), onRoom: vi.fn(), onReveal: vi.fn(), onFollow: vi.fn(), onRestarted: vi.fn(), onClosed: vi.fn(),
    ...overrides,
  };
  render(<SandboxBar {...props} />);
  return props;
}

beforeEach(() => { Object.values(api).forEach((fn) => fn.mockReset()); });
afterEach(cleanup);

describe("SandboxBar", () => {
  it("makes a bot seat Manual, then acts as it with the reveal view", async () => {
    const next = room({ revision: 6 });
    api.setSandboxSeatControl.mockResolvedValue(room());
    api.getDuelRoom.mockResolvedValue(next);
    const props = mount();
    fireEvent.click(screen.getByTestId("sandbox-seat-1"));
    await waitFor(() => expect(props.onActAs).toHaveBeenCalledWith(1, next));
    expect(api.setSandboxSeatControl).toHaveBeenCalledWith("abc", 1, "manual", { as: 0, reveal: true });
    expect(api.getDuelRoom).toHaveBeenCalledWith("abc", false, { as: 1, reveal: true });
  });

  it("does not change a Manual seat when its chip is clicked", async () => {
    const next = room();
    api.getDuelRoom.mockResolvedValue(next);
    const props = mount({ info: info({ run: { bots: { "1": "manual", "2": "pass", "3": "pass" } } }) });
    fireEvent.click(screen.getByTestId("sandbox-seat-1"));
    await waitFor(() => expect(props.onActAs).toHaveBeenCalledWith(1, next));
    expect(api.setSandboxSeatControl).not.toHaveBeenCalled();
  });

  it("marks the seat the engine waits on with a dot", () => {
    mount({ room: room({ prioritySeat: 1 }) });
    expect(screen.getByTestId("sandbox-seat-1").querySelector("[role=img]")).not.toBeNull();
    expect(screen.getByTestId("sandbox-seat-0").querySelector("[role=img]")).toBeNull();
  });

  it("sets a seat mode from the menu", async () => {
    api.setSandboxSeatControl.mockResolvedValue(room());
    const props = mount({ room: room({ format: "ffa4" }) });
    fireEvent.click(screen.getByLabelText("Set P2 mode"));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Auto-pass" }));
    await waitFor(() => expect(props.onRoom).toHaveBeenCalled());
    expect(api.setSandboxSeatControl).toHaveBeenCalledWith("abc", 2, "pass", { as: 0, reveal: true });
  });

  it("walks to a phase and says where it stopped", async () => {
    api.sandboxGoToPhase.mockResolvedValue(room({
      phase: "Standby", revision: 9, prompt: { seat: 0, title: "Chain?", source: { name: "X" }, options: [], context: { type: "chain" } },
    }));
    const props = mount({ room: room({ phase: "Draw", revision: 8 }) });
    fireEvent.click(screen.getByTestId("sandbox-go-to-phase"));
    fireEvent.click(screen.getByTestId("sandbox-phase-battle"));
    await waitFor(() => expect(props.onRoom).toHaveBeenCalled());
    expect(api.sandboxGoToPhase).toHaveBeenCalledWith("abc", "battle", { as: 0, reveal: true });
  });

  it("walks to the next turn", async () => {
    api.sandboxNextTurn.mockResolvedValue(room({ turn: 2, phase: "Draw" }));
    const props = mount();
    fireEvent.click(screen.getByTestId("sandbox-next-turn"));
    await waitFor(() => expect(props.onRoom).toHaveBeenCalled());
    expect(api.sandboxNextTurn).toHaveBeenCalledWith("abc", { as: 0, reveal: true });
  });

  it("disables phases that are already past", () => {
    mount({ room: room({ phase: "Main 2" }) });
    fireEvent.click(screen.getByTestId("sandbox-go-to-phase"));
    expect(screen.getByTestId("sandbox-phase-battle")).toBeDisabled();
    expect(screen.getByTestId("sandbox-phase-end")).toBeEnabled();
  });

  it("shows a failed walk as an alert", async () => {
    api.sandboxNextTurn.mockRejectedValue(new Error("The engine is busy."));
    mount();
    fireEvent.click(screen.getByTestId("sandbox-next-turn"));
    expect(await screen.findByRole("alert")).toHaveTextContent("The engine is busy.");
  });

  it("toggles Reveal hands and Follow prompt", () => {
    const props = mount();
    const reveal = screen.getByLabelText("Reveal hands") as HTMLInputElement;
    expect(reveal.checked).toBe(true);
    fireEvent.click(reveal);
    expect(props.onReveal).toHaveBeenCalledWith(false);
    fireEvent.click(screen.getByLabelText("Follow prompt"));
    expect(props.onFollow).toHaveBeenCalledWith(true);
  });

  it("restarts and hands over the new slug", async () => {
    api.restartSandbox.mockResolvedValue({ slug: "next" });
    const props = mount();
    fireEvent.click(screen.getByTestId("sandbox-restart"));
    await waitFor(() => expect(props.onRestarted).toHaveBeenCalledWith("next"));
  });

  it("hides Copy link for an unsaved board and links back to the builder", () => {
    mount();
    expect(screen.queryByTestId("sandbox-copy")).toBeNull();
    expect(screen.getByTestId("sandbox-builder")).toHaveAttribute("href", "/sandbox/new?from=abc");
  });

  it("shows Copy link and a saved-scenario builder link for a saved board", () => {
    mount({ info: info({ scenarioId: 7 }) });
    expect(screen.getByTestId("sandbox-copy")).toBeInTheDocument();
    expect(screen.getByTestId("sandbox-builder")).toHaveAttribute("href", "/sandbox/7");
  });

  it("shows four seat chips in a 4-way table", () => {
    mount({ room: room({ format: "ffa4" }) });
    expect([0, 1, 2, 3].map((seat) => screen.getByTestId(`sandbox-seat-${seat}`))).toHaveLength(4);
  });
});

describe("SandboxBar eliminate", () => {
  it("asks first, then sends the eliminate action for that seat", async () => {
    const next = room({ format: "ffa3", out: [2], revision: 6 });
    api.eliminateSandboxSeat.mockResolvedValue(next);
    const props = mount({ room: room({ format: "ffa3" }) });
    fireEvent.click(screen.getByLabelText("Set P2 mode"));
    fireEvent.click(screen.getByTestId("sandbox-eliminate-2"));
    expect(api.eliminateSandboxSeat).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("sandbox-eliminate-confirm-2"));
    await waitFor(() => expect(props.onRoom).toHaveBeenCalledWith(next));
    expect(api.eliminateSandboxSeat).toHaveBeenCalledWith("abc", 2, { as: 0, reveal: true });
  });

  it("keeps the turn player in with the builder message", () => {
    mount({ room: room({ format: "ffa4", turnSeat: 2 }) });
    fireEvent.click(screen.getByLabelText("Set P2 mode"));
    expect(screen.getByTestId("sandbox-eliminate-2")).toBeDisabled();
    expect(screen.getByTestId("sandbox-eliminate-2")).toHaveAttribute("title", "The turn player stays in.");
    expect(api.eliminateSandboxSeat).not.toHaveBeenCalled();
  });

  it("cancel keeps the seat in", () => {
    mount({ room: room({ format: "ffa4" }) });
    fireEvent.click(screen.getByLabelText("Set P3 mode"));
    fireEvent.click(screen.getByTestId("sandbox-eliminate-3"));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(api.eliminateSandboxSeat).not.toHaveBeenCalled();
    expect(screen.getByTestId("sandbox-eliminate-3")).toBeInTheDocument();
  });

  it("offers seat 0 an options menu with Eliminate only in FFA", () => {
    mount({ room: room({ format: "ffa4", turnSeat: 1 }) });
    fireEvent.click(screen.getByLabelText("P0 options"));
    expect(screen.getByTestId("sandbox-eliminate-0")).toBeEnabled();
    expect(screen.queryByRole("menuitemradio")).toBeNull();
  });

  it("goes back to seat 0 when the acting seat is eliminated", async () => {
    const next = room({ format: "ffa3", out: [1] });
    api.eliminateSandboxSeat.mockResolvedValue(next);
    api.getDuelRoom.mockResolvedValue(next);
    const props = mount({
      room: room({ format: "ffa3" }), acting: 1,
      info: info({ run: { bots: { "1": "manual", "2": "pass", "3": "pass" } } }),
    });
    fireEvent.click(screen.getByLabelText("Set P1 mode"));
    fireEvent.click(screen.getByTestId("sandbox-eliminate-1"));
    fireEvent.click(screen.getByTestId("sandbox-eliminate-confirm-1"));
    await waitFor(() => expect(props.onActAs).toHaveBeenCalledWith(0, next));
    expect(api.getDuelRoom).toHaveBeenCalledWith("abc", false, { as: 0, reveal: true });
  });

  it.each([0, 2])("selects the first living seat after eliminating acting seat %i with P0 out", async (acting) => {
    const next = room({ format: "ffa4", turnSeat: 3, out: acting === 0 ? [0] : [0, 2] });
    api.eliminateSandboxSeat.mockResolvedValue(next);
    api.setSandboxSeatControl.mockResolvedValue(next);
    api.getDuelRoom.mockResolvedValue(next);
    const props = mount({ room: room({ format: "ffa4", turnSeat: 3, out: acting === 0 ? [] : [0] }), acting });
    fireEvent.click(screen.getByLabelText(acting === 0 ? "P0 options" : "Set P2 mode"));
    fireEvent.click(screen.getByTestId(`sandbox-eliminate-${acting}`));
    fireEvent.click(screen.getByTestId(`sandbox-eliminate-confirm-${acting}`));
    await waitFor(() => expect(props.onActAs).toHaveBeenCalledWith(1, next));
    expect(api.setSandboxSeatControl).toHaveBeenCalledWith("abc", 1, "manual", { as: acting, reveal: true });
    expect(api.getDuelRoom).toHaveBeenCalledWith("abc", false, { as: 1, reveal: true });
  });

  it("shows an eliminated seat as Out and disables it", () => {
    mount({ room: room({ format: "ffa3", out: [1] }) });
    const chip = screen.getByTestId("sandbox-seat-1");
    expect(chip).toBeDisabled();
    expect(chip).toHaveTextContent("Out");
    expect(screen.queryByLabelText("Set P1 mode")).toBeNull();
  });

  it("disables Eliminate when only two seats are left", () => {
    mount({ room: room({ format: "ffa3", out: [1] }) });
    fireEvent.click(screen.getByLabelText("Set P2 mode"));
    expect(screen.getByTestId("sandbox-eliminate-2")).toBeDisabled();
  });

  it("has no Eliminate in a 1v1 room", () => {
    mount();
    fireEvent.click(screen.getByLabelText("Set P1 mode"));
    expect(screen.queryByTestId("sandbox-eliminate-1")).toBeNull();
    expect(screen.queryByLabelText("P0 options")).toBeNull();
  });

  it("shows a refused elimination and stays in the duel", async () => {
    api.eliminateSandboxSeat.mockRejectedValue(new Error("Seat already eliminated."));
    const props = mount({ room: room({ format: "ffa4" }) });
    fireEvent.click(screen.getByLabelText("Set P2 mode"));
    fireEvent.click(screen.getByTestId("sandbox-eliminate-2"));
    fireEvent.click(screen.getByTestId("sandbox-eliminate-confirm-2"));
    expect(await screen.findByRole("alert")).toHaveTextContent("Seat already eliminated.");
    expect(props.onClosed).not.toHaveBeenCalled();
  });
});

describe("SandboxBar save state", () => {
  it("offers the default name and saves it with the view", async () => {
    api.saveSandboxState.mockResolvedValue({ scenario: { id: 11, name: "x" }, lost: [] });
    mount({ room: room({ turn: 3, phase: "Battle", name: "Column test" }) });
    fireEvent.click(screen.getByTestId("sandbox-save-state"));
    const input = screen.getByTestId("sandbox-state-name") as HTMLInputElement;
    expect(input.value).toBe("Column test - turn 3 Battle");
    fireEvent.change(input, { target: { value: "  My state  " } });
    fireEvent.click(screen.getByTestId("sandbox-state-save"));
    await waitFor(() => expect(api.saveSandboxState).toHaveBeenCalledWith("abc", { name: "My state" }, { as: 0, reveal: true }));
    expect(api.closeSandbox).not.toHaveBeenCalled();
  });

  it("shows the lost items and a link to the saved scenario", async () => {
    api.saveSandboxState.mockResolvedValue({ scenario: { id: 11, name: "Column test - turn 1 Main 1" }, lost: ["Counters", "Equip links"] });
    mount();
    fireEvent.click(screen.getByTestId("sandbox-save-state"));
    fireEvent.click(screen.getByTestId("sandbox-state-save"));
    expect(await screen.findByTestId("sandbox-saved")).toHaveTextContent("Column test - turn 1 Main 1");
    expect(screen.getByTestId("sandbox-saved-link")).toHaveAttribute("href", "/sandbox/11");
    expect(screen.getByTestId("sandbox-lost").textContent).toContain("Counters");
    expect(screen.getByTestId("sandbox-lost").textContent).toContain("Equip links");
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByTestId("sandbox-saved")).toBeNull();
  });

  it("keeps the saved id after dismissal for Save state and Save & close", async () => {
    api.saveSandboxState.mockResolvedValue({ scenario: { id: 11, name: "State" }, lost: [] });
    api.closeSandbox.mockResolvedValue({ ok: true });
    const props = mount();
    for (let save = 0; save < 2; save++) {
      fireEvent.click(screen.getByTestId("sandbox-save-state"));
      fireEvent.click(screen.getByTestId("sandbox-state-save"));
      await screen.findByTestId("sandbox-saved");
      expect(api.saveSandboxState.mock.calls[save][1]).toEqual({ name: "Column test - turn 1 Main 1", ...(save ? { scenarioId: 11 } : {}) });
      fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    }
    fireEvent.click(screen.getByTestId("sandbox-exit"));
    fireEvent.click(screen.getByTestId("sandbox-save-close"));
    await waitFor(() => expect(props.onClosed).toHaveBeenCalled());
    expect(api.saveSandboxState.mock.calls[2][1]).toMatchObject({ scenarioId: 11 });
  });

  it.each(["sandbox-state-save", "sandbox-save-close"])("updates the source scenario with %s", async (button) => {
    api.saveSandboxState.mockResolvedValue({ scenario: { id: 7, name: "State" }, lost: [] });
    api.closeSandbox.mockResolvedValue({ ok: true });
    mount({ info: info({ scenarioId: 7 }) });
    fireEvent.click(screen.getByTestId(button === "sandbox-state-save" ? "sandbox-save-state" : "sandbox-exit"));
    fireEvent.click(screen.getByTestId(button));
    await waitFor(() => expect(api.saveSandboxState).toHaveBeenCalledWith("abc",
      { name: "Column test - turn 1 Main 1", scenarioId: 7 }, { as: 0, reveal: true }));
  });

  it("does not send an empty name", () => {
    mount();
    fireEvent.click(screen.getByTestId("sandbox-save-state"));
    fireEvent.change(screen.getByTestId("sandbox-state-name"), { target: { value: "   " } });
    expect(screen.getByTestId("sandbox-state-save")).toBeDisabled();
    expect(api.saveSandboxState).not.toHaveBeenCalled();
  });

  it("shows a save error as an alert", async () => {
    api.saveSandboxState.mockRejectedValue(new Error("Could not read the engine."));
    mount();
    fireEvent.click(screen.getByTestId("sandbox-save-state"));
    fireEvent.click(screen.getByTestId("sandbox-state-save"));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not read the engine.");
    expect(screen.queryByTestId("sandbox-saved")).toBeNull();
  });

  it("works in a 4-way shell", async () => {
    api.saveSandboxState.mockResolvedValue({ scenario: { id: 2, name: "n" }, lost: [] });
    mount({ room: room({ format: "ffa4", out: [3] }) });
    fireEvent.click(screen.getByTestId("sandbox-save-state"));
    fireEvent.click(screen.getByTestId("sandbox-state-save"));
    await waitFor(() => expect(api.saveSandboxState).toHaveBeenCalled());
  });
});

describe("SandboxBar exit", () => {
  const exitMenu = () => fireEvent.click(screen.getByTestId("sandbox-exit"));

  it("Save & close saves, then closes, then leaves, in that order", async () => {
    const calls: string[] = [];
    api.saveSandboxState.mockImplementation(async () => { calls.push("save"); return { scenario: { id: 4, name: "s" }, lost: [] }; });
    api.closeSandbox.mockImplementation(async () => { calls.push("close"); return { ok: true }; });
    const onClosed = vi.fn(() => { calls.push("leave"); });
    const props = mount({ room: room({ turn: 2, phase: "Main 2", name: "Col" }), onClosed });
    exitMenu();
    fireEvent.click(screen.getByTestId("sandbox-save-close"));
    await waitFor(() => expect(props.onClosed).toHaveBeenCalledTimes(1));
    expect(calls).toEqual(["save", "close", "leave"]);
    expect(api.saveSandboxState).toHaveBeenCalledWith("abc", { name: "Col - turn 2 Main 2" }, { as: 0, reveal: true });
    expect(api.closeSandbox).toHaveBeenCalledWith("abc", { as: 0, reveal: true });
  });

  it("a failed save leaves the duel open", async () => {
    api.saveSandboxState.mockRejectedValue(new Error("Scenario limit reached."));
    const props = mount();
    exitMenu();
    fireEvent.click(screen.getByTestId("sandbox-save-close"));
    expect(await screen.findByRole("alert")).toHaveTextContent("Scenario limit reached.");
    expect(api.closeSandbox).not.toHaveBeenCalled();
    expect(props.onClosed).not.toHaveBeenCalled();
    expect(screen.getByTestId("sandbox-bar")).toBeInTheDocument();
  });

  it("a failed close after a save keeps the duel and the saved link", async () => {
    api.saveSandboxState.mockResolvedValue({ scenario: { id: 9, name: "kept" }, lost: ["Counters"] });
    api.closeSandbox.mockRejectedValue(new Error("The host is busy."));
    const props = mount();
    exitMenu();
    fireEvent.click(screen.getByTestId("sandbox-save-close"));
    expect(await screen.findByRole("alert")).toHaveTextContent("The host is busy.");
    expect(props.onClosed).not.toHaveBeenCalled();
    expect(screen.getByTestId("sandbox-saved-link")).toHaveAttribute("href", "/sandbox/9");
  });

  it("Close asks first, then closes without saving", async () => {
    api.closeSandbox.mockResolvedValue({ ok: true });
    const props = mount({ room: room({ format: "ffa3" }) });
    exitMenu();
    fireEvent.click(screen.getByTestId("sandbox-close"));
    expect(api.closeSandbox).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("sandbox-close-confirm"));
    await waitFor(() => expect(props.onClosed).toHaveBeenCalledTimes(1));
    expect(api.closeSandbox).toHaveBeenCalledWith("abc", { as: 0, reveal: true });
    expect(api.saveSandboxState).not.toHaveBeenCalled();
  });

  it("a failed Close shows the error and stays", async () => {
    api.closeSandbox.mockRejectedValue(new Error("The host is busy."));
    const props = mount();
    exitMenu();
    fireEvent.click(screen.getByTestId("sandbox-close"));
    fireEvent.click(screen.getByTestId("sandbox-close-confirm"));
    expect(await screen.findByRole("alert")).toHaveTextContent("The host is busy.");
    expect(props.onClosed).not.toHaveBeenCalled();
  });

  it("keeps Exit visible after the duel ends, with Save & close off", () => {
    mount({ room: room({ status: "finished" }) });
    exitMenu();
    expect(screen.getByTestId("sandbox-save-close")).toBeDisabled();
    expect(screen.getByTestId("sandbox-close")).toBeEnabled();
  });
});

describe("explainWalk", () => {
  const before = { turn: 1, phase: "Draw" };
  it("reports an effect window in the phase", () => {
    const note = explainWalk("battle", before, room({
      phase: "Standby", prompt: { seat: 0, title: "Chain?", source: { name: "X" }, options: [], context: { type: "chain" } },
    }), info(), 0);
    expect(note).toMatchObject({ tone: "stop", text: "Stopped: effect window in Standby." });
  });
  it("reports success at the target", () => {
    expect(explainWalk("main2", before, room({ phase: "Main 2" }), info(), 0)).toMatchObject({ tone: "ok", text: "At Main 2." });
  });
  it("names a bot seat that holds the walk", () => {
    const note = explainWalk("end", before, room({ phase: "Main 1", prioritySeat: 2 }), info(), 0);
    expect(note?.text).toContain("P2 (Practice bot)");
  });
  it("says a past phase is past", () => {
    const note = explainWalk("standby", { turn: 1, phase: "Main 2" }, room({ phase: "Main 2" }), info(), 0);
    expect(note?.text).toContain("already past");
  });
  it("reports the new turn", () => {
    expect(explainWalk("next-turn", before, room({ turn: 2, phase: "Draw" }), info(), 0)?.text).toBe("Turn 2: Draw Phase.");
  });
});

describe("sandboxInfoOf", () => {
  it("reads room.sandbox and ignores other rooms", () => {
    expect(sandboxInfoOf(room())).toBeNull();
    expect(sandboxInfoOf({ ...room(), sandbox: info({ scenarioId: 3 }) } as unknown as DuelRoom)?.scenarioId).toBe(3);
  });
});
