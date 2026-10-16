// @vitest-environment jsdom
import React, { useMemo } from "react";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { DuelEngineView, DuelEvent } from "@yugidraft/shared/duels";

vi.mock("next/font/google", () => {
  const font = () => ({ variable: "font-var", className: "font-class" });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});

import { DuelField } from "@/components/duel/field";
import { newBoard } from "@/components/duel/fx-lab/board";
import { setAnimationSpeed } from "@/components/duel/animation-speed";
import { duelFxClock } from "@/components/duel/fx-clock";
import { ForkLabelsContext } from "@/components/duel/table/fork-labels";
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
  setAnimationSpeed(1);
  duelFxClock.setReducedMotion(false);
  duelFxClock.resetReviewTimeline();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  setAnimationSpeed(1);
});

/** The room as a fork hands it to the shell: the acting seat is `mySeat`, the camera stays on `cameraSeat`. */
function asFork(state: TableFixtureState, acting: number, events: DuelEvent[] = []): TableFixtureState {
  return {
    ...state,
    room: {
      ...state.room,
      mySeat: acting,
      session: { ...state.room.session, kind: "replay-fork" },
      engine: { ...state.room.engine!, events },
    },
  };
}

function ForkTable({ set, acting, cameraSeat = 0, resetKey }: { set: typeof FFA4_FIXTURES; acting: number; cameraSeat?: number; resetKey: string }) {
  const controller = useFixtureController(asFork(set.states.main, acting), { reducedMotion: true });
  const forked = useMemo(() => ({ ...controller, cameraSeat }), [controller, cameraSeat]);
  return <ForkLabelsContext.Provider value><TableShell controller={forked} resetKey={resetKey} noResultScreen /></ForkLabelsContext.Provider>;
}

function ForkTag({ acting, events = [], fork = true }: { acting: number; events?: DuelEvent[]; fork?: boolean }) {
  const state = asFork(TAG_FIXTURES.states.main, acting, events);
  const live = fork ? state : { ...state, room: { ...state.room, session: { ...state.room.session, kind: "play" as const } } };
  const controller = useFixtureController(live, { reducedMotion: false });
  const forked = useMemo(() => ({ ...controller, cameraSeat: fork ? 0 : null }), [controller, fork]);
  return (
    <ForkLabelsContext.Provider value={fork}>
      <TagShell controller={forked} teamNames={[...TAG_TEAM_NAMES] as [string, string]} noResultScreen />
    </ForkLabelsContext.Provider>
  );
}

describe("a fork table keeps its camera when the acting seat changes", () => {
  it("FFA4: the focused field, the shell and its camera stay across seat switches and a Reveal toggle", () => {
    const { container, rerender } = render(<ForkTable set={FFA4_FIXTURES} acting={0} resetKey="0:true" />);
    const root = container.querySelector("[data-grid-focus]")!;
    expect(root.getAttribute("data-grid-focus")).toBe("all");
    act(() => { fireEvent.keyDown(window, { key: "3" }); });
    const focus = root.getAttribute("data-grid-focus");
    expect(focus).not.toBe("all");
    const camera = root.getAttribute("data-camera-mode");
    for (const [acting, key] of [[1, "1:true"], [2, "2:true"], [2, "2:false"], [0, "0:false"]] as const) {
      rerender(<ForkTable set={FFA4_FIXTURES} acting={acting} resetKey={key} />);
      // The same DOM node: a remount would hand back a new root and the grid would show every field again.
      expect(container.querySelector("[data-grid-focus]")).toBe(root);
      expect(root.getAttribute("data-grid-focus")).toBe(focus);
      expect(root.getAttribute("data-camera-mode")).toBe(camera);
    }
  });

  it("FFA3: the stage, its camera mode and its zoom stay across seat switches", () => {
    const { container, rerender } = render(<ForkTable set={FFA3_FIXTURES} acting={0} resetKey="0:true" />);
    const stage = container.querySelector("[data-camera-mode]")!;
    const mode = stage.getAttribute("data-camera-mode");
    const layer = stage.querySelector("[style*='transform']");
    for (const [acting, key] of [[1, "1:true"], [2, "2:true"], [0, "0:true"]] as const) {
      rerender(<ForkTable set={FFA3_FIXTURES} acting={acting} resetKey={key} />);
      expect(container.querySelector("[data-camera-mode]")).toBe(stage);
      expect(stage.getAttribute("data-camera-mode")).toBe(mode);
      expect(stage.querySelector("[style*='transform']")).toBe(layer);
    }
  });

  it("a seat switch clears the open menu state but the table stays", () => {
    const { container, rerender } = render(<ForkTable set={FFA4_FIXTURES} acting={0} resetKey="0:true" />);
    const root = container.querySelector("[data-grid-focus]")!;
    rerender(<ForkTable set={FFA4_FIXTURES} acting={1} resetKey="1:true" />);
    expect(container.querySelector("[data-grid-focus]")).toBe(root);
    expect(container.querySelector("[role='menu']")).toBeNull();
  });
});

