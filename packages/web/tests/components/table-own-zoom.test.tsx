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
      document.body.appendChild(peek);
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

  it("a seat-choice panel moves at most once while the zoom settles, and a pan does not move it again", () => {
    frames();
    layout({ x: 300, y: 700, width: 500, height: 160 });
    const { container } = render(<Table state={FFA3_FIXTURES.states["choose-opponent"]} camera={{ mode: "focus", focusSeat: REN }} />);
    const seen: string[] = [];
    const sample = () => {
      const at = `${board(container).style.getPropertyValue("--room-x")},${board(container).style.getPropertyValue("--room-y")}|${board(container).dataset.barRoom ?? ""}`;
      if (seen[seen.length - 1] !== at) seen.push(at);
    };
    for (let i = 0; i < 60; i++) {
      advance(16);
      sample();
    }
    const settled = seen.length;
    // A manual pan and zoom: the rooms stay where they are.
    fireEvent.wheel(board(container), { deltaY: -300, clientX: 300, clientY: 300 });
    for (let i = 0; i < 60; i++) {
      advance(16);
      sample();
    }
    expect(seen.length).toBe(settled);
    expect(settled).toBeLessThanOrEqual(3);
  });
});
