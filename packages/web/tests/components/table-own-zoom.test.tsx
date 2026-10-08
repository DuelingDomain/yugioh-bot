// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { DuelEvent } from "@yugidraft/shared/duels";

vi.mock("next/font/google", () => {
  const font = () => ({ variable: "font-var", className: "font-class" });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});

// Counts every placement of a prompt room (the table recomputes the rooms only when its inputs change).
const placed = vi.hoisted(() => ({ calls: 0, noPanel: false }));
// `noPanel` makes the planner find no free room for the seat-choice panel (the CSS fallback rules then place it).
vi.mock("@/components/duel/table/geometry", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/duel/table/geometry")>();
  return {
    ...actual,
    promptRooms: (...args: Parameters<typeof actual.promptRooms>) => {
      const found = actual.promptRooms(...args);
      return placed.noPanel ? { ...found, panel: null } : found;
    },
  };
});
vi.mock("@/components/duel/table/view-zoom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/duel/table/view-zoom")>();
  return {
    ...actual,
    clearRoom: (...args: Parameters<typeof actual.clearRoom>) => { placed.calls += 1; return actual.clearRoom(...args); },
    fitRoom: (...args: Parameters<typeof actual.fitRoom>) => { placed.calls += 1; return actual.fitRoom(...args); },
  };
});

import { setAnimationSpeed } from "@/components/duel/animation-speed";
import { duelFxClock } from "@/components/duel/fx-clock";
import { FFA3_FIXTURES } from "@/components/duel/table/fixtures/ffa3";
import type { TableFixtureState } from "@/components/duel/table/fixtures/common";
import { useFixtureController } from "@/components/duel/table/fixtures/use-fixture-controller";
import { TableShell } from "@/components/duel/table/table-shell";
import type { CameraState } from "@/components/duel/table/types";

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
beforeEach(() => {
  placed.calls = 0;
  placed.noPanel = false;
  window.localStorage.clear();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date", "performance"] });
  setAnimationSpeed(1);
  duelFxClock.setReducedMotion(false);
  duelFxClock.resetReviewTimeline();
});
afterEach(() => {
  cleanup();
  document.querySelectorAll('[data-testid="hover-preview"]').forEach((node) => node.remove());
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const REN = 0;
const RYO = 1;
const BASE = FFA3_FIXTURES.states.main;

function Table({ state, camera }: { state: TableFixtureState; camera?: Partial<CameraState> }) {
  const controller = useFixtureController(state, {});
  return <TableShell controller={controller} initialCamera={camera} />;
}

const chip = (root: HTMLElement) => root.querySelector("[data-camera-chip] b")?.textContent;
const seatBox = (root: HTMLElement, seat: number) => root.querySelector(`[data-seat-slot="${seat}"]`) as HTMLElement;
const layer = (root: HTMLElement) => root.querySelector<HTMLElement>("[data-view-layer]")!;
const poseOf = (root: HTMLElement, seat: number) => seatBox(root, seat).parentElement?.getAttribute("style") ?? seatBox(root, seat).getAttribute("style");
const advance = (ms: number) => act(() => void vi.advanceTimersByTime(ms));
/** The chip reads the DOM on an animation frame: run the frames on the fake clock. */
const frames = () => {
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => clearTimeout(id));
  return vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => setTimeout(() => cb(performance.now()), 16) as unknown as number);
};
const idle = () => ({ ...BASE, room: { ...BASE.room, engine: { ...BASE.room.engine!, prompt: null } } }) as TableFixtureState;

