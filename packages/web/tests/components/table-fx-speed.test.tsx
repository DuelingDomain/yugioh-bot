// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { DuelEvent, DuelSeatView } from "@yugidraft/shared/duels";

vi.mock("next/font/google", () => {
  const font = () => ({ variable: "font-var", className: "font-class" });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});

import { setAnimationSpeed } from "@/components/duel/animation-speed";
import { duelFxClock } from "@/components/duel/fx-clock";
import { FFA3_FIXTURES } from "@/components/duel/table/fixtures/ffa3";
import { useFixtureController } from "@/components/duel/table/fixtures/use-fixture-controller";
import { CAMERA_HOLD_MS } from "@/components/duel/camera-lock-time";
import { CAMERA_HOME_MS, lockForEvents as tableLock, lockForSeats } from "@/components/duel/table/camera-model";
import { TableShell } from "@/components/duel/table/table-shell";
import { TAG_FIXTURES, TAG_TEAM_NAMES } from "@/components/duel/tag/fixtures";
import { lockForEvents as tagLock } from "@/components/duel/tag/fx-lock";
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
  setAnimationSpeed(1);
  duelFxClock.setReducedMotion(false);
  duelFxClock.resetReviewTimeline();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  setAnimationSpeed(1);
});

function Table() {
  const controller = useFixtureController(FFA3_FIXTURES.states.main, { reducedMotion: true });
  return <TableShell controller={controller} />;
}
function Tag() {
  const controller = useFixtureController(TAG_FIXTURES.states.main, { reducedMotion: true });
  return <TagShell controller={controller} teamNames={[...TAG_TEAM_NAMES] as [string, string]} />;
}

const openSettings = () => act(() => void fireEvent.click(screen.queryByRole("tab", { name: "Settings" }) ?? screen.getByRole("button", { name: "Settings" })));
const ev = (id: number, kind: DuelEvent["kind"], extra: Partial<DuelEvent> = {}): DuelEvent => ({ id, kind, text: kind, ...extra });

describe("animation speed in the N-seat shells", () => {
  it.each([["TableShell (3-way and 4-way)", Table, "[data-table-shell]"], ["TagShell (2v2)", Tag, "[data-table-shell='tag']"]] as const)(
    "%s shows the speed control in Settings and marks its root for CSS effects",
    (_name, Shell, rootSelector) => {
      const { container } = render(<Shell />);
      expect(container.querySelector(rootSelector)?.hasAttribute("data-duel-fx-speed-root")).toBe(true);
      openSettings();
      const slider = screen.getByRole("slider", { name: /Animation speed/ });
      expect(slider).toHaveValue("1");
      // The same preference store as the 1v1 room: a change reaches the shared clock and is saved for the browser.
      fireEvent.change(slider, { target: { value: "1.5" } });
      expect(screen.getByText("1.50x")).toBeInTheDocument();
      expect(duelFxClock.factor()).toBe(1.5);
      expect(window.localStorage.getItem("yugidraft.duelAnimationSpeed.v1")).toBe("1.5");
    },
  );
});

describe("camera locks follow the viewer's FX speed", () => {
  const attack = [ev(1, "attack")];
  it("scales the Rooftop lock", () => {
    const base = tagLock(attack, 0)!.ms;
    expect(tagLock(attack, 0, false, 2)!.ms).toBe(Math.round(base / 2));
    expect(tagLock(attack, 0, false, 0.5)!.ms).toBe(base * 2);
  });
  it("scales the table lock for events and eliminations, down to the camera's home move plus a hold", () => {
    const base = tableLock(attack, 0)!.ms;
    expect(tableLock(attack, 0, 2)!.ms).toBe(Math.max(Math.round(base / 2), CAMERA_HOME_MS + CAMERA_HOLD_MS));
    expect(tableLock(attack, 0, 0.5)!.ms).toBe(base * 2);
    const seats = [0, 1, 2].map((seat) => ({ seat }) as DuelSeatView);
    const out = seats.map((view) => (view.seat === 1 ? { ...view, eliminated: true } : view));
    expect(lockForSeats(seats, out, 0.5)!.ms).toBe(lockForSeats(seats, out)!.ms * 2);
    expect(lockForSeats(seats, out, 2)!.ms).toBe(Math.round(lockForSeats(seats, out)!.ms / 2));
  });
  it("ignores an unusable speed", () => {
    for (const bad of [0, -1, NaN]) expect(tagLock(attack, 0, false, bad)!.ms).toBe(tagLock(attack, 0)!.ms);
  });
  it("uses the clock rate the slider chose", () => {
    const base = tagLock(attack, 0)!.ms;
    setAnimationSpeed(2);
    expect(tagLock(attack, 0, false, duelFxClock.factor())!.ms).toBe(Math.round(base / 2));
    expect(tableLock(attack, 0, duelFxClock.factor())!.ms).toBe(tableLock(attack, 0, 2)!.ms);
  });
});
