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
const seatBox = (root: HTMLElement, seat: number) => root.querySelector(`[data-seat-slot="${seat}"]`) as HTMLElement;
const pressed = (root: HTMLElement) =>
  Array.from(root.querySelectorAll<HTMLElement>("[data-seat-switch][aria-pressed='true']")).map((node) => node.getAttribute("data-seat-switch"));
const advance = (ms: number) => act(() => void vi.advanceTimersByTime(ms));

/** Targets only on one rival's field: the case that used to move the camera there. */
const onlyOn = (seat: number) => (engine: NonNullable<TableFixtureState["room"]["engine"]>) => {
  const source = structuredClone(FFA3_FIXTURES.states["target-pick"].room.engine!.prompt!);
  engine.prompt = { ...source, options: source.options.filter((option) => option.controller === seat) } as typeof engine.prompt;
};

/** Legal keys only on the viewer's own field: what the idle and battle commands of the viewer's turn are. */
const ownFieldOnly = (engine: NonNullable<TableFixtureState["room"]["engine"]>) => {
  const source = structuredClone(FFA3_FIXTURES.states["target-pick"].room.engine!.prompt!);
  engine.prompt = { ...source, options: source.options.slice(0, 2).map((option, at) => ({ ...option, controller: REN, location: 4, sequence: at })) } as typeof engine.prompt;
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

  it("rings the field that holds the targets; the Show cue is only for a field that is out of view", () => {
    const { container, rerender } = render(<Table state={variant(() => {})} />);
    expect(container.querySelector("[data-camera-hint]")).toBeNull();
    // At home all three fields are on the table: the field is ringed and there is no cue.
    rerender(<Table state={variant(onlyOn(MIKA))} />);
    expect(container.querySelector("[data-camera-hint]")).toBeNull();
    expect(seatBox(container, MIKA).getAttribute("data-target-hint")).toBe("true");
    expect(seatBox(container, RYO).getAttribute("data-target-hint")).toBeNull();
    expect(chip(container)).toBe("Home");
  });

  it("names a field out of view and Show moves the camera only when the viewer clicks it", () => {
    const { container } = render(<Table state={variant(onlyOn(MIKA))} camera={{ mode: "focus", focusSeat: RYO }} />);
    const hint = container.querySelector("[data-camera-hint]");
    expect(hint?.textContent).toContain("Mika Hana");
    expect(chip(container)).toBe("Focus · Ryo Sato");
    expect(container.querySelector("[data-seat-switch='2'][data-target-hint='true']")).not.toBeNull();
    fireEvent.click(hint!.querySelector("button")!);
    expect(chip(container)).toBe("Focus · Mika Hana");
    // Once the field is the focus there is nothing left to point at.
    expect(container.querySelector("[data-camera-hint]")).toBeNull();
  });

  it("AltGr (Ctrl+Alt) types [ and ] on some layouts, so they still step the focus; other Ctrl or Alt keys do not", () => {
    const { container } = render(<Table state={variant(() => {})} camera={{ mode: "focus", focusSeat: RYO }} />);
    fireEvent.keyDown(window, { key: "]", ctrlKey: true, altKey: true });
    expect(chip(container)).toBe("Focus · Mika Hana");
    fireEvent.keyDown(window, { key: "[", code: "Digit5", ctrlKey: true, altKey: true });
    expect(chip(container)).toBe("Focus · Ryo Sato");
    fireEvent.keyDown(window, { key: "]", ctrlKey: true });
    fireEvent.keyDown(window, { key: "h", altKey: true });
    expect(chip(container)).toBe("Focus · Ryo Sato");
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

describe("3-way: a click on a field never moves the camera; the button, E and Enter do", () => {
  const seatBox = (root: HTMLElement, seat: number) => root.querySelector<HTMLElement>(`[data-seat-slot='${seat}']`)!;

  // A mouse click carries detail 1 or more; fireEvent.click has detail 0, which is a screen reader's virtual click.
  const mouse = (node: Element) => fireEvent.click(node, { detail: 1 });
  const felt = (root: HTMLElement) => root.querySelector<HTMLElement>("[data-plaza]")!;

  it("a click on a rival field, your own field or the board background moves nothing", () => {
    const { container } = render(<Table state={variant(() => {})} />);
    for (const seat of [RYO, REN, MIKA]) {
      mouse(seatBox(container, seat));
      expect(chip(container)).toBe("Home");
      expect(seatBox(container, seat).getAttribute("data-enlarged")).toBeNull();
    }
    mouse(felt(container));
    mouse(container.querySelector("[data-view-layer]")!);
    expect(chip(container)).toBe("Home");
  });

  it("a click on a field in the fly-in view (after 0) causes no camera change", () => {
    const { container } = render(<Table state={variant(() => {})} />);
    fireEvent.keyDown(window, { key: "0" });
    advance(1500);
    const mode = () => container.querySelector("[data-table-stage]")?.getAttribute("data-camera-mode") ?? chip(container);
    const before = [chip(container), mode()];
    expect(chip(container)).not.toBe("Home");
    for (const node of [seatBox(container, RYO), seatBox(container, MIKA), seatBox(container, REN), felt(container), plainZone(container, RYO)]) {
      mouse(node);
      advance(1500);
      expect([chip(container), mode()]).toEqual(before);
    }
  });

  it("a click on an enlarged field, or on another field beside it, leaves the zoom where it is", () => {
    const { container } = render(<Table state={variant(() => {})} camera={{ mode: "focus", focusSeat: RYO }} />);
    mouse(seatBox(container, RYO));
    mouse(seatBox(container, MIKA));
    mouse(seatBox(container, REN));
    expect(chip(container)).toBe("Focus · Ryo Sato");
  });

  it("a double click on the felt of a field enlarges it, and the same again goes back", () => {
    const { container } = render(<Table state={idle()} />);
    fireEvent.doubleClick(seatBox(container, RYO));
    expect(chip(container)).toBe("Focus · Ryo Sato");
    fireEvent.doubleClick(seatBox(container, RYO));
    expect(chip(container)).toBe("Home");
    // your own field: the own zoom
    fireEvent.doubleClick(seatBox(container, REN));
    expect(chip(container)).toBe("Focus · Ren Arata");
  });

  it("a double click on a card, a zone or a hand never moves the camera", () => {
    const { container } = render(<Table state={idle()} />);
    fireEvent.doubleClick(plainZone(container, RYO));
    fireEvent.doubleClick(seatBox(container, RYO).querySelector("[data-zones]")!);
    fireEvent.doubleClick(container.querySelector("[data-hand-seat]")!);
    expect(chip(container)).toBe("Home");
  });

  it("a double click on empty board does not enlarge a field", () => {
    const { container } = render(<Table state={idle()} />);
    fireEvent.doubleClick(felt(container));
    fireEvent.doubleClick(container.querySelector("[data-view-layer]")!);
    expect(chip(container)).toBe("Home");
  });

  it("a virtual click (a screen reader, detail 0) on the field box acts as Enter does", () => {
    const { container } = render(<Table state={variant(() => {})} />);
    fireEvent.click(seatBox(container, RYO), { detail: 0 });
    expect(chip(container)).toBe("Focus · Ryo Sato");
    fireEvent.click(seatBox(container, RYO), { detail: 0 });
    expect(chip(container)).toBe("Home");
    // A virtual click that lands on something inside the box is not the box's own.
    fireEvent.click(seatBox(container, RYO).querySelector("button, div")!, { detail: 0 });
    expect(chip(container)).toBe("Home");
  });

  it("a mouse press on the felt does not leave the focus on the field box, so Enter does not enlarge it", async () => {
    vi.useRealTimers();
    const user = userEvent.setup({ delay: null });
    const { container } = render(<Table state={idle()} />);
    await user.click(seatBox(container, RYO));
    expect(document.activeElement).not.toBe(seatBox(container, RYO));
    await user.keyboard("{Enter}");
    expect(chip(container)).toBe("Home");
    const outer = container.querySelector<HTMLElement>("[data-table-stage] [data-seat-slot='1'] *:not(button):not([tabindex])");
    if (outer) await user.click(outer);
    expect(document.activeElement).not.toBe(seatBox(container, RYO));
  });

  it("a felt click, then Enter, answers an open prompt and does not enlarge the field", async () => {
    vi.useRealTimers();
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const user = userEvent.setup({ delay: null });
    const { container } = render(<Table state={FFA3_FIXTURES.states["chain-2"]} />);
    await user.click(seatBox(container, MIKA));
    await user.keyboard("{Enter}");
    expect(chip(container)).toBe("Home");
    const answers = info.mock.calls.filter((call) => call[0] === "[table-preview] answer");
    expect(answers.length).toBeGreaterThan(0);
  });

  it("the Zoom my field button and the E key still zoom, and Back and Esc still leave", () => {
    const { container } = render(<Table state={variant(() => {})} />);
    fireEvent.click(container.querySelector("[data-camera-zoom]")!);
    expect(chip(container)).toBe("Focus · Ren Arata");
    expect(seatBox(container, REN).getAttribute("data-enlarged")).toBe("true");
    fireEvent.click(container.querySelector("[data-camera-back]")!);
    expect(chip(container)).toBe("Home");
    fireEvent.keyDown(window, { key: "e" });
    expect(chip(container)).toBe("Focus · Ren Arata");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(chip(container)).toBe("Home");
  });

  it("the bottom hint names the button and the keys, and no click", () => {
    const { container } = render(<Table state={variant(() => {})} />);
    const hint = container.querySelector("[data-camera-chip]")!.textContent ?? "";
    expect(hint).toContain("E zoom my field");
    expect(hint).toContain("P look");
    expect(hint).toContain("0 overview");
    expect(hint).not.toMatch(/click/i);
    fireEvent.keyDown(window, { key: "0" });
    expect(container.querySelector("[data-camera-chip]")!.textContent).not.toMatch(/click/i);
  });

  it("Enter on the enlarged field box still goes back (a keyboard toggle, not a click)", () => {
    const { container } = render(<Table state={variant(() => {})} camera={{ mode: "focus", focusSeat: RYO }} />);
    fireEvent.keyDown(seatBox(container, RYO), { key: "Enter" });
    expect(chip(container)).toBe("Home");
  });

  const idle = () => variant((engine) => { engine.prompt = null; });
  const plainZone = (root: HTMLElement, seat: number) =>
    seatBox(root, seat).querySelector<HTMLElement>("[data-zones][data-occupied='true']:not([data-pile]):not([data-legal='true']) button")!;

  it("a click on a plain zone moves nothing, and a pile button only opens the pile", () => {
    const { container } = render(<Table state={idle()} />);
    fireEvent.click(plainZone(container, RYO));
    expect(chip(container)).toBe("Home");
    fireEvent.click(seatBox(container, MIKA).querySelector<HTMLElement>("[data-pile] button")!);
    expect(chip(container)).toBe("Home");
  });

  it("a card inspect click on an enlarged field keeps it enlarged", () => {
    const { container } = render(<Table state={idle()} camera={{ mode: "focus", focusSeat: RYO }} />);
    fireEvent.click(plainZone(container, RYO));
    expect(chip(container)).toBe("Focus · Ryo Sato");
    fireEvent.click(plainZone(container, RYO));
    expect(chip(container)).toBe("Focus · Ryo Sato");
  });

  it("a zone click moves nothing, with a legal choice on the field or without one", () => {
    for (const state of [variant(onlyOn(RYO)), variant(ownFieldOnly)]) {
      const { container, unmount } = render(<Table state={state} />);
      fireEvent.click(plainZone(container, RYO));
      expect(chip(container)).toBe("Home");
      unmount();
    }
  });

  it("Esc cancels a locked aim first and leaves the enlarged field alone", () => {
    const aim = FFA3_FIXTURES.states["battle-aim"];
    const { container } = render(<Table state={aim} camera={{ mode: "focus", focusSeat: RYO }} />);
    const target = container.querySelector<HTMLElement>("[data-zones][data-legal='true']")!;
    fireEvent.click(target.querySelector("button") ?? target);
    expect(document.body.querySelector("[data-attack-confirm]")).not.toBeNull();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(document.body.querySelector("[data-attack-confirm]")).toBeNull();
    expect(chip(container)).toBe("Focus · Ryo Sato");
  });

  it("Esc while an attack is being aimed (no confirm dialog open) does not leave the enlarged field", () => {
    const { container } = render(<Table state={FFA3_FIXTURES.states["battle-aim"]} camera={{ mode: "focus", focusSeat: RYO }} />);
    expect(document.body.querySelector("[data-attack-confirm]")).toBeNull();
    expect(document.querySelector("[role='dialog']:not([hidden]), [role='menu']:not([hidden])")).toBeNull();
    // Whichever listener runs first, the camera must not rely on defaultPrevented: it has to know the aim owns the key.
    vi.spyOn(Event.prototype, "preventDefault").mockImplementation(() => {});
    fireEvent.keyDown(window, { key: "Escape" });
    expect(chip(container)).toBe("Focus · Ryo Sato");
  });

  it("Esc backs out of a cancelable prompt once, and the field stays enlarged", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const cancelable = variant((engine) => {
      const source = structuredClone(FFA3_FIXTURES.states["target-pick"].room.engine!.prompt!);
      engine.prompt = { ...source, cancelable: true } as typeof engine.prompt;
    });
    const { container } = render(<Table state={cancelable} camera={{ mode: "focus", focusSeat: RYO }} />);
    expect(document.querySelector("[role='dialog']:not([hidden]), [role='menu']:not([hidden])")).toBeNull();
    vi.spyOn(Event.prototype, "preventDefault").mockImplementation(() => {});
    fireEvent.keyDown(window, { key: "Escape" });
    const answers = info.mock.calls.filter((call) => call[0] === "[table-preview] answer").map((call) => (call[1] as { answer: unknown }).answer);
    expect(answers).toEqual([{ cancel: true }]);
    expect(chip(container)).toBe("Focus · Ryo Sato");
  });

  it("Esc and the Back button return to the normal layout", () => {
    const { container } = render(<Table state={variant(() => {})} />);
    fireEvent.keyDown(seatBox(container, MIKA), { key: "Enter" });
    expect(chip(container)).toBe("Focus · Mika Hana");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(chip(container)).toBe("Home");
    fireEvent.keyDown(seatBox(container, MIKA), { key: "Enter" });
    fireEvent.click(container.querySelector("[data-camera-back]")!);
    expect(chip(container)).toBe("Home");
    expect(container.querySelector("[data-camera-back]")).toBeNull();
  });

  it("a seat box is a keyboard stop: Enter enlarges it and Enter again goes back", () => {
    const { container } = render(<Table state={variant(() => {})} />);
    const box = seatBox(container, RYO);
    expect(box.getAttribute("tabindex")).toBe("0");
    expect(box.getAttribute("role")).toBe("button");
    expect(box.getAttribute("aria-pressed")).toBe("false");
    expect(box.getAttribute("aria-label")).toContain("Ryo Sato");
    fireEvent.keyDown(box, { key: "Enter" });
    expect(chip(container)).toBe("Focus · Ryo Sato");
    expect(seatBox(container, RYO).getAttribute("aria-pressed")).toBe("true");
    fireEvent.keyDown(seatBox(container, RYO), { key: " " });
    expect(chip(container)).toBe("Home");
  });

  it("Tab reaches a seat box and Enter enlarges it: the camera does not take Tab", async () => {
    // user-event waits on timers, which the fake clock of this file would never fire.
    vi.useRealTimers();
    const user = userEvent.setup({ delay: null });
    const { container } = render(<Table state={idle()} />);
    let stops = 0;
    while (!(document.activeElement as HTMLElement | null)?.hasAttribute("data-seat-slot") && stops < 80) {
      await user.tab();
      stops += 1;
    }
    expect(stops).toBeLessThan(80);
    const keyDown = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
    window.dispatchEvent(keyDown);
    expect(keyDown.defaultPrevented).toBe(false);
    await user.keyboard("{Enter}");
    expect(chip(container)).toMatch(/^Focus · /);
  });

  it("an enlarged field stays enlarged through an attack, a chain and a new turn", () => {
    const { container, rerender } = render(<Table state={variant(() => {})} />);
    fireEvent.keyDown(seatBox(container, MIKA), { key: "Enter" });
    for (const patch of [
      (engine: NonNullable<TableFixtureState["room"]["engine"]>) => { engine.events = [...engine.events, ev(910, "attack")]; },
      (engine: NonNullable<TableFixtureState["room"]["engine"]>) => { engine.turn += 1; engine.turnSeat = RYO; },
      onlyOn(REN),
    ]) {
      rerender(<Table state={variant(patch)} />);
      advance(3000);
      expect(chip(container)).toBe("Focus · Mika Hana");
    }
  });
});