describe("a seat switch in a HUD layout", () => {
  it("FFA4: keeps the open Log drawer", () => {
    const { container, rerender } = render(<ForkTable set={FFA4_FIXTURES} acting={0} resetKey="0:true" />);
    const drawer = () => container.querySelector<HTMLElement>("[data-edge-drawer='Log']");
    expect(drawer()).not.toBeNull();
    const tab = () => drawer()!.querySelector<HTMLButtonElement>("button[aria-expanded]")!;
    if (tab().getAttribute("aria-expanded") !== "true") fireEvent.click(tab());
    expect(drawer()!.getAttribute("data-state")).toBe("open");
    rerender(<ForkTable set={FFA4_FIXTURES} acting={1} resetKey="1:true" />);
    expect(drawer()!.getAttribute("data-state")).toBe("open");
    expect(tab().getAttribute("aria-expanded")).toBe("true");
  });
});

describe("a 1v1 fork board", () => {
  it("tags the acting seat on its tally and names both seats", () => {
    const engine = { revision: 1, turn: 1, turnSeat: 0, phase: "main1", seats: newBoard().seats, prompt: null, chain: [], events: [], log: [], result: null } as DuelEngineView;
    const board = (fork: boolean) => (
      <ForkLabelsContext.Provider value={fork}>
        <DuelField engine={engine} mySeat={1} named masterRule={5} reducedMotion legalKeys={new Set()} selectedKeys={new Set()}
          onActivate={() => {}} onInspect={() => {}} bottomName="Bo" topName="Ada" />
      </ForkLabelsContext.Provider>
    );
    const { container, rerender } = render(board(true));
    const tags = container.querySelectorAll("[data-acting]");
    expect(tags).toHaveLength(1);
    expect(tags[0].closest("[data-lp-seat]")?.getAttribute("data-lp-seat")).toBe("1");
    expect(container.textContent).not.toMatch(/\bYour\b|Opponent/);
    rerender(board(false));
    expect(container.querySelectorAll("[data-acting]")).toHaveLength(0);
  });
});

describe("a fork names the seats and marks the acting one", () => {
  it("FFA4 shows no You text when another seat acts than the camera seat", () => {
    const { container } = render(<ForkTable set={FFA4_FIXTURES} acting={1} resetKey="1:true" />);
    expect(container.textContent).not.toMatch(/\bYou\b(?! drew)|\bYOU\b|Your turn|Your Master|\(you\)|only your team/);
    expect(container.querySelector("[data-relation='self']")).not.toBeNull();
  });
});

describe("a fork on the Rooftop", () => {
  it("shows the acting seat's hand, anchors the board at the camera seat, and names no \"You\"", () => {
    const { container } = render(<ForkTag acting={1} />);
    const hand = container.querySelector("[data-hand-dock] [data-hand-seat]");
    expect(hand?.getAttribute("data-hand-seat")).toBe("1");
    const dock = container.querySelector("[data-hand-dock]");
    expect(dock?.getAttribute("aria-label")).not.toBe("Your hand");
    expect(container.textContent).not.toMatch(/\bYou\b(?! drew)|\bYOU\b|Your turn|Your Master|only your team/);
  });

  it("does not move the camera for an effect in a fork, but still does in a live Tag duel", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date", "performance"] });
    const ev = (id: number, kind: DuelEvent["kind"]): DuelEvent => ({ id, kind, text: kind });
    const locked = (root: HTMLElement) => root.querySelector("[data-lock-chip]") != null;
    const fork = render(<ForkTag acting={1} />);
    fork.rerender(<ForkTag acting={1} events={[ev(1, "destroy"), ev(2, "attack")]} />);
    expect(locked(fork.container)).toBe(false);
    act(() => void vi.advanceTimersByTime(300));
    expect(locked(fork.container)).toBe(false);
    fork.unmount();
    const live = render(<ForkTag acting={0} fork={false} />);
    live.rerender(<ForkTag acting={0} fork={false} events={[ev(1, "destroy")]} />);
    expect(locked(live.container)).toBe(true);
  });
});
