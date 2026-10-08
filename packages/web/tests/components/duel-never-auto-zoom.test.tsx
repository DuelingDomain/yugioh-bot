// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { DuelEvent } from "@yugidraft/shared/duels";

vi.mock("next/font/google", () => {
  const font = () => ({ variable: "font-var", className: "font-class" });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});

import { setAnimationSpeed } from "@/components/duel/animation-speed";
import { duelFxClock } from "@/components/duel/fx-clock";
import { FFA3_FIXTURES } from "@/components/duel/table/fixtures/ffa3";
import { FFA4_FIXTURES } from "@/components/duel/table/fixtures/ffa4";
import type { TableFixtureState } from "@/components/duel/table/fixtures/common";
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
/** The same fixture one step later: the turn moved to `turnSeat` and these events came in. */
const later = (state: TableFixtureState, turnSeat: number, events: DuelEvent[]): TableFixtureState => ({
  ...state,
  room: { ...state.room, engine: { ...state.room.engine!, turnSeat, events } },
});

/** Game steps in the order a duel plays them: a new turn, an attack, a chain and its resolution, then a destroy. */
const STEPS: { turnSeat: number; events: DuelEvent[] }[] = [
  { turnSeat: 1, events: [ev(1, "phase")] },
  { turnSeat: 1, events: [ev(1, "phase"), ev(2, "attack")] },
  { turnSeat: 2, events: [ev(1, "phase"), ev(2, "attack"), ev(3, "chain-resolving")] },
  { turnSeat: 3, events: [ev(1, "phase"), ev(2, "attack"), ev(3, "chain-resolving"), ev(4, "destroy")] },
];

function Tag({ state }: { state: TableFixtureState }) {
  const controller = useFixtureController(state, { reducedMotion: false });
  return <TagShell controller={controller} teamNames={[...TAG_TEAM_NAMES] as [string, string]} />;
}
function Table({ state }: { state: TableFixtureState }) {
  const controller = useFixtureController(state, { reducedMotion: true });
  return <TableShell controller={controller} />;
}

const tagMode = (root: HTMLElement) => {
  const stage = root.querySelector<HTMLElement>("[data-tag-stage]")!;
  return `${stage.dataset.cameraMode}:${stage.dataset.cameraSeat ?? "-"}`;
};
const advance = (ms: number) => act(() => void vi.advanceTimersByTime(ms));

describe("the duel never zooms in on a field by itself", () => {
  it("Tag: the overview stays the overview through turns, attacks, chains, destroys and the end of every FX lock", () => {
    const base = TAG_FIXTURES.states.main;
    const { container, rerender } = render(<Tag state={base} />);
    expect(tagMode(container)).toBe("overview:-");
    for (const step of STEPS) {
      rerender(<Tag state={later(base, step.turnSeat, step.events)} />);
      expect(tagMode(container)).toBe("overview:-");
      advance(4000);
      expect(tagMode(container)).toBe("overview:-");
    }
  });

  it("Tag: a close-up the viewer chose comes back after an FX lock, and no event moves it to another field", () => {
    const base = TAG_FIXTURES.states.main;
    const { container, rerender } = render(<Tag state={base} />);
    act(() => void fireEvent.click(container.querySelector('[data-field-focus="0"]')!));
    expect(tagMode(container)).toBe("focus:0");
    for (const step of STEPS) {
      rerender(<Tag state={later(base, step.turnSeat, step.events)} />);
      advance(4000);
      expect(tagMode(container)).toBe("focus:0");
    }
  });

  it("4-way grid: all fields stay all fields through the same steps", () => {
    const base = FFA4_FIXTURES.states.main;
    const { container, rerender } = render(<Table state={base} />);
    const stage = container.querySelector("[data-grid-stage]")!;
    act(() => void fireEvent.keyDown(window, { key: "o" }));
    expect(stage.getAttribute("data-grid-focus")).toBe("all");
    for (const step of STEPS) {
      rerender(<Table state={later(base, step.turnSeat, step.events)} />);
      advance(4000);
      expect(stage.getAttribute("data-grid-focus")).toBe("all");
    }
  });

  it("4-way grid: the field the viewer chose stays the field in focus", () => {
    const base = FFA4_FIXTURES.states.main;
    const { container, rerender } = render(<Table state={base} />);
    const stage = container.querySelector("[data-grid-stage]")!;
    act(() => void fireEvent.keyDown(window, { key: "3" }));
    for (const step of STEPS) {
      rerender(<Table state={later(base, step.turnSeat, step.events)} />);
      advance(4000);
      expect(stage.getAttribute("data-grid-focus")).toBe("2");
    }
  });

  it("3-way table: the home view stays home through the same steps", () => {
    const base = FFA3_FIXTURES.states.main;
    const { container, rerender } = render(<Table state={base} />);
    const stage = container.querySelector<HTMLElement>("[data-table-stage]")!;
    const before = stage.dataset.cameraMode;
    for (const step of STEPS) {
      rerender(<Table state={later(base, step.turnSeat, step.events)} />);
      advance(4000);
      expect(stage.dataset.cameraMode).toBe(before);
    }
  });
});
