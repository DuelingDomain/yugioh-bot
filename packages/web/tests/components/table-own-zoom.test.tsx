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

// Counts every placement of a prompt room (the table recomputes the rooms only when its inputs change).
const placed = vi.hoisted(() => ({ calls: 0, noPanel: false }));
// `noPanel` makes the planner find no free room for the seat-choice panel (the CSS fallback rules then place it).
vi.mock("@/components/duel/table/geometry", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/duel/table/geometry")>();
  return {
    ...actual,
    promptRooms: (...args: Parameters<typeof actual.promptRooms>) => {
      const found = actual.promptRooms(...args);
      return placed.noPanel ? { ...found, panel: null } : found;
    },
  };
});
vi.mock("@/components/duel/table/view-zoom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/duel/table/view-zoom")>();
  return {
    ...actual,
    clearRoom: (...args: Parameters<typeof actual.clearRoom>) => { placed.calls += 1; return actual.clearRoom(...args); },
    fitRoom: (...args: Parameters<typeof actual.fitRoom>) => { placed.calls += 1; return actual.fitRoom(...args); },
  };
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
  placed.calls = 0;
  placed.noPanel = false;
  window.localStorage.clear();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date", "performance"] });
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

/** More than the longest hold of the crumble gate (9.5 s), so the regroup has ended in every table the tests run on. */
const GATE_WAIT_MS = 12_000;
/** A safety net for a slow runner: each of these tests takes well under 2 s on a normal machine. */
const TEST_TIMEOUT_MS = 20_000;
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
/**
 * Runs the fake clock until the regroup has ended, at most GATE_WAIT_MS: a gate that holds it (the LP roll) is waited
 * out in coarse steps, and a table that does not hold it costs no extra time.
 */
