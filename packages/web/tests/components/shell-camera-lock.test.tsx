// @vitest-environment jsdom
import React from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { DuelEvent } from "@yugidraft/shared/duels";

vi.mock("next/font/google", () => {
  const font = () => ({ variable: "font-var", className: "font-class" });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});

import { setAnimationSpeed } from "@/components/duel/animation-speed";
import { CAMERA_HOLD_MS, scaleLockMs } from "@/components/duel/camera-lock-time";
import { duelFxClock } from "@/components/duel/fx-clock";
import { CAMERA_HOME_MS } from "@/components/duel/table/camera-model";
import { FFA3_FIXTURES } from "@/components/duel/table/fixtures/ffa3";
import type { TableFixtureState } from "@/components/duel/table/fixtures/common";
import { useFixtureController } from "@/components/duel/table/fixtures/use-fixture-controller";
import { TableShell } from "@/components/duel/table/table-shell";
import { TAG_FIXTURES, TAG_TEAM_NAMES } from "@/components/duel/tag/fixtures";
import { ROOF_LOCK_IN_MS } from "@/components/duel/tag/roof-camera";
import { TagShell } from "@/components/duel/tag/tag-shell";

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
  setAnimationSpeed(1);
});

const ev = (id: number, kind: DuelEvent["kind"], extra: Partial<DuelEvent> = {}): DuelEvent => ({ id, kind, text: kind, ...extra });
const withEvents = (state: TableFixtureState, events: DuelEvent[]): TableFixtureState => ({
  ...state,
  room: { ...state.room, engine: { ...state.room.engine!, events } },
});

function Table({ events, reducedMotion = false }: { events: DuelEvent[]; reducedMotion?: boolean }) {
  const controller = useFixtureController(withEvents(FFA3_FIXTURES.states.main, events), { reducedMotion });
  return <TableShell controller={controller} />;
}
function Tag({ events, reducedMotion = false }: { events: DuelEvent[]; reducedMotion?: boolean }) {
  const controller = useFixtureController(withEvents(TAG_FIXTURES.states.main, events), { reducedMotion });
  return <TagShell controller={controller} teamNames={[...TAG_TEAM_NAMES] as [string, string]} />;
}

const tagLocked = (root: HTMLElement) => root.querySelector("[data-lock-chip]") != null;
const tableLocked = (root: HTMLElement) => root.querySelector("[data-camera-chip][data-lock]") != null;
const advance = (ms: number) => act(() => void vi.advanceTimersByTime(ms));

// A destroy locks 1500 ms (Rooftop) / 1300 ms (table) at 1x. At 2x the effects take half as long, but the camera does not.
describe("scaleLockMs", () => {
  it("scales by the speed and keeps the camera's home move plus a hold", () => {
    expect(scaleLockMs(2000, 2, 700)).toBe(1000);
    expect(scaleLockMs(1500, 2, 700)).toBe(700 + CAMERA_HOLD_MS);
    expect(scaleLockMs(1500, 0.5, 700)).toBe(3000);
  });
  it("never lengthens a lock that is already shorter than the floor", () => {
    expect(scaleLockMs(600, 2, 700)).toBe(600);
  });
  it("ignores an unusable speed", () => {
    for (const bad of [0, -1, NaN]) expect(scaleLockMs(1500, bad, 700)).toBe(1500);
  });
});

describe("the camera lock clears at the scaled time but not before the camera reached home", () => {
  it("TagShell at 2x", () => {
    setAnimationSpeed(2);
    const floor = ROOF_LOCK_IN_MS + CAMERA_HOLD_MS;
    const { container, rerender } = render(<Tag events={[]} />);
    expect(tagLocked(container)).toBe(false);
    rerender(<Tag events={[ev(1, "destroy")]} />);
    expect(tagLocked(container)).toBe(true);
    // 1500 / 2 = 750 ms would be shorter than the 700 ms ease plus the hold.
    advance(floor - 100);
    expect(tagLocked(container)).toBe(true);
    advance(100 + 50);
    expect(tagLocked(container)).toBe(false);
  });

  it("TagShell at 1x keeps the full lock", () => {
    const { container, rerender } = render(<Tag events={[]} />);
    rerender(<Tag events={[ev(1, "destroy")]} />);
    advance(1400);
    expect(tagLocked(container)).toBe(true);
    advance(200);
    expect(tagLocked(container)).toBe(false);
  });

  it("the table camera at 2x", () => {
    setAnimationSpeed(2);
    const floor = CAMERA_HOME_MS + CAMERA_HOLD_MS;
    const { container, rerender } = render(<Table events={[]} />);
    expect(tableLocked(container)).toBe(false);
    rerender(<Table events={[ev(1, "destroy")]} />);
    expect(tableLocked(container)).toBe(true);
    // 1300 / 2 = 650 ms would end before the 950 ms fly tween.
    advance(floor - 100);
    expect(tableLocked(container)).toBe(true);
    advance(100 + 50);
    expect(tableLocked(container)).toBe(false);
  });

  it("neither shell locks under reduced motion", () => {
    const tag = render(<Tag events={[]} reducedMotion />);
    tag.rerender(<Tag events={[ev(1, "destroy")]} reducedMotion />);
    expect(tagLocked(tag.container)).toBe(false);
    tag.unmount();
    const table = render(<Table events={[]} reducedMotion />);
    table.rerender(<Table events={[ev(1, "destroy"), ev(2, "attack")]} reducedMotion />);
    expect(tableLocked(table.container)).toBe(false);
    // The cursor moved: the same events do not lock later when motion comes back.
    table.rerender(<Table events={[ev(1, "destroy"), ev(2, "attack")]} />);
    expect(tableLocked(table.container)).toBe(false);
  });
});
