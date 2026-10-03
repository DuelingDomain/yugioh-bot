// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next/font/google", () => {
  const font = () => ({ variable: "font-var", className: "font-class" });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});

import { FFA3_FIXTURES } from "@/components/duel/table/fixtures/ffa3";
import { useFixtureController } from "@/components/duel/table/fixtures/use-fixture-controller";
import { aimCurve } from "@/components/duel/table/attack-line";
import { OpponentBar } from "@/components/duel/table/opponent-bar";
import { TurnRing } from "@/components/duel/table/turn-ring";
import { TableShell } from "@/components/duel/table/table-shell";
import { tiltSupersample } from "@/components/duel/table/table-stage";
import { tableLayout } from "@/components/duel/table/geometry";
import type { CameraLockReason, CameraState } from "@/components/duel/table/types";

beforeAll(() => {
  class RO {
    constructor(private cb: () => void) {}
    observe() { this.cb(); }
    disconnect() {}
    unobserve() {}
  }
  vi.stubGlobal("ResizeObserver", RO);
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: false, media: query, addEventListener: () => {}, removeEventListener: () => {} }));
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 1100 });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 860 });
});
afterEach(cleanup);

function Shell({ id, camera, lock, leavingSeat }: { id: keyof typeof FFA3_FIXTURES.states; camera?: Partial<CameraState>; lock?: CameraLockReason | null; leavingSeat?: number }) {
  const source = FFA3_FIXTURES.states[id];
  const fixture = leavingSeat == null ? source : { ...source, room: { ...source.room, engine: { ...source.room.engine!,
    seats: source.room.engine!.seats.map(seat => ({ ...seat, pendingElimination: seat.seat === leavingSeat })) } } };
  const controller = useFixtureController(fixture, { reducedMotion: true });
  return <TableShell controller={controller} initialCamera={camera} initialLock={lock} />;
}
const press = (key: string, init: KeyboardEventInit = {}) => act(() => void fireEvent.keyDown(window, { key, ...init }));
const stageOf = (container: HTMLElement) => container.querySelector("[data-table-stage]")!;

