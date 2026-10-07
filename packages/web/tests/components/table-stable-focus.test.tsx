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
const MIKA = 2;
const BASE = FFA3_FIXTURES.states.main;
const ev = (id: number, kind: DuelEvent["kind"], extra: Partial<DuelEvent> = {}): DuelEvent => ({ id, kind, text: kind, ...extra });

/** The same table with a change of the engine: what a remote action, a chain or a new turn does to the room. */
function variant(patch: (engine: NonNullable<TableFixtureState["room"]["engine"]>) => void): TableFixtureState {
  const engine = structuredClone(BASE.room.engine!);
  patch(engine);
  return { ...BASE, room: { ...BASE.room, engine } };
}

function Table({ state, camera }: { state: TableFixtureState; camera?: Partial<CameraState> }) {
  const controller = useFixtureController(state, {});
  return <TableShell controller={controller} initialCamera={camera} />;
}

const chip = (root: HTMLElement) => root.querySelector("[data-camera-chip] b")?.textContent;
const pressed = (root: HTMLElement) =>
  Array.from(root.querySelectorAll<HTMLElement>("[data-seat-switch][aria-pressed='true']")).map((node) => node.getAttribute("data-seat-switch"));
const advance = (ms: number) => act(() => void vi.advanceTimersByTime(ms));

/** Targets only on one rival's field: the case that used to move the camera there. */
const onlyOn = (seat: number) => (engine: NonNullable<TableFixtureState["room"]["engine"]>) => {
  const source = structuredClone(FFA3_FIXTURES.states["target-pick"].room.engine!.prompt!);
  engine.prompt = { ...source, options: source.options.filter((option) => option.controller === seat) } as typeof engine.prompt;
};

describe("the focused field only changes when the viewer asks", () => {
  it("a rival that is focused stays focused through an attack, a chain, a destroy and a new turn", () => {
    const focused = { mode: "focus", focusSeat: RYO } as const;
    const { container, rerender } = render(<Table state={variant(() => {})} camera={focused} />);
    expect(chip(container)).toBe("Focus · Ryo Sato");
    expect(pressed(container)).toEqual([String(RYO)]);

    const steps: Array<(engine: NonNullable<TableFixtureState["room"]["engine"]>) => void> = [
      (engine) => { engine.events = [...engine.events, ev(900, "attack", { target: { controller: MIKA, location: 4, sequence: 0 } })]; },
      (engine) => { engine.events = [...engine.events, ev(901, "chain-resolving")]; },
      (engine) => { engine.events = [...engine.events, ev(902, "destroy"), ev(903, "damage", { amount: 800, cause: "effect" })]; },
      (engine) => { engine.turn += 1; engine.turnSeat = MIKA; engine.phase = "main1"; },
      (engine) => { engine.turnSeat = RYO; engine.phase = "battle"; },
      onlyOn(MIKA),
      onlyOn(REN),
    ];
    for (const patch of steps) {
      rerender(<Table state={variant(patch)} camera={focused} />);
      advance(3000);
      expect(chip(container)).toBe("Focus · Ryo Sato");
      expect(pressed(container)).toEqual([String(RYO)]);
      expect(container.querySelector("[data-camera-chip][data-lock]")).toBeNull();
    }
  });

  it("the home view stays home while the table changes", () => {
    const { container, rerender } = render(<Table state={variant(() => {})} />);
    expect(chip(container)).toBe("Home");
    for (const patch of [
      (engine: NonNullable<TableFixtureState["room"]["engine"]>) => { engine.events = [...engine.events, ev(900, "attack")]; },
      (engine: NonNullable<TableFixtureState["room"]["engine"]>) => { engine.turnSeat = RYO; },
      onlyOn(MIKA),
      onlyOn(RYO),
    ]) {
      rerender(<Table state={variant(patch)} />);
      advance(3000);
      expect(chip(container)).toBe("Home");
      expect(pressed(container)).toEqual(["home"]);
    }
  });

  it("marks the field that holds the targets, and Show moves the camera only when the viewer clicks it", () => {
    const { container, rerender } = render(<Table state={variant(() => {})} />);
    expect(container.querySelector("[data-camera-hint]")).toBeNull();
    rerender(<Table state={variant(onlyOn(MIKA))} />);
    const hint = container.querySelector("[data-camera-hint]");
    expect(hint?.textContent).toContain("Mika Hana");
    expect(chip(container)).toBe("Home");
    expect(container.querySelector("[data-seat-switch='2'][data-target-hint='true']")).not.toBeNull();
    fireEvent.click(hint!.querySelector("button")!);
    expect(chip(container)).toBe("Focus · Mika Hana");
    // Once the field is the focus there is nothing left to point at.
    expect(container.querySelector("[data-camera-hint]")).toBeNull();
  });

  it("the viewer can still change the focus with a key", () => {
    const { container } = render(<Table state={variant(() => {})} camera={{ mode: "focus", focusSeat: RYO }} />);
    fireEvent.keyDown(window, { key: "3" });
    expect(chip(container)).toBe("Focus · Mika Hana");
    fireEvent.keyDown(window, { key: "h" });
    expect(chip(container)).toBe("Home");
  });

  it("a 3-way with two seats left is a face-off, which has one view: the only change the table makes itself", () => {
    const focused = { mode: "focus", focusSeat: RYO } as const;
    const { container, rerender } = render(<Table state={variant(() => {})} camera={focused} />);
    rerender(<Table state={variant((engine) => {
      const mika = engine.seats[MIKA];
      mika.lp = 0;
      mika.eliminated = true;
    })} camera={focused} />);
    advance(3000);
    expect(chip(container)).toBe("Home");
  });
});
