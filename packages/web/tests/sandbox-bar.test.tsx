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

function room(over: { phase?: string; turn?: number; revision?: number; prioritySeat?: number | null; prompt?: unknown; format?: string } = {}): DuelRoom {
  return {
    session: { format: over.format ?? "1v1", status: "active" },
    engine: {
      phase: over.phase ?? "Main 1", turn: over.turn ?? 1, revision: over.revision ?? 5,
      prioritySeat: over.prioritySeat ?? 0, prompt: over.prompt ?? null, result: null,
    },
  } as unknown as DuelRoom;
}

function mount(overrides: Partial<React.ComponentProps<typeof SandboxBar>> = {}) {
  const props = {
    slug: "abc", room: room(), info: info(), acting: 0, reveal: true, follow: false,
    onActAs: vi.fn(), onRoom: vi.fn(), onReveal: vi.fn(), onFollow: vi.fn(), onRestarted: vi.fn(),
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