const settleRegroup = (root: HTMLElement) => {
  for (let t = 0; t < GATE_WAIT_MS && root.querySelector("[data-table-stage]")?.getAttribute("data-regroup") != null; t += 250) advance(250);
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
    fireEvent.click(seatBox(container, REN), { detail: 1 });
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

  it("the pinned peek is measured again when its slide ends, so the refit does not keep the rect of the first frame", async () => {
    frames();
    layout();
    const { container } = render(<Table state={idle()} camera={{ mode: "focus", focusSeat: REN }} />);
    advance(600);
    const peek = document.createElement("aside");
    peek.setAttribute("data-testid", "hover-preview");
    peek.setAttribute("data-pinned", "true");
    const at = (width: number) => ({ x: 1100 - width, y: 0, left: 1100 - width, top: 0, width, height: 860, right: 1100, bottom: 860, toJSON: () => ({}) }) as DOMRect;
    // The peek has barely slid in when it is first read.
    peek.getBoundingClientRect = () => at(40);
    await act(async () => {
      container.querySelector("[data-table-shell]")!.appendChild(peek);
      await Promise.resolve();
    });
    advance(100);
    advance(800);
    const early = scale(container);
    // Its slide ends at full width: the transition end reads the rect again and the zoom fits the peek.
    peek.getBoundingClientRect = () => at(270);
    await act(async () => {
      peek.dispatchEvent(new Event("transitionend", { bubbles: true }));
      await Promise.resolve();
    });
    advance(100);
    advance(800);
    expect(scale(container)).toBeLessThan(early);
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
      container.querySelector("[data-table-shell]")!.appendChild(peek);
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

  /** The same idle table with the third seat out of the duel (a 3-way down to a face-off). */
  const withMikaOut = () => {
    const engine = structuredClone(idle().room.engine!);
    engine.seats[2].lp = 0;
    engine.seats[2].eliminated = true;
    return { ...BASE, room: { ...BASE.room, engine } } as TableFixtureState;
  };

  it("an elimination keeps the zoom of your own field: no reset, no camera move, at every step of the regroup", () => {
    frames();
    const focus = { mode: "focus", focusSeat: REN } as const;
    const { container, rerender } = render(<Table state={idle()} camera={focus} />);
    advance(600);
    const before = scale(container);
    expect(before).toBeGreaterThan(1.02);
    rerender(<Table state={withMikaOut()} camera={focus} />);
    // A regroup can be held for the LP roll (a poll with setInterval, up to 9.5 s on a table with the crumble gate): the steps run through it.
    for (let t = 0; t < 4600; t += 100) {
      advance(100);
      expect(scale(container)).toBeGreaterThan(1.02);
      expect(chip(container)).toBe("Focus · Ren Arata");
    }
    // A gate that holds the regroup is waited out in coarse steps: 100 ms steps over 12 s cost seconds of real time on a slow runner.
    settleRegroup(container);
    expect(scale(container)).toBeGreaterThan(1.02);
    expect(chip(container)).toBe("Focus · Ren Arata");
    expect(board(container).getAttribute("data-regroup")).toBeNull();
  }, TEST_TIMEOUT_MS);

  it("after the regroup the view is fitted to the new field again, with the same eased path", () => {
    frames();
    const focus = { mode: "focus", focusSeat: REN } as const;
    const { container, rerender } = render(<Table state={idle()} camera={focus} />);
    advance(600);
    rerender(<Table state={withMikaOut()} camera={focus} />);
    advance(300);
    expect(board(container).getAttribute("data-regroup")).toBe("true");
    const during = layer(container).style.transform;
    // The fit waits for the seats to stand still: the view does not move while they glide.
    advance(2500);
    expect(layer(container).style.transform).toBe(during);
    advance(2400);
    settleRegroup(container);
    expect(board(container).getAttribute("data-regroup")).toBeNull();
    expect(scale(container)).toBeGreaterThan(1.02);
  }, TEST_TIMEOUT_MS);

  it("after an elimination the player's own zoom level stays", () => {
    frames();
    const focus = { mode: "focus", focusSeat: REN } as const;
    const { container, rerender } = render(<Table state={idle()} camera={focus} />);
    advance(600);
    fireEvent.wheel(board(container), { deltaY: -300, clientX: 300, clientY: 300 });
    advance(600);
    const byHand = scale(container);
    rerender(<Table state={withMikaOut()} camera={focus} />);
    advance(5000);
    settleRegroup(container);
    expect(scale(container)).toBeCloseTo(byHand, 3);
    expect(chip(container)).toBe("Focus · Ren Arata");
  }, TEST_TIMEOUT_MS);

  it("an elimination at home does not move the camera", () => {
    frames();
    const { container, rerender } = render(<Table state={idle()} />);
    advance(600);
    expect(chip(container)).toBe("Home");
    rerender(<Table state={withMikaOut()} />);
    advance(5000);
    settleRegroup(container);
    expect(chip(container)).toBe("Home");
    expect(layer(container).style.transform).toBe("");
  }, TEST_TIMEOUT_MS);

  it("in a face-off, a click on a rival zone keeps the zoom of your own field", () => {
    frames();
    const focus = { mode: "focus", focusSeat: REN } as const;
    const { container, rerender } = render(<Table state={idle()} camera={focus} />);
    advance(600);
    rerender(<Table state={withMikaOut()} camera={focus} />);
    advance(5000);
    settleRegroup(container);
    const zone = seatBox(container, RYO).querySelector<HTMLElement>("[data-zones][data-occupied='true']:not([data-pile]):not([data-legal='true']) button")!;
    expect(zone).not.toBeNull();
    fireEvent.click(zone);
    advance(800);
    expect(board(container).getAttribute("data-camera-mode")).toBe("focus");
    expect(chip(container)).toBe("Focus · Ren Arata");
    expect(scale(container)).toBeGreaterThan(1.02);
  }, TEST_TIMEOUT_MS);

  it("in a face-off, Back and then E (or the Zoom my field button) zoom your own field again", () => {
    frames();
    const focus = { mode: "focus", focusSeat: REN } as const;
    const { container, rerender } = render(<Table state={idle()} camera={focus} />);
    advance(600);
    rerender(<Table state={withMikaOut()} camera={focus} />);
    advance(5000);
    settleRegroup(container);
    fireEvent.click(container.querySelector("[data-camera-back]")!);
    advance(800);
    expect(chip(container)).toBe("Home");
    expect(scale(container)).toBeLessThanOrEqual(1.001);
    fireEvent.keyDown(window, { key: "e" });
    advance(800);
    expect(chip(container)).toBe("Focus · Ren Arata");
    expect(scale(container)).toBeGreaterThan(1.02);
    fireEvent.click(container.querySelector("[data-camera-back]")!);
    advance(800);
    fireEvent.click(container.querySelector("[data-camera-zoom]")!);
    advance(800);
    expect(chip(container)).toBe("Focus · Ren Arata");
    expect(scale(container)).toBeGreaterThan(1.02);
  }, TEST_TIMEOUT_MS);

  it("hides the Zoom my field button when your own seat is out", () => {
    const engine = structuredClone(idle().room.engine!);
    engine.seats[REN].lp = 0;
    engine.seats[REN].eliminated = true;
    const { container, rerender } = render(<Table state={idle()} />);
    expect(container.querySelector("[data-camera-zoom]")).not.toBeNull();
    rerender(<Table state={{ ...BASE, room: { ...BASE.room, engine } } as TableFixtureState} />);
    advance(5000);
    settleRegroup(container);
    expect(container.querySelector("[data-camera-zoom]")).toBeNull();
  }, TEST_TIMEOUT_MS);

  it("Esc leaves the zoom of your own field in a face-off", () => {
    frames();
    const focus = { mode: "focus", focusSeat: REN } as const;
    const { container, rerender } = render(<Table state={idle()} camera={focus} />);
    advance(600);
    rerender(<Table state={withMikaOut()} camera={focus} />);
    advance(5000);
    settleRegroup(container);
    fireEvent.keyDown(window, { key: "Escape" });
    advance(800);
    expect(chip(container)).toBe("Home");
    expect(scale(container)).toBeLessThanOrEqual(1.001);
  }, TEST_TIMEOUT_MS);

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

  it("the rooms of the prompts are planned once at the fit, and the zoom itself never plans them again", () => {
    frames();
    layout({ x: 300, y: 700, width: 500, height: 160 });
    const { container } = render(<Table state={FFA3_FIXTURES.states["choose-opponent"]} camera={{ mode: "focus", focusSeat: REN }} />);
    // The entry ease runs to its end: the rooms are placed for the fit.
    advance(800);
    expect(placed.calls).toBeGreaterThan(0);
    const settled = placed.calls;
    const at = () => `${board(container).style.getPropertyValue("--room-x")},${board(container).style.getPropertyValue("--room-y")}|${board(container).dataset.barRoom ?? ""}`;
    const room = at();
    // A manual zoom and pan move the view for many frames: no frame plans a room again (the rooms do not read the live view).
    fireEvent.wheel(board(container), { deltaY: -300, clientX: 300, clientY: 300 });
    for (let i = 0; i < 60; i++) {
      advance(16);
      expect(placed.calls).toBe(settled);
    }
    expect(at()).toBe(room);
  });

  it("measures the legal targets again once after a pan by hand, and not again after the refit that follows", () => {
    frames();
    layout({ x: 300, y: 700, width: 500, height: 160 });
    const { container } = render(<Table state={FFA3_FIXTURES.states["target-pick"]} camera={{ mode: "focus", focusSeat: REN }} />);
    advance(2500);
    const query = vi.spyOn(HTMLElement.prototype, "querySelectorAll");
    const measures = () => query.mock.calls.filter(([selector]) => selector === '[data-legal="true"]').length;
    fireEvent.wheel(board(container), { deltaY: -300, clientX: 300, clientY: 300 });
    // In steps: React renders the state of the rest between them.
    for (let t = 0; t < 4000; t += 250) advance(250);
    // One measure run (the frame, the settle and the late timer) for the pan; more than that is a repeat.
    const after = measures();
    expect(after).toBeGreaterThan(0);
    expect(after).toBeLessThanOrEqual(3);
    for (let t = 0; t < 6000; t += 250) advance(250);
    expect(measures()).toBe(after);
  }, TEST_TIMEOUT_MS);

  describe("the seat-choice panel is fixed to the middle of the screen", () => {
    type R = { x: number; y: number; width: number; height: number };
    const rect = (r: R) => ({ x: r.x, y: r.y, left: r.x, top: r.y, width: r.width, height: r.height, right: r.x + r.width, bottom: r.y + r.height, toJSON: () => ({}) }) as DOMRect;
    const state = FFA3_FIXTURES.states["choose-opponent"];
    const px = (el: HTMLElement, name: string) => Number.parseFloat(el.style.getPropertyValue(name));
    // Renders the seat choice with a mocked layout: `hand` (the hand cards) and `chip` (the camera chip) may stand anywhere.
    const place = (mock: { hand?: R; chip?: R }, camera: Partial<CameraState> = { mode: "focus", focusSeat: REN }) => {
      vi.restoreAllMocks();
      frames();
      vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
        if (this.hasAttribute("data-table-stage")) return rect({ x: 0, y: 0, width: 1100, height: 860 });
        if (mock.hand && this.hasAttribute("data-hand-card") && this.closest('[data-hand-seat][data-side="you"]')) return rect(mock.hand);
        if (mock.chip && this.hasAttribute("data-camera-chip")) return rect(mock.chip);
        return rect({ x: 0, y: 0, width: 0, height: 0 });
      });
      const view = render(<Table state={state} camera={camera} />);
      advance(900);
      const el = view.container.querySelector<HTMLElement>('[data-slot="prompt"]')!;
      const stage = board(view.container);
      const out = {
        centered: stage.getAttribute("data-prompt-center") === "true",
        planned: stage.hasAttribute("data-panel-room") || stage.style.getPropertyValue("--room-x") !== "",
        cx: px(el, "--pr-cx"),
        cy: px(el, "--pr-cy"),
        w: px(el, "--pr-w"),
        h: px(el, "--pr-h"),
      };
      view.unmount();
      return out;
    };

    it("sits in the middle of the box across, in the band of the near field down, with no planned room", () => {
      const at = place({ hand: { x: 300, y: 700, width: 500, height: 160 } });
      expect(at.centered).toBe(true);
      expect(at.planned).toBe(false);
      expect(at.cx).toBe(550);
      expect(at.w).toBe(1100);
      expect(at.cy).toBeGreaterThan(0);
      expect(at.cy).toBeLessThan(860);
      // The band is centred in the box, so the prompt is in the middle of the screen down too.
      expect(Math.abs(at.cy - 430)).toBeLessThanOrEqual(1);
      expect(at.h).toBeGreaterThan(0);
      expect(at.h).toBeLessThanOrEqual(860 - 24);
    });

    it("stays in the same place in your own zoom, in a rival's focus and at home", () => {
      const hand = { x: 300, y: 700, width: 500, height: 160 };
      const focus = place({ hand }, { mode: "focus", focusSeat: REN });
      const rival = place({ hand }, { mode: "focus", focusSeat: 1 });
      const home = place({ hand }, { mode: "home" });
      for (const other of [rival, home]) {
        expect(other.centered).toBe(true);
        expect(other.planned).toBe(false);
        expect({ cx: other.cx, cy: other.cy, w: other.w }).toEqual({ cx: focus.cx, cy: focus.cy, w: focus.w });
      }
    });

    it("does not move for the hand or the camera chip (the prompt never dodges the camera or the hover)", () => {
      const free = place({ hand: { x: 300, y: 700, width: 500, height: 160 } });
      // The hand and the chip now stand on the middle of the screen: the prompt keeps its place.
      const crowded = place({ hand: { x: 0, y: 300, width: 1100, height: 500 }, chip: { x: 400, y: 380, width: 300, height: 100 } });
      expect(crowded.centered).toBe(true);
      expect(crowded.planned).toBe(false);
      expect({ cx: crowded.cx, cy: crowded.cy, w: crowded.w, h: crowded.h }).toEqual({ cx: free.cx, cy: free.cy, w: free.w, h: free.h });
    });

    it("keeps the seat-choice panel in the middle band, clear of the hand at rest", () => {
      const hand = { x: 300, y: 700, width: 500, height: 160 };
      const at = place({ hand });
      const band = { x: 0, y: at.cy - at.h / 2, width: at.w, height: at.h };
      // The band of the near field ends above the hand, so the panel (which keeps inside it) does not cover the hand at rest.
      expect(band.y + band.height).toBeLessThanOrEqual(hand.y);
    });
  });

  it("the chip is HUD for the pan and keeps clear of the Reset control", () => {
    frames();
    const state = FFA3_FIXTURES.states["target-pick"];
    const first = render(<Table state={state} camera={{ mode: "focus", focusSeat: REN }} />);
    advance(800);
    const free = first.container.querySelector<HTMLElement>("[data-rival-hint]")!;
    expect(free.hasAttribute("data-zoom-occluder")).toBe(true);
    const home = { left: free.style.left, top: free.style.top };
    first.unmount();
    // The Reset control stands where the chip would: the chip slides along its edge to clear it.
    const rect = (x: number, y: number, width: number, height: number) => ({ x, y, left: x, top: y, width, height, right: x + width, bottom: y + height, toJSON: () => ({}) }) as DOMRect;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      if (this.hasAttribute("data-table-stage")) return rect(0, 0, 1100, 860);
      if (this.hasAttribute("data-view-reset")) return rect(0, 0, 160, 60);
      return rect(0, 0, 0, 0);
    });
    const second = render(<Table state={state} camera={{ mode: "focus", focusSeat: REN }} />);
    advance(800);
    const moved = second.container.querySelector<HTMLElement>("[data-rival-hint]")!;
    expect({ left: moved.style.left, top: moved.style.top }).not.toEqual(home);
    // It sits clear of the control.
    const x = Number.parseFloat(moved.style.left);
    const y = Number.parseFloat(moved.style.top);
    expect(x - 76 >= 160 || y - 14 >= 60).toBe(true);
    expect(moved.querySelector("span")?.textContent).toMatch(/\S/);
  });
});
