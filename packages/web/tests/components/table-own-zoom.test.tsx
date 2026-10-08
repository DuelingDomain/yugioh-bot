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
const frames = () => vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => setTimeout(() => cb(performance.now()), 16) as unknown as number);
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
});