describe("camera keys on the 3-way shell", () => {
  it("keeps a Leaving rival's field available to focus", () => {
    const { container } = render(<Shell id="main" leavingSeat={1} camera={{ mode: "focus", focusSeat: 1 }} />);
    expect(stageOf(container)).toHaveAttribute("data-camera-mode", "focus");
  });
  it("opens a reloaded elimination view at home with the full centred turn ring", () => {
    const { container } = render(<Shell id="elimination" />);
    expect(stageOf(container).getAttribute("data-camera-mode")).toBe("home");
    expect(container.querySelector("[data-camera-cue]")).toBeNull();
    expect(container.querySelector("[data-turn-ring]")?.getAttribute("style")).toContain("translate(488px, 260px) scale(1)");
  });

  it("steps focus with Tab and Shift+Tab, and sends Home back", () => {
    const { container } = render(<Shell id="main" />);
    const stage = stageOf(container);
    expect(stage.getAttribute("data-camera-mode")).toBe("home");
    press("Tab");
    expect(stage.getAttribute("data-camera-mode")).toBe("focus");
    press("Tab", { shiftKey: true });
    press("h");
    expect(stage.getAttribute("data-camera-mode")).toBe("home");
  });

  it("looks from a seat with P and goes to the fly-in overview with 0", () => {
    const { container } = render(<Shell id="main" />);
    const stage = stageOf(container);
    press("p");
    expect(stage.getAttribute("data-camera-mode")).toBe("look");
    press("0");
    expect(stage.getAttribute("data-camera-mode")).toBe("fly");
    expect(stage.getAttribute("data-fly")).toBe("true");
    press("2");
    expect(stage.getAttribute("data-camera-mode")).toBe("fly");
    press("h");
    expect(stage.getAttribute("data-fly")).toBe("false");
  });

  it("ignores keys with a modifier and keys typed in a field", () => {
    const { container } = render(<Shell id="main" />);
    press("Tab", { ctrlKey: true });
    expect(stageOf(container).getAttribute("data-camera-mode")).toBe("home");
    const input = document.createElement("input");
    document.body.append(input);
    act(() => void fireEvent.keyDown(input, { key: "0" }));
    expect(stageOf(container).getAttribute("data-camera-mode")).toBe("home");
    input.remove();
  });

  it("starts where the preview asks and shows the FX lock chip", () => {
    const { container } = render(<Shell id="main" camera={{ mode: "focus", focusSeat: 1 }} lock="battle" />);
    const stage = stageOf(container);
    expect(stage.getAttribute("data-camera-lock")).toBe("true");
    expect(stage.getAttribute("data-camera-mode")).toBe("home");
    expect(stage.getAttribute("data-camera-want")).toBe("focus");
    expect(container.querySelector("[data-camera-chip]")?.textContent).toContain("Camera locked · FX");
    press("0");
    expect(stage.getAttribute("data-camera-want")).toBe("focus");
  });

  it("opens in the fly-in when asked", () => {
    const { container } = render(<Shell id="main" camera={{ mode: "fly" }} />);
    expect(stageOf(container).getAttribute("data-fly")).toBe("true");
  });

  it("marks the canvas as tilted only while the world is off identity, so a flat view has no 3D camera", () => {
    const { container } = render(<Shell id="main" />);
    const canvas = () => container.querySelector("[data-fly-capable]")!;
    expect(canvas().hasAttribute("data-tilted")).toBe(false);
    press("0");
    expect(canvas().hasAttribute("data-tilted")).toBe(true);
    press("h");
    expect(canvas().hasAttribute("data-tilted")).toBe(false);
  });

  it("keeps the tilt on while the world eases back, and drops it when the tween ends (motion on)", () => {
    let now = 1000;
    let queue: FrameRequestCallback[] = [];
    const nowSpy = vi.spyOn(performance, "now").mockImplementation(() => now);
    const realRaf = window.requestAnimationFrame;
    const realCancel = window.cancelAnimationFrame;
    window.requestAnimationFrame = (cb: FrameRequestCallback) => queue.push(cb);
    window.cancelAnimationFrame = () => {};
    const frame = (advanceMs: number) => {
      now += advanceMs;
      const run = queue;
      queue = [];
      act(() => run.forEach((cb) => cb(now)));
    };
    function Moving() {
      const controller = useFixtureController(FFA3_FIXTURES.states.main, { reducedMotion: false });
      return <TableShell controller={controller} />;
    }
    try {
      const { container } = render(<Moving />);
      const canvas = () => container.querySelector("[data-fly-capable]")!;
      press("0");
      frame(16);
      expect(stageOf(container).getAttribute("data-fly")).toBe("true");
      expect(canvas().hasAttribute("data-tilted")).toBe(true);
      press("h");
      frame(16);
      // The board is flat at once, but the world is still tilted: the 3D camera must stay until it is back at identity.
      expect(stageOf(container).getAttribute("data-fly")).toBe("false");
      expect(canvas().hasAttribute("data-tilted")).toBe(true);
      for (let i = 0; i < 80 && queue.length; i++) frame(16);
      expect(canvas().hasAttribute("data-tilted")).toBe(false);
    } finally {
      nowSpy.mockRestore();
      window.requestAnimationFrame = realRaf;
      window.cancelAnimationFrame = realCancel;
    }
  });

  it("supersamples the tilted plane about two texels per screen pixel, in quarter steps within 1.5 to 4", () => {
    expect(tiltSupersample(1)).toBe(2);
    expect(tiltSupersample(0.96)).toBe(2);
    expect(tiltSupersample(1.3)).toBe(2.5);
    expect(tiltSupersample(0.3)).toBe(1.5);
    expect(tiltSupersample(9)).toBe(4);
  });
});

