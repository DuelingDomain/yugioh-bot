// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/font/google", () => {
  const font = () => ({ variable: "font-var", className: "font-class" });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});

import { setAnimationSpeed } from "@/components/duel/animation-speed";
import { useDuelAnimationSpeed } from "@/components/duel/animation-speed-control";
import { duelFxClock } from "@/components/duel/fx-clock";
import { useDuelPreferences } from "@/components/duel/preferences";
import { FFA3_FIXTURES } from "@/components/duel/table/fixtures/ffa3";
import { useFixtureController } from "@/components/duel/table/fixtures/use-fixture-controller";
import { TableShell } from "@/components/duel/table/table-shell";
import { TAG_FIXTURES, TAG_TEAM_NAMES } from "@/components/duel/tag/fixtures";
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
  duelFxClock.setReducedMotion(false);
});

// What the live room does: one preferences instance feeds the controller, the FX clock and the shell.
function RoomTable() {
  const preferences = useDuelPreferences();
  useDuelAnimationSpeed(preferences.reducedMotion);
  const controller = useFixtureController(FFA3_FIXTURES.states.main, { reducedMotion: preferences.reducedMotion });
  return <TableShell controller={controller} preferences={preferences} />;
}
function RoomTag() {
  const preferences = useDuelPreferences();
  useDuelAnimationSpeed(preferences.reducedMotion);
  const controller = useFixtureController(TAG_FIXTURES.states.main, { reducedMotion: preferences.reducedMotion });
  return <TagShell controller={controller} preferences={preferences} teamNames={[...TAG_TEAM_NAMES] as [string, string]} />;
}

const openSettings = () => act(() => void fireEvent.click(screen.queryByRole("tab", { name: "Settings" }) ?? screen.getByRole("button", { name: "Settings" })));

describe("the shells use the room's one preferences instance", () => {
  it.each([["TableShell", RoomTable, "[data-table-shell]"], ["TagShell", RoomTag, "[data-table-shell='tag']"]] as const)(
    "%s: the Motion setting reaches the controller and the FX clock without a reload",
    (_name, Room, rootSelector) => {
      setAnimationSpeed(2);
      const { container } = render(<Room />);
      const root = () => container.querySelector(rootSelector);
      expect(root()?.getAttribute("data-reduced")).toBe("false");
      expect(duelFxClock.factor()).toBe(2);
      openSettings();
      fireEvent.change(screen.getByLabelText("Motion"), { target: { value: "reduced" } });
      // Reduced motion pins the clock to 1x and the controller the shell reads says reduced.
      expect(root()?.getAttribute("data-reduced")).toBe("true");
      expect(duelFxClock.factor()).toBe(1);
      fireEvent.change(screen.getByLabelText("Motion"), { target: { value: "full" } });
      expect(root()?.getAttribute("data-reduced")).toBe("false");
      expect(duelFxClock.factor()).toBe(2);
    },
  );
});