describe("FFA3 own field camera zoom", () => {
  it("the zoom button zooms your field on the first click and never moves the seats", () => {
    const { container } = render(<Table state={idle()} />);
    const before = [REN, RYO].map((seat) => poseOf(container, seat));
    expect(before.every((pose) => /transform/.test(pose ?? ""))).toBe(true);
    const zoom = container.querySelector<HTMLElement>("[data-camera-zoom]");
    expect(zoom).not.toBeNull();
    fireEvent.click(zoom!);
    advance(500);
    expect(chip(container)).toBe("Focus · Ren Arata");
    expect([REN, RYO].map((seat) => poseOf(container, seat))).toEqual(before);
    expect(container.querySelector("[data-camera-zoom]")).toBeNull();
  });

  it("the first click on Back leaves the zoom", () => {
    const { container } = render(<Table state={idle()} camera={{ mode: "focus", focusSeat: REN }} />);
    advance(500);
    fireEvent.click(container.querySelector("[data-camera-back]")!);
    advance(500);
    expect(chip(container)).toBe("Home");
  });

  it("Esc leaves the zoom", () => {
    const { container } = render(<Table state={idle()} camera={{ mode: "focus", focusSeat: REN }} />);
    advance(500);
    fireEvent.keyDown(window, { key: "Escape" });
    advance(500);
    expect(chip(container)).toBe("Home");
  });

  it("a click on a field while zoomed does not move the camera", () => {
    const { container } = render(<Table state={idle()} camera={{ mode: "focus", focusSeat: REN }} />);
    advance(500);
    fireEvent.click(seatBox(container, REN));
    advance(500);
    expect(chip(container)).toBe("Focus · Ren Arata");
    expect(layer(container)).not.toBeNull();
  });

  it("a prompt that targets a rival field does not move the camera, and a chip points to that field", () => {
    frames();
    const state = FFA3_FIXTURES.states["target-pick"];
    const { container } = render(<Table state={state} camera={{ mode: "focus", focusSeat: REN }} />);
    advance(500);
    // Still your zoomed field: the camera did not move by itself.
    expect(chip(container)).toBe("Focus · Ren Arata");
    const hints = [...container.querySelectorAll<HTMLElement>("[data-rival-hint]")];
    expect(hints.length).toBeGreaterThan(0);
    expect(hints.every((hint) => Number(hint.dataset.rivalHint) !== REN)).toBe(true);
    expect(hints[0].textContent).toMatch(/\S/);
  });

  it("the first click on the chip zooms out", () => {
    frames();
    const state = FFA3_FIXTURES.states["target-pick"];
    const { container } = render(<Table state={state} camera={{ mode: "focus", focusSeat: REN }} />);
    advance(500);
    fireEvent.click(container.querySelector("[data-rival-hint]")!);
    advance(500);
    expect(chip(container)).toBe("Home");
    expect(container.querySelector("[data-rival-hint]")).toBeNull();
  });

  it("shows no chip when nothing targets a rival", () => {
    const { container } = render(<Table state={idle()} camera={{ mode: "focus", focusSeat: REN }} />);
    advance(500);
    expect(container.querySelector("[data-rival-hint]")).toBeNull();
  });

  /** jsdom has no layout: the board is 1100x860 and your hand cards stand at the bottom of it, when `hand` is set. */
  const layout = (hand?: { x: number; y: number; width: number; height: number }) => {
    const rect = (x: number, y: number, width: number, height: number) => ({ x, y, left: x, top: y, width, height, right: x + width, bottom: y + height, toJSON: () => ({}) }) as DOMRect;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      if (this.hasAttribute("data-table-stage")) return rect(0, 0, 1100, 860);
      if (hand && this.hasAttribute("data-hand-card") && this.closest('[data-hand-seat][data-side="you"]')) return rect(hand.x, hand.y, hand.width, hand.height);
      return rect(0, 0, 0, 0);
    });
  };
  const scale = (root: HTMLElement) => Number(/scale\(([\d.]+)\)/.exec(layer(root).style.transform)?.[1] ?? 1);
  const handScale = (root: HTMLElement) => root.querySelector<HTMLElement>('[data-hand-seat][data-side="you"]')?.style.transform ?? "";
  const board = (root: HTMLElement) => root.querySelector<HTMLElement>("[data-table-stage]")!;

  it("keeps the hand at its place while the zoom eases out, and clears it when the view is back", () => {
    frames();
    const { container } = render(<Table state={idle()} camera={{ mode: "focus", focusSeat: REN }} />);
    advance(600);
    expect(scale(container)).toBeGreaterThan(1.02);
    fireEvent.click(container.querySelector("[data-camera-back]")!);
    // Half way out: the view is between the zoom and 1x, and the hand still has its counter transform.
    advance(180);
    expect(scale(container)).toBeGreaterThan(1);
    expect(handScale(container)).toMatch(/scale\(0\./);
    advance(600);
    expect(chip(container)).toBe("Home");
    expect(layer(container).style.transform).toBe("");
    expect(handScale(container)).toBe("");
  });

  it("a wheel back to 1x sends the camera home", () => {
    frames();
    const { container } = render(<Table state={idle()} camera={{ mode: "focus", focusSeat: REN }} />);
    advance(600);
    expect(chip(container)).toBe("Focus · Ren Arata");
    for (let i = 0; i < 6; i++) {
      fireEvent.wheel(board(container), { deltaY: 400, clientX: 550, clientY: 430 });
      advance(120);
    }
    advance(600);
    expect(scale(container)).toBeLessThanOrEqual(1.001);
    expect(chip(container)).toBe("Home");
  });

  it("the pinned peek is measured again when its slide ends, so the refit does not keep the rect of the first frame", async () => {
    frames();
    layout();
    const { container } = render(<Table state={idle()} camera={{ mode: "focus", focusSeat: REN }} />);
    advance(600);
    const peek = document.createElement("aside");
    peek.setAttribute("data-testid", "hover-preview");
    peek.setAttribute("data-pinned", "true");
    const at = (width: number) => ({ x: 1100 - width, y: 0, left: 1100 - width, top: 0, width, height: 860, right: 1100, bottom: 860, toJSON: () => ({}) }) as DOMRect;
    // The peek has barely slid in when it is first read.
    peek.getBoundingClientRect = () => at(40);
    await act(async () => {
      container.querySelector("[data-table-shell]")!.appendChild(peek);
      await Promise.resolve();
    });
    advance(100);
    advance(800);
    const early = scale(container);
    // Its slide ends at full width: the transition end reads the rect again and the zoom fits the peek.
    peek.getBoundingClientRect = () => at(270);
    await act(async () => {
      peek.dispatchEvent(new Event("transitionend", { bubbles: true }));
      await Promise.resolve();
    });
    advance(100);
    advance(800);
    expect(scale(container)).toBeLessThan(early);
  });

  it("a pinned peek after the entry refits the zoom, and a wheel by hand is left alone", async () => {
    frames();
    layout();
    const { container } = render(<Table state={idle()} camera={{ mode: "focus", focusSeat: REN }} />);
    advance(600);
    const fitted = scale(container);
    const peek = document.createElement("aside");
    peek.setAttribute("data-testid", "hover-preview");
    peek.setAttribute("data-pinned", "true");
    peek.getBoundingClientRect = () => ({ x: 830, y: 0, left: 830, top: 0, width: 270, height: 860, right: 1100, bottom: 860, toJSON: () => ({}) }) as DOMRect;
    await act(async () => {
      container.querySelector("[data-table-shell]")!.appendChild(peek);
      await Promise.resolve();
    });
    // The frame that reads the peek, then the ease of the refit (React flushes the state when the first advance ends).
    advance(100);
    advance(800);
    const pinned = scale(container);
    expect(pinned).toBeLessThan(fitted);
    // The player zooms by hand: the peek that goes away does not undo it.
    fireEvent.wheel(board(container), { deltaY: -300, clientX: 300, clientY: 300 });
    advance(600);
    const byHand = scale(container);
    await act(async () => {
      peek.remove();
      await Promise.resolve();
    });
    advance(800);
    expect(scale(container)).toBeCloseTo(byHand, 3);
  });

  it("a chain strip that opens while the field is zoomed does not snap the view", () => {
    frames();
    const { container, rerender } = render(<Table state={idle()} camera={{ mode: "focus", focusSeat: REN }} />);
    advance(600);
    fireEvent.wheel(board(container), { deltaY: -300, clientX: 300, clientY: 300 });
    advance(600);
    const byHand = scale(container);
    expect(byHand).not.toBeCloseTo(scale(container) + 1, 3);
    rerender(<Table state={FFA3_FIXTURES.states["chain-2"]} camera={{ mode: "focus", focusSeat: REN }} />);
    advance(800);
    expect(scale(container)).toBeCloseTo(byHand, 3);
  });

  /** The same idle table with the third seat out of the duel (a 3-way down to a face-off). */
  const withMikaOut = () => {
    const engine = structuredClone(idle().room.engine!);
    engine.seats[2].lp = 0;
    engine.seats[2].eliminated = true;
    return { ...BASE, room: { ...BASE.room, engine } } as TableFixtureState;
  };

  it("an elimination keeps the zoom of your own field: no reset, no camera move, at every step of the regroup", () => {
    frames();
    const focus = { mode: "focus", focusSeat: REN } as const;
    const { container, rerender } = render(<Table state={idle()} camera={focus} />);
    advance(600);
    const before = scale(container);
    expect(before).toBeGreaterThan(1.02);
    rerender(<Table state={withMikaOut()} camera={focus} />);
    for (let t = 0; t < 4600; t += 100) {
      advance(100);
      expect(scale(container)).toBeGreaterThan(1.02);
      expect(chip(container)).toBe("Focus · Ren Arata");
    }
    expect(board(container).getAttribute("data-regroup")).toBeNull();
  });

  it("after the regroup the view is fitted to the new field again, with the same eased path", () => {
    frames();
    const focus = { mode: "focus", focusSeat: REN } as const;
    const { container, rerender } = render(<Table state={idle()} camera={focus} />);
    advance(600);
    rerender(<Table state={withMikaOut()} camera={focus} />);
    advance(300);
    expect(board(container).getAttribute("data-regroup")).toBe("true");
    const during = layer(container).style.transform;
    // The fit waits for the seats to stand still: the view does not move while they glide.
    advance(2500);
    expect(layer(container).style.transform).toBe(during);
    advance(2400);
    expect(board(container).getAttribute("data-regroup")).toBeNull();
    expect(scale(container)).toBeGreaterThan(1.02);
  });

  it("after an elimination the player's own zoom level stays", () => {
    frames();
    const focus = { mode: "focus", focusSeat: REN } as const;
    const { container, rerender } = render(<Table state={idle()} camera={focus} />);
    advance(600);
    fireEvent.wheel(board(container), { deltaY: -300, clientX: 300, clientY: 300 });
    advance(600);
    const byHand = scale(container);
    rerender(<Table state={withMikaOut()} camera={focus} />);
    advance(5000);
    expect(scale(container)).toBeCloseTo(byHand, 3);
    expect(chip(container)).toBe("Focus · Ren Arata");
  });

  it("an elimination at home does not move the camera", () => {
    frames();
    const { container, rerender } = render(<Table state={idle()} />);
    advance(600);
    expect(chip(container)).toBe("Home");
    rerender(<Table state={withMikaOut()} />);
    advance(5000);
    expect(chip(container)).toBe("Home");
    expect(layer(container).style.transform).toBe("");
  });

  it("in a face-off, a click on a rival zone keeps the zoom of your own field", () => {
    frames();
    const focus = { mode: "focus", focusSeat: REN } as const;
    const { container, rerender } = render(<Table state={idle()} camera={focus} />);
    advance(600);
    rerender(<Table state={withMikaOut()} camera={focus} />);
    advance(5000);
    const zone = seatBox(container, RYO).querySelector<HTMLElement>("[data-zones][data-occupied='true']:not([data-pile]):not([data-legal='true']) button")!;
    expect(zone).not.toBeNull();
    fireEvent.click(zone);
    advance(800);
    expect(board(container).getAttribute("data-camera-mode")).toBe("focus");
    expect(chip(container)).toBe("Focus · Ren Arata");
    expect(scale(container)).toBeGreaterThan(1.02);
  });

  it("in a face-off, Back and then E (or the Zoom my field button) zoom your own field again", () => {
    frames();
    const focus = { mode: "focus", focusSeat: REN } as const;
    const { container, rerender } = render(<Table state={idle()} camera={focus} />);
    advance(600);
    rerender(<Table state={withMikaOut()} camera={focus} />);
    advance(5000);
    fireEvent.click(container.querySelector("[data-camera-back]")!);
    advance(800);
    expect(chip(container)).toBe("Home");
    expect(scale(container)).toBeLessThanOrEqual(1.001);
    fireEvent.keyDown(window, { key: "e" });
    advance(800);
    expect(chip(container)).toBe("Focus · Ren Arata");
    expect(scale(container)).toBeGreaterThan(1.02);
    fireEvent.click(container.querySelector("[data-camera-back]")!);
    advance(800);
    fireEvent.click(container.querySelector("[data-camera-zoom]")!);
    advance(800);
    expect(chip(container)).toBe("Focus · Ren Arata");
    expect(scale(container)).toBeGreaterThan(1.02);
  });

  it("hides the Zoom my field button when your own seat is out", () => {
    const engine = structuredClone(idle().room.engine!);
    engine.seats[REN].lp = 0;
    engine.seats[REN].eliminated = true;
    const { container, rerender } = render(<Table state={idle()} />);
    expect(container.querySelector("[data-camera-zoom]")).not.toBeNull();
    rerender(<Table state={{ ...BASE, room: { ...BASE.room, engine } } as TableFixtureState} />);
    advance(5000);
    expect(container.querySelector("[data-camera-zoom]")).toBeNull();
  });

  it("Esc leaves the zoom of your own field in a face-off", () => {
    frames();
    const focus = { mode: "focus", focusSeat: REN } as const;
    const { container, rerender } = render(<Table state={idle()} camera={focus} />);
    advance(600);
    rerender(<Table state={withMikaOut()} camera={focus} />);
    advance(5000);
    fireEvent.keyDown(window, { key: "Escape" });
    advance(800);
    expect(chip(container)).toBe("Home");
    expect(scale(container)).toBeLessThanOrEqual(1.001);
  });

  it("a resize with no room to zoom keeps the focus: the camera does not go home by itself", () => {
    frames();
    const { container } = render(<Table state={idle()} camera={{ mode: "focus", focusSeat: REN }} />);
    advance(600);
    expect(chip(container)).toBe("Focus · Ren Arata");
    act(() => void window.dispatchEvent(new Event("resize")));
    advance(800);
    expect(chip(container)).toBe("Focus · Ren Arata");
  });

  it("the pick bar of a zoomed own field keeps off your hand", () => {
    frames();
    const hand = { x: 300, y: 700, width: 500, height: 160 };
    layout(hand);
    const { container } = render(<Table state={FFA3_FIXTURES.states["target-pick"]} camera={{ mode: "focus", focusSeat: REN }} />);
    advance(1500);
    const room = board(container).dataset.barRoom;
    expect(room).toBeTruthy();
    const [x, y, width, height] = room!.split(",").map(Number);
    const apart = x + width <= hand.x || x >= hand.x + hand.width || y + height <= hand.y || y >= hand.y + hand.height;
    expect(apart).toBe(true);
  });

  it("the rooms of the prompts are planned once at the fit, and the zoom itself never plans them again", () => {
    frames();
    layout({ x: 300, y: 700, width: 500, height: 160 });
    const { container } = render(<Table state={FFA3_FIXTURES.states["choose-opponent"]} camera={{ mode: "focus", focusSeat: REN }} />);
    // The entry ease runs to its end: the rooms are placed for the fit.
    advance(800);
    expect(placed.calls).toBeGreaterThan(0);
    const settled = placed.calls;
    const at = () => `${board(container).style.getPropertyValue("--room-x")},${board(container).style.getPropertyValue("--room-y")}|${board(container).dataset.barRoom ?? ""}`;
    const room = at();
    // A manual zoom and pan move the view for many frames: no frame plans a room again (the rooms do not read the live view).
    fireEvent.wheel(board(container), { deltaY: -300, clientX: 300, clientY: 300 });
    for (let i = 0; i < 60; i++) {
      advance(16);
      expect(placed.calls).toBe(settled);
    }
    expect(at()).toBe(room);
  });

  it("the seat-choice panel keeps off the HUD that stays on screen (a plate, the chip)", async () => {
    const rect = (x: number, y: number, width: number, height: number) => ({ x, y, left: x, top: y, width, height, right: x + width, bottom: y + height, toJSON: () => ({}) }) as DOMRect;
    const roomOf = (root: HTMLElement) => {
      const style = board(root).style;
      const n = (name: string) => Number.parseFloat(style.getPropertyValue(`--room-${name}`));
      return { x: n("x"), y: n("y"), width: n("w"), height: n("h") };
    };
    const hits = (a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
    const state = FFA3_FIXTURES.states["choose-opponent"];
    frames();
    layout({ x: 300, y: 700, width: 500, height: 160 });
    const first = render(<Table state={state} camera={{ mode: "focus", focusSeat: REN }} />);
    advance(800);
    const free = roomOf(first.container);
    expect(free.width).toBeGreaterThan(0);
    first.unmount();
    vi.restoreAllMocks();
    // The camera chip now stands on that room, and a card is pinned in the peek beside it.
    frames();
    const onRoom = rect(free.x, free.y, free.width, free.height);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      if (this.hasAttribute("data-table-stage")) return rect(0, 0, 1100, 860);
      if (this.hasAttribute("data-hand-card") && this.closest('[data-hand-seat][data-side="you"]')) return rect(300, 700, 500, 160);
      if (this.hasAttribute("data-camera-chip")) return onRoom;
      return rect(0, 0, 0, 0);
    });
    const second = render(<Table state={state} camera={{ mode: "focus", focusSeat: REN }} />);
    advance(900);
    const moved = roomOf(second.container);
    expect(moved.width).toBeGreaterThan(0);
    expect(hits(moved, onRoom)).toBe(false);
  });

  describe("the seat-choice panel room against the HUD, the hand and the legal targets", () => {
    type R = { x: number; y: number; width: number; height: number };
    const rect = (r: R) => ({ x: r.x, y: r.y, left: r.x, top: r.y, width: r.width, height: r.height, right: r.x + r.width, bottom: r.y + r.height, toJSON: () => ({}) }) as DOMRect;
    const hits = (a: R, b: R) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
    const state = FFA3_FIXTURES.states["choose-opponent"];
    // Renders the seat choice with a mocked layout: `hand` (the hand cards), `chip` (the camera chip), `none` (promptRooms finds no room).
    const place = (mock: { hand?: R; chip?: R }, camera: Partial<CameraState> = { mode: "focus", focusSeat: REN }) => {
      vi.restoreAllMocks();
      frames();
      vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
        if (this.hasAttribute("data-table-stage")) return rect({ x: 0, y: 0, width: 1100, height: 860 });
        if (mock.hand && this.hasAttribute("data-hand-card") && this.closest('[data-hand-seat][data-side="you"]')) return rect(mock.hand);
        if (mock.chip && this.hasAttribute("data-camera-chip")) return rect(mock.chip);
        return rect({ x: 0, y: 0, width: 0, height: 0 });
      });
      const view = render(<Table state={state} camera={camera} />);
      advance(900);
      const style = board(view.container).style;
      const n = (name: string) => Number.parseFloat(style.getPropertyValue(`--room-${name}`));
      const panel = board(view.container).hasAttribute("data-panel-room") ? { x: n("x"), y: n("y"), width: n("w"), height: n("h") } : null;
      view.unmount();
      return panel;
    };

    it("moves off the hand when the hand stands on its room", () => {
      // The hand stands on the room that the planner gives the panel at rest (x 251, y 116 with no hand there): the panel moves off it.
      const hand = { x: 240, y: 100, width: 260, height: 330 };
      const moved = place({ hand });
      expect(moved).not.toBeNull();
      expect(hits(moved!, hand)).toBe(false);
    });

    it("shrinks to the smallest room (220x170) where only a small place is clear", () => {
      const free = place({ hand: { x: 300, y: 700, width: 500, height: 160 } })!;
      expect(free.height).toBeGreaterThan(190);
      // The chip covers the upper part of the box and the hand the lower part: a strip of 206 px stays free between them.
      const strip = 170 + 36;
      const chip = { x: 0, y: 0, width: 1100, height: 300 };
      const hand = { x: 0, y: 300 + strip + 2 * 8, width: 1100, height: 860 - (300 + strip + 2 * 8) };
      const small = place({ chip, hand });
      expect(small).not.toBeNull();
      expect(small!.height).toBeGreaterThanOrEqual(170);
      expect(small!.height).toBeLessThan(free.height);
      expect(small!.width).toBeGreaterThanOrEqual(220);
      expect(hits(small!, chip)).toBe(false);
      expect(hits(small!, hand)).toBe(false);
    });

    it("gets a room off the HUD and the hand when the planner finds none and the CSS would put it at the lower left", () => {
      placed.noPanel = true;
      // The planner has no room: the room comes from the CSS fallback place (lower left), moved off the zoomed field.
      const fallback = place({ hand: { x: 300, y: 700, width: 500, height: 160 } });
      expect(fallback).not.toBeNull();
      // The hand and the chip now stand on the fallback place: the panel gets a room beside them.
      const hand = { x: 0, y: 380, width: 360, height: 480 };
      const chip = { x: 360, y: 380, width: 200, height: 60 };
      const beside = place({ hand, chip });
      expect(beside).not.toBeNull();
      expect(hits(beside!, hand)).toBe(false);
      expect(hits(beside!, chip)).toBe(false);
    });
  });

  it("the chip is HUD for the pan and keeps clear of the Reset control", () => {
    frames();
    const state = FFA3_FIXTURES.states["target-pick"];
    const first = render(<Table state={state} camera={{ mode: "focus", focusSeat: REN }} />);
    advance(800);
    const free = first.container.querySelector<HTMLElement>("[data-rival-hint]")!;
    expect(free.hasAttribute("data-zoom-occluder")).toBe(true);
    const home = { left: free.style.left, top: free.style.top };
    first.unmount();
    // The Reset control stands where the chip would: the chip slides along its edge to clear it.
    const rect = (x: number, y: number, width: number, height: number) => ({ x, y, left: x, top: y, width, height, right: x + width, bottom: y + height, toJSON: () => ({}) }) as DOMRect;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      if (this.hasAttribute("data-table-stage")) return rect(0, 0, 1100, 860);
      if (this.hasAttribute("data-view-reset")) return rect(0, 0, 160, 60);
      return rect(0, 0, 0, 0);
    });
    const second = render(<Table state={state} camera={{ mode: "focus", focusSeat: REN }} />);
    advance(800);
    const moved = second.container.querySelector<HTMLElement>("[data-rival-hint]")!;
    expect({ left: moved.style.left, top: moved.style.top }).not.toEqual(home);
    // It sits clear of the control.
    const x = Number.parseFloat(moved.style.left);
    const y = Number.parseFloat(moved.style.top);
    expect(x - 76 >= 160 || y - 14 >= 60).toBe(true);
    expect(moved.querySelector("span")?.textContent).toMatch(/\S/);
  });
});