describe("attack aim on the 3-way shell", () => {
  const legal = (container: HTMLElement) => container.querySelector("[data-zones][data-legal='true']") as HTMLElement;

  it("hover aims, a click locks, Esc lets go", () => {
    const { container } = render(<Shell id="battle-aim" />);
    expect(container.querySelector("[data-attack-line]")).not.toBeNull();
    const target = legal(container);
    act(() => void fireEvent.pointerOver(target));
    expect(container.querySelector("[data-attack-line]")?.getAttribute("data-attack-line")).toBe("aim");
    act(() => void fireEvent.click(target.matches("button") ? target : (target.querySelector("button") ?? target)));
    expect(container.querySelector("[data-attack-line]")?.getAttribute("data-attack-line")).toBe("locked");
    // The confirm sits on the locked card (a popover on the body), not in the opponent bar.
    expect(document.querySelector("[data-attack-confirm]")).not.toBeNull();
    expect(container.querySelector("[data-opponent-bar='confirm']")).toBeNull();
    press("Escape");
    expect(document.querySelector("[data-attack-confirm]")).toBeNull();
    expect(container.querySelector("[data-attack-line]")?.getAttribute("data-attack-line")).not.toBe("locked");
  });

  it("keeps the camera keys working while aiming", () => {
    const { container } = render(<Shell id="battle-aim" />);
    expect(stageOf(container).getAttribute("data-camera-mode")).toBe("home");
    press("0");
    expect(stageOf(container).getAttribute("data-camera-mode")).toBe("fly");
  });

  it("a direct attack shows the rival bar and locks on the first pick", () => {
    const { container } = render(<Shell id="direct-attack" />);
    const bar = container.querySelector("[data-opponent-bar='direct']");
    expect(bar).not.toBeNull();
    const rival = bar!.querySelector("[data-rival-seat]") as HTMLElement;
    act(() => void fireEvent.click(rival));
    expect(container.querySelector("[data-attack-line]")?.getAttribute("data-attack-line")).toBe("locked");
  });

  it("a choose-opponent prompt marks the legal LP panels", () => {
    const { container } = render(<Shell id="choose-opponent" />);
    expect(container.querySelectorAll("[data-holo][data-legal='true']").length).toBeGreaterThan(0);
  });
});

describe("pieces", () => {
  it("aimCurve starts and ends on its points", () => {
    const path = aimCurve({ x: 100, y: 700 }, { x: 300, y: 100 });
    expect(path.startsWith("M100 700 Q")).toBe(true);
    expect(path.endsWith("300 100")).toBe(true);
  });

  it("OpponentBar gives every rival a hotkey and calls back", () => {
    const onPick = vi.fn();
    const onConfirm = vi.fn();
    const { container } = render(
      <OpponentBar
        kind="direct"
        title="Select a duelist to attack"
        entries={[
          { seat: 1, name: "Ryo", tone: "ice", hotkey: 1, locked: true },
          { seat: 2, name: "Mika", tone: "verdant", hotkey: 2 },
        ]}
        onPick={onPick}
        onConfirm={onConfirm}
      />,
    );
    const buttons = container.querySelectorAll("[data-rival-seat]");
    expect(buttons).toHaveLength(2);
    fireEvent.click(buttons[1]);
    expect(onPick).toHaveBeenCalledWith(2);
    fireEvent.click(container.querySelector("[data-testid='aim-confirm']")!);
    expect(onConfirm).toHaveBeenCalled();
  });

  it("TurnRing draws one node per seat and says when the camera is locked", () => {
    const state = FFA3_FIXTURES.states.main;
    const engine = state.room.engine!;
    const layout = tableLayout("ffa3", engine, 0);
    const angles = new Map(layout.slots.map((slot, i) => [slot.seat, 90 + i * 120]));
    const { container } = render(<TurnRing layout={layout} engine={engine} angles={angles} pose={{ x: 550, y: 322, scale: 1 }} promptSeat={0} locked />);
    expect(container.querySelector("[data-turn-ring]")).not.toBeNull();
    expect(container.textContent).toContain("Camera locked");
  });
});
