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
/** Event ids start above the ones in the fixtures, so the shell sees every one of them as new. */
const STEPS: { turnSeat: number; events: DuelEvent[] }[] = [
  { turnSeat: 1, events: [ev(1001, "phase")] },
  { turnSeat: 1, events: [ev(1001, "phase"), ev(1002, "attack")] },
  { turnSeat: 2, events: [ev(1001, "phase"), ev(1002, "attack"), ev(1003, "chain-resolving")] },
  { turnSeat: 3, events: [ev(1001, "phase"), ev(1002, "attack"), ev(1003, "chain-resolving"), ev(1004, "destroy")] },
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

  it("Tag: a close-up the viewer chose stays through every step and the end of every FX lock", () => {
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

  /** Events of one actor, in the order of a play: summon, activation, chain link resolving, an attack. */
  const acts = (seat: number, from = 1000): DuelEvent[] => [
    ev(from, "summon", { seat }),
    ev(from + 1, "activate", { seat, chainIndex: 1 }),
    ev(from + 2, "chain-resolving", { seat, chainIndex: 1 }),
    ev(from + 3, "attack", { seat }),
  ];
  const chip = (root: HTMLElement) => root.querySelector("[data-lock-chip]");
  const zoomOn = (root: HTMLElement, seat: number) => act(() => void fireEvent.click(root.querySelector(`[data-field-focus="${seat}"]`)!));

  it("Tag: the viewer's own plays keep the close-up in place, with no lock and no move", () => {
    const base = TAG_FIXTURES.states.main;
    const { container, rerender } = render(<Tag state={base} />);
    zoomOn(container, 0);
    expect(tagMode(container)).toBe("focus:0");
    rerender(<Tag state={later(base, 0, acts(0))} />);
    expect(tagMode(container)).toBe("focus:0");
    expect(chip(container)).toBeNull();
    advance(6000);
    expect(tagMode(container)).toBe("focus:0");
  });

  it("Tag: a response window and a chain the viewer started keep the close-up", () => {
    const base = TAG_FIXTURES.states["chain-2"];
    const { container, rerender } = render(<Tag state={base} />);
    zoomOn(container, 0);
    expect(tagMode(container)).toBe("focus:0");
    rerender(<Tag state={later(base, 0, acts(0))} />);
    advance(6000);
    expect(tagMode(container)).toBe("focus:0");
    // A second link of the viewer's own team, then the same window again.
    rerender(<Tag state={later(base, 0, [...acts(0), ...acts(0, 1010)])} />);
    advance(6000);
    expect(tagMode(container)).toBe("focus:0");
    expect(chip(container)).toBeNull();
  });

  it("Tag: a rival's play on another field zooms out once, and the view stays out", () => {
    const base = TAG_FIXTURES.states.main;
    const { container, rerender } = render(<Tag state={base} />);
    zoomOn(container, 0);
    rerender(<Tag state={later(base, 1, acts(1))} />);
    expect(tagMode(container)).toBe("overview:-");
    advance(10_000);
    expect(tagMode(container)).toBe("overview:-");
    // More plays, rival and own, never zoom back in.
    rerender(<Tag state={later(base, 0, [...acts(1), ...acts(0, 1010), ...acts(3, 1020)])} />);
    advance(10_000);
    expect(tagMode(container)).toBe("overview:-");
    // Only a press of the viewer zooms in again, and that close-up holds through the viewer's own plays.
    zoomOn(container, 0);
    expect(tagMode(container)).toBe("focus:0");
    rerender(<Tag state={later(base, 0, [...acts(1), ...acts(0, 1010), ...acts(3, 1020), ...acts(0, 1030)])} />);
    advance(10_000);
    expect(tagMode(container)).toBe("focus:0");
  });

  it("Tag: Esc and the pill still zoom out for the viewer", () => {
    const base = TAG_FIXTURES.states.main;
    const { container } = render(<Tag state={base} />);
    zoomOn(container, 3);
    expect(tagMode(container)).toBe("focus:3");
    act(() => void fireEvent.keyDown(window, { key: "Escape" }));
    expect(tagMode(container)).toBe("overview:-");
    zoomOn(container, 3);
    zoomOn(container, 3);
    expect(tagMode(container)).toBe("overview:-");
  });

  it("Tag: a teammate's play on another field zooms out too", () => {
    const base = TAG_FIXTURES.states.main;
    const { container, rerender } = render(<Tag state={base} />);
    zoomOn(container, 0);
    rerender(<Tag state={later(base, 2, acts(2))} />);
    expect(tagMode(container)).toBe("overview:-");
    advance(10_000);
    expect(tagMode(container)).toBe("overview:-");
  });

  it("Tag: a play on the field in close-up (even a rival's) does not move the camera", () => {
    const base = TAG_FIXTURES.states.main;
    const { container, rerender } = render(<Tag state={base} />);
    zoomOn(container, 1);
    expect(tagMode(container)).toBe("focus:1");
    rerender(<Tag state={later(base, 1, acts(1))} />);
    advance(6000);
    expect(tagMode(container)).toBe("focus:1");
    // A destroy or a move names the owner of the card, not who acted: it never moves the camera.
    rerender(<Tag state={later(base, 1, [...acts(1), ev(1005, "destroy", { seat: 3 }), ev(1006, "move", { seat: 2 })])} />);
    advance(6000);
    expect(tagMode(container)).toBe("focus:1");
  });

  it("Tag: other views, such as the overview, never zoom in by themselves, and the overview still locks for the FX", () => {
    const base = TAG_FIXTURES.states.main;
    const { container, rerender } = render(<Tag state={base} />);
    rerender(<Tag state={later(base, 1, acts(1))} />);
    expect(tagMode(container)).toBe("overview:-");
    expect(chip(container)).not.toBeNull();
    advance(6000);
    expect(chip(container)).toBeNull();
    expect(tagMode(container)).toBe("overview:-");
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
