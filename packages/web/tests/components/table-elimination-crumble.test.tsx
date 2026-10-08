// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/font/google", () => {
  const font = () => ({ variable: "font-var", className: "font-class" });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});

import { FFA3_FIXTURES } from "@/components/duel/table/fixtures/ffa3";
import { FFA4_FIXTURES } from "@/components/duel/table/fixtures/ffa4";
import type { TableFixtureState } from "@/components/duel/table/fixtures/common";
import { useFixtureController } from "@/components/duel/table/fixtures/use-fixture-controller";
import { TableShell } from "@/components/duel/table/table-shell";
import { GATE_TIMING, LP_TIMING } from "@/components/duel/duel-timing";
import { clearLpMotion, noteLpMotion } from "@/components/duel/lp-motion";
import { CRUMBLE_GATE_CAP_MS, CRUMBLE_GATE_TICK_MS } from "@/components/duel/table/crumble-gate";
import { EXIT_CRUMBLE_MS, EXIT_CRUMBLE_REDUCED_MS } from "@/components/duel/table/rival-field";
import { OUT_HOLD_MS } from "@/components/duel/table/grid-layout";
import { FINALE_BEAT_MS } from "@/components/duel/table/grid-finale";
import { GLIDE_MS } from "@/components/duel/table/use-seat-exits";

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
  vi.useFakeTimers();
  clearLpMotion();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/** The fixture state with some seats out: boards and hands emptied, as the engine view does. */
function withOut(state: TableFixtureState, seats: readonly number[]): TableFixtureState {
  const engine = state.room.engine!;
  return {
    ...state,
    room: {
      ...state.room,
      engine: {
        ...engine,
        seats: engine.seats.map((view) =>
          seats.includes(view.seat)
            ? { ...view, lp: 0, eliminated: true, hand: [], monsters: view.monsters.map(() => null), spells: view.spells.map(() => null) }
            : view,
        ),
      },
    },
  };
}

function Shell({ state, reducedMotion = false }: { state: TableFixtureState; reducedMotion?: boolean }) {
  const controller = useFixtureController(state, { reducedMotion });
  return <TableShell controller={controller} />;
}

const placeOf = (container: HTMLElement, seat: number) => {
  const node = container.querySelector<HTMLElement>(`[data-seat-slot='${seat}']`);
  return node ? { transform: node.style.transform, hidden: node.hidden } : null;
};
const places = (container: HTMLElement, seats: readonly number[]) => Object.fromEntries(seats.map((seat) => [seat, placeOf(container, seat)]));
const crumbles = (container: HTMLElement) => container.querySelectorAll("[data-seat-exit]").length;
const ringTones = (container: HTMLElement) =>
  [...container.querySelectorAll("[data-lp-seat]")].map((node) => `${node.getAttribute("data-lp-seat")}:${(node as HTMLElement).style.getPropertyValue("--seat-main")}`);
// Time passes in gate ticks, each flushed by React: a crumble starts after the board is quiet (crumble-gate.ts), and the
// timers it sets then exist only after that update.
/** The crumble waits for the LP roll of the seat that went out (to 0) and then plays: the longest roll, the crumble and a tick. */
const AFTER_BATTLE = LP_TIMING.rollMaxMs + EXIT_CRUMBLE_MS + CRUMBLE_GATE_TICK_MS;
const settle = (ms: number) => {
  for (let left = ms; left > 0; left -= CRUMBLE_GATE_TICK_MS) act(() => { vi.advanceTimersByTime(Math.min(CRUMBLE_GATE_TICK_MS, left)); });
};

describe("the elimination crumble on a 4-way table", () => {
  const main = FFA4_FIXTURES.states.main;

  it("keeps every place after 4 to 3 and after 3 to 2, and the crumble mounts then unmounts", () => {
    const { container, rerender } = render(<Shell state={main} />);
    const before = places(container, [0, 1, 2, 3]);
    expect(crumbles(container)).toBe(0);

    rerender(<Shell state={withOut(main, [3])} />);
    expect(crumbles(container)).toBe(1);
    expect(container.querySelector("[data-seat-exit='3']")).not.toBeNull();
    // The seat that left has no live board any more, the others did not move.
    expect(container.querySelector("[data-seat-slot='3']")).toBeNull();
    expect(places(container, [0, 1, 2])).toEqual({ 0: before[0], 1: before[1], 2: before[2] });
    settle(AFTER_BATTLE);
    expect(crumbles(container)).toBe(0);
    expect(places(container, [0, 1, 2])).toEqual({ 0: before[0], 1: before[1], 2: before[2] });

    rerender(<Shell state={withOut(main, [3, 2])} />);
    expect(container.querySelector("[data-seat-exit='2']")).not.toBeNull();
    expect(places(container, [0, 1])).toEqual({ 0: before[0], 1: before[1] });
    settle(AFTER_BATTLE);
    expect(crumbles(container)).toBe(0);
    expect(places(container, [0, 1])).toEqual({ 0: before[0], 1: before[1] });
  });

  it("keeps the panels of the seats that left, and notes them in the log with a place", () => {
    const { container, rerender } = render(<Shell state={main} />);
    rerender(<Shell state={withOut(main, [3])} />);
    settle(AFTER_BATTLE);
    expect(container.querySelector("[data-lp-seat='3']")).not.toBeNull();
    const note = container.querySelector("[data-testid='seat-out']");
    expect(note?.textContent).toContain("is out");
    expect(note?.getAttribute("data-fresh")).toBe("true");
  });

  it("does not crumble when the seats are already out on the first render", () => {
    const { container } = render(<Shell state={withOut(main, [2, 3])} />);
    expect(crumbles(container)).toBe(0);
    expect(container.querySelector("[data-crumble]")).toBeNull();
    expect(container.querySelector("[data-seat-slot='2']")).toBeNull();
    expect(container.querySelector("[data-seat-slot='1']")).not.toBeNull();
    for (const note of container.querySelectorAll("[data-testid='seat-out']")) expect(note.hasAttribute("data-fresh")).toBe(false);
    settle(AFTER_BATTLE);
    expect(crumbles(container)).toBe(0);
  });

  it("uses a short fade and no pieces under reduced motion", () => {
    const { container, rerender } = render(<Shell state={main} reducedMotion />);
    rerender(<Shell state={withOut(main, [3])} reducedMotion />);
    expect(container.querySelector("[data-seat-exit='3']")?.getAttribute("data-exit-motion")).toBe("reduced");
    // Reduced motion takes the short pause of the result gate, not the board (no FX to wait for).
    settle(GATE_TIMING.resultReducedPauseMs - CRUMBLE_GATE_TICK_MS);
    expect(container.querySelector("[data-seat-exit='3']")?.hasAttribute("data-exit-held")).toBe(true);
    settle(CRUMBLE_GATE_TICK_MS);
    expect(container.querySelector("[data-crumble='reduced']")).not.toBeNull();
    settle(EXIT_CRUMBLE_REDUCED_MS + CRUMBLE_GATE_TICK_MS);
    expect(crumbles(container)).toBe(0);
  });

  it("shows a Spectating chip and drops the hand when the viewer is the seat that left", () => {
    const { container, rerender } = render(<Shell state={main} />);
    expect(container.querySelector("[data-hand-seat='0']")).not.toBeNull();
    expect(container.querySelector("[data-testid='spectating-chip']")).toBeNull();
    rerender(<Shell state={withOut(main, [0])} />);
    expect(container.querySelector("[data-testid='spectating-chip']")?.textContent).toContain("Spectating");
    expect(container.querySelector("[data-hand-seat='0']")).toBeNull();
    expect(container.querySelector("[data-seat-exit='0']")).not.toBeNull();
    settle(AFTER_BATTLE);
    expect(crumbles(container)).toBe(0);
  });
});

describe("the elimination crumble on a 3-way table", () => {
  const main = FFA3_FIXTURES.states.main;

  it("regroups the two seats left face to face, keeps their tones, and ends the crumble", () => {
    const { container, rerender } = render(<Shell state={main} />);
    const tonesBefore = ringTones(container);
    const before = places(container, [0, 1, 2]);
    rerender(<Shell state={withOut(main, [2])} />);
    expect(container.querySelector("[data-seat-exit='2']")).not.toBeNull();
    expect(container.querySelector("[data-seat-slot='2']")).toBeNull();
    const after = places(container, [0, 1]);
    // The rival board moved to the far side of the face-off (the viewer's own board stays home), and the table glides.
    expect(after[1]).not.toEqual(before[1]);
    expect(after[1]!.transform).not.toEqual(after[0]!.transform);
    expect(container.querySelector("[data-seat-slot='1']")?.getAttribute("data-glide")).toBe("true");
    expect(container.querySelector("[data-plaza]")?.getAttribute("data-glide")).toBe("true");
    settle(LP_TIMING.rollMaxMs + CRUMBLE_GATE_TICK_MS + GLIDE_MS + 200);
    expect(crumbles(container)).toBe(0);
    expect(container.querySelector("[data-seat-slot='1']")?.hasAttribute("data-glide")).toBe(false);
    expect(places(container, [0, 1])).toEqual(after);
    // The seats that stay keep their tones.
    const toneAfter = ringTones(container);
    for (const entry of tonesBefore.filter((tone) => !tone.startsWith("2:"))) expect(toneAfter).toContain(entry);
  });

  it("shows the face-off at once when two seats are already out on load", () => {
    const { container } = render(<Shell state={withOut(main, [2])} />);
    expect(crumbles(container)).toBe(0);
    expect(container.querySelector("[data-crumble]")).toBeNull();
    const after = places(container, [0, 1]);
    expect(after[0]!.transform).not.toEqual(after[1]!.transform);
  });
});

const exitPose = (container: HTMLElement, seat: number) => container.querySelector<HTMLElement>(`[data-seat-exit='${seat}']`)?.style.transform;
const glideNodes = (container: HTMLElement) => container.querySelectorAll("[data-seat-slot][data-glide], [data-holo][data-glide]").length;

describe("the glide only runs when the table regroups", () => {
  it("sends no glide to the boards or panels of a 4-way table after an elimination, with or without reduced motion", () => {
    for (const reducedMotion of [false, true]) {
      const main = FFA4_FIXTURES.states.main;
      const { container, rerender, unmount } = render(<Shell state={main} reducedMotion={reducedMotion} />);
      rerender(<Shell state={withOut(main, [3])} reducedMotion={reducedMotion} />);
      expect(container.querySelector("[data-seat-exit='3']")).not.toBeNull();
      expect(glideNodes(container)).toBe(0);
      expect(container.querySelector("[data-plaza][data-glide]")).toBeNull();
      // Nothing is asserted after the crumble: one large step runs the fake gate interval and timers, then the table goes.
      act(() => { vi.advanceTimersByTime(AFTER_BATTLE); });
      unmount();
    }
  }, 20_000);

  it("sends it to the boards and panels of a 3-way table at 3 to 2", () => {
    const main = FFA3_FIXTURES.states.main;
    const { container, rerender } = render(<Shell state={main} />);
    rerender(<Shell state={withOut(main, [2])} />);
    expect(container.querySelectorAll("[data-seat-slot][data-glide]").length).toBeGreaterThan(0);
    expect(container.querySelectorAll("[data-holo][data-glide]").length).toBeGreaterThan(0);
  });

  it("marks the shell for the in-app reduced motion setting, which the glide rules follow", () => {
    const main = FFA3_FIXTURES.states.main;
    const { container } = render(<Shell state={main} reducedMotion />);
    expect(container.querySelector("[data-reduced='true']")).not.toBeNull();
  });
});

describe("the crumble ends and cleans up", () => {
  afterEach(() => {
    delete (Element.prototype as { animate?: unknown }).animate;
  });

  it("ends when the animation reports it is finished, before the backup timer", async () => {
    (Element.prototype as { animate?: unknown }).animate = () => ({ finished: Promise.resolve(), cancel() {} });
    const main = FFA4_FIXTURES.states.main;
    const { container, rerender } = render(<Shell state={main} />);
    rerender(<Shell state={withOut(main, [3])} />);
    expect(crumbles(container)).toBe(1);
    // The roll of the LP of the seat that left is over; the crumble starts and its animation reports at once.
    settle(LP_TIMING.rollMaxMs + CRUMBLE_GATE_TICK_MS);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(crumbles(container)).toBe(0);
  });

  it("leaves no open timer after the table unmounts in the middle of a crumble", () => {
    const main = FFA3_FIXTURES.states.main;
    const { rerender, unmount } = render(<Shell state={main} />);
    rerender(<Shell state={withOut(main, [2])} />);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("leaves no open timer after every crumble ended", () => {
    const main = FFA4_FIXTURES.states.main;
    const { container, rerender, unmount } = render(<Shell state={main} />);
    rerender(<Shell state={withOut(main, [3])} />);
    settle(AFTER_BATTLE);
    expect(crumbles(container)).toBe(0);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("two seats out close together, and the end of the duel", () => {
  const main = FFA3_FIXTURES.states.main;

  it("starts the second crumble at the pose the board has on screen, not at the new face-off pose", () => {
    const { container, rerender, unmount } = render(<Shell state={main} />);
    const homePose = placeOf(container, 1)!.transform;
    rerender(<Shell state={withOut(main, [2])} />);
    const faceOffPose = placeOf(container, 1)!.transform;
    expect(faceOffPose).not.toEqual(homePose);
    settle(300);
    rerender(<Shell state={withOut(main, [2, 1])} />);
    expect(exitPose(container, 1)).toBe(homePose);
    settle(AFTER_BATTLE);
    expect(crumbles(container)).toBe(0);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("handles two seats out in the same update as the end of the duel", () => {
    const base = withOut(main, [1, 2]);
    const done: TableFixtureState = { ...base, room: { ...base.room, engine: { ...base.room.engine!, result: { winnerSeat: 0, reason: "Last duelist standing" } } } };
    const { container, rerender, unmount } = render(<Shell state={main} />);
    expect(() => rerender(<Shell state={done} />)).not.toThrow();
    settle(AFTER_BATTLE);
    expect(crumbles(container)).toBe(0);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("the viewer is out on a 3-way table", () => {
  const main = FFA3_FIXTURES.states.main;

  it("keeps one live region, drops the hand, and says the elimination once", () => {
    const { container, rerender } = render(<Shell state={main} />);
    const live = container.querySelector("[data-testid='table-live']");
    expect(live).not.toBeNull();
    expect(live?.textContent).toBe("");
    rerender(<Shell state={withOut(main, [0])} />);
    expect(container.querySelector("[data-testid='table-live']")).toBe(live);
    expect(live?.textContent).toContain("You are eliminated");
    expect(container.querySelector("[data-testid='spectating-chip']")?.textContent).toContain("Spectating");
    expect(container.querySelector("[data-hand-seat='0']")).toBeNull();
    // The live region is the only status element that says it; the chip and the log note stay silent for readers.
    expect([...container.querySelectorAll("[role='status']")].filter((node) => /eliminated|spectating/i.test(node.textContent ?? "")).length).toBe(1);
    expect(container.querySelector("[data-testid='spectating-chip']")?.getAttribute("aria-hidden")).toBe("true");
    settle(AFTER_BATTLE);
    expect(crumbles(container)).toBe(0);
  });
});

describe("a seat that is out keeps its panel, with its place", () => {
  it("shows the Eliminated chip with the place on a 4-way panel", () => {
    const main = FFA4_FIXTURES.states.main;
    const { container, rerender } = render(<Shell state={main} />);
    rerender(<Shell state={withOut(main, [3])} />);
    settle(AFTER_BATTLE);
    expect(container.querySelector("[data-holo='3']")?.textContent).toMatch(/Eliminated, \d/);
  });
});

describe("the camera controls of a 3-way face-off", () => {
  const main = FFA3_FIXTURES.states.main;
  const open = (container: HTMLElement) => {
    const toggle = container.querySelector<HTMLElement>("[aria-controls='camera-view-grid']");
    if (toggle) act(() => { toggle.click(); });
  };

  it("has Overview, Focus and Look with three seats and drops them with two", () => {
    const { container, rerender } = render(<Shell state={main} />);
    open(container);
    expect(container.querySelector("[data-cam='overview']")).not.toBeNull();
    expect(container.querySelector("[data-seat-switch='overview']")).not.toBeNull();
    rerender(<Shell state={withOut(main, [2])} />);
    settle(AFTER_BATTLE);
    expect(container.querySelector("[data-cam='overview']")).toBeNull();
    expect(container.querySelector("[data-seat-switch='overview']")).toBeNull();
    expect(container.querySelectorAll("[data-seat-switch]").length).toBe(1);
  });
});

describe("the camera keys in a 3-way face-off", () => {
  const main = FFA3_FIXTURES.states.main;
  const mode = (container: HTMLElement) => container.querySelector("[data-camera-mode]")?.getAttribute("data-camera-mode");
  const press = (key: string) => act(() => { fireEvent.keyDown(window, { key }); });

  it("keeps the camera home on 0, Tab and P", () => {
    const { container, rerender } = render(<Shell state={main} />);
    rerender(<Shell state={withOut(main, [2])} />);
    settle(5000);
    for (const key of ["0", "Tab", "p"]) {
      press(key);
      expect(mode(container)).toBe("home");
    }
  });

  it("works with three seats", () => {
    const { container } = render(<Shell state={main} />);
    press("0");
    expect(mode(container)).toBe("fly");
  });

  it("sends a camera in fly mode home after the lock of the second elimination", () => {
    const { container, rerender } = render(<Shell state={main} />);
    press("0");
    expect(mode(container)).toBe("fly");
    rerender(<Shell state={withOut(main, [2])} />);
    // Home at once, while the FX lock still runs: no wait, and no frame of the old fly pose.
    expect(mode(container)).toBe("home");
    settle(6000);
    expect(mode(container)).toBe("home");
  });
});

describe("the crumble in the stage and side layout", () => {
  const main = FFA4_FIXTURES.states.main;
  const spot = (container: HTMLElement, seat: number, attr: "data-seat-slot" | "data-seat-exit") => {
    const node = container.querySelector<HTMLElement>(`[${attr}='${seat}']`);
    return node ? { left: node.style.left, top: node.style.top, rotate: node.style.rotate, transform: node.style.transform, z: node.style.getPropertyValue("--sf-z") } : null;
  };

  it("draws the crumble in the cell of the field it replaces, turned like it and cut below the shared row, and no field moves", () => {
    const { container, rerender } = render(<Shell state={main} />);
    const others = [0, 1].map((seat) => spot(container, seat, "data-seat-slot"));
    rerender(<Shell state={withOut(main, [2])} />);
    expect(spot(container, 2, "data-seat-slot")).toBeNull();
    const exit = container.querySelector<HTMLElement>("[data-seat-exit='2']")!;
    expect(exit.closest("[data-grid-cell='2']")).not.toBeNull();
    expect(exit.style.transform).toContain("rotate(180deg)");
    expect(exit.style.clipPath).toMatch(/^inset\(/);
    expect([0, 1].map((seat) => spot(container, seat, "data-seat-slot"))).toEqual(others);
    settle(AFTER_BATTLE);
    expect(crumbles(container)).toBe(0);
  });

  it("gives the shared Extra Monster row to the partner while the crumble plays", () => {
    const { container, rerender } = render(<Shell state={main} />);
    const emz = (seat: number) => container.querySelector(`[data-seat-slot='${seat}'] [data-seat-field]`)?.getAttribute("data-emz");
    expect(emz(3)).toBe("pair");
    rerender(<Shell state={withOut(main, [3])} />);
    expect(crumbles(container)).toBe(1);
    expect(emz(2)).toBe("pair");
  });
});

describe("the crumble waits for the attack, the damage and the LP roll that put the seat out", () => {
  // The battle layers draw with script animations (BattleFx) and the LP counter rolls on its own clock (lp-motion.ts).
  // The board animations are stubbed here: a running one stands for the attack and the damage hit.
  let battleRunning = false;
  let strike: HTMLElement | null = null;
  beforeEach(() => {
    battleRunning = false;
    const target = document.createElement("div");
    strike = target;
    document.body.append(target);
    (document as unknown as { getAnimations: () => unknown[] }).getAnimations = () =>
      battleRunning ? [{ finished: new Promise(() => {}), playState: "running", effect: { getTiming: () => ({ iterations: 1 }), target } }] : [];
  });
  afterEach(() => {
    delete (document as unknown as { getAnimations?: unknown }).getAnimations;
    strike?.remove();
    strike = null;
  });

  const heldOf = (container: HTMLElement, seat: number) => container.querySelector(`[data-seat-exit='${seat}']`)?.hasAttribute("data-exit-held");
  const stateOf = (container: HTMLElement) => container.querySelector("[data-seat-exit] [data-crumble]")?.getAttribute("data-crumble") ?? null;
  const CRUMBLE_MS = EXIT_CRUMBLE_MS;

  for (const [name, fixtures, seat] of [
    ["3-way", FFA3_FIXTURES, 2],
    ["4-way", FFA4_FIXTURES, 3],
  ] as const) {
    it(`starts the crumble of a ${name} seat only after the attack, the damage hit and the LP roll have ended`, () => {
      const main = fixtures.states.main;
      const { container, rerender } = render(<Shell state={main} />);
      // The attack plays and the LP roll is noted (hold + roll), as the engine view with the kill arrives.
      battleRunning = true;
      noteLpMotion(1500);
      rerender(<Shell state={withOut(main, [seat])} />);
      expect(heldOf(container, seat)).toBe(true);
      expect(stateOf(container)).toBe("held");

      // The attack and the damage hit are still on the board: the board waits, whole.
      settle(900);
      expect(heldOf(container, seat)).toBe(true);
      expect(stateOf(container)).toBe("held");

      // They end, but the LP counter still rolls: it waits for the roll too.
      battleRunning = false;
      settle(300);
      expect(heldOf(container, seat)).toBe(true);
      expect(stateOf(container)).toBe("held");

      // The roll ends (1500 ms after it was noted, and the roll of the seat itself): the crumble starts, and plays its own time from there.
      let waited = 0;
      while (heldOf(container, seat) && waited < LP_TIMING.rollMaxMs * 2) {
        settle(CRUMBLE_GATE_TICK_MS);
        waited += CRUMBLE_GATE_TICK_MS;
      }
      expect(heldOf(container, seat)).toBe(false);
      expect(stateOf(container)).not.toBe("held");
      settle(CRUMBLE_MS - CRUMBLE_GATE_TICK_MS);
      expect(crumbles(container)).toBe(1);
      settle(CRUMBLE_GATE_TICK_MS * 2);
      expect(crumbles(container)).toBe(0);
    });
  }

  it("starts at once when nothing is playing, and never waits longer than the result gate would", () => {
    const main = FFA3_FIXTURES.states.main;
    const { container, rerender } = render(<Shell state={main} />);
    rerender(<Shell state={withOut(main, [2])} />);
    expect(stateOf(container)).toBe("held");
    settle(CRUMBLE_GATE_TICK_MS + LP_TIMING.rollMaxMs);
    expect(heldOf(container, 2)).toBe(false);

    // A battle that never ends: the crumble starts at the cap.
    cleanup();
    battleRunning = true;
    const next = render(<Shell state={main} />);
    next.rerender(<Shell state={withOut(main, [2])} />);
    settle(CRUMBLE_GATE_CAP_MS - CRUMBLE_GATE_TICK_MS);
    expect(heldOf(next.container, 2)).toBe(true);
    settle(CRUMBLE_GATE_TICK_MS * 2);
    expect(heldOf(next.container, 2)).toBe(false);
  });

  it("holds the glide of the seats that stay with the crumble on a 3-way table", () => {
    const main = FFA3_FIXTURES.states.main;
    const { container, rerender } = render(<Shell state={main} />);
    battleRunning = true;
    rerender(<Shell state={withOut(main, [2])} />);
    // The regroup glide is on for the whole wait, however long the battle lasts (longer than GLIDE_MS).
    settle(GLIDE_MS + 500);
    expect(heldOf(container, 2)).toBe(true);
    expect(container.querySelector("[data-seat-slot='1']")?.getAttribute("data-glide")).toBe("true");
    battleRunning = false;
    settle(CRUMBLE_GATE_TICK_MS * 2);
    expect(heldOf(container, 2)).toBe(false);
    expect(container.querySelector("[data-seat-slot='1']")?.getAttribute("data-glide")).toBe("true");
    // GLIDE_MS counts from the crumble start.
    settle(GLIDE_MS + 200);
    expect(container.querySelector("[data-seat-slot='1']")?.hasAttribute("data-glide")).toBe(false);
  });

  const finaleOf = (container: HTMLElement) => container.querySelector("[data-grid-stage]")?.getAttribute("data-grid-finale") ?? null;
  const BEAT_AND_CRUMBLE = EXIT_CRUMBLE_MS + FINALE_BEAT_MS;
  // Time to the release of the held crumble, in gate ticks.
  const untilReleased = (container: HTMLElement, seat: number) => {
    let waited = 0;
    while (heldOf(container, seat) && waited <= CRUMBLE_GATE_CAP_MS) {
      settle(CRUMBLE_GATE_TICK_MS);
      waited += CRUMBLE_GATE_TICK_MS;
    }
    return waited;
  };

  it("shows the 4-way finale board only a crumble and a beat after the crumble started, not after the elimination", () => {
    const main = FFA4_FIXTURES.states.main;
    const { container, rerender } = render(<Shell state={main} />);
    rerender(<Shell state={withOut(main, [3])} />);
    settle(AFTER_BATTLE);
    expect(crumbles(container)).toBe(0);
    battleRunning = true;
    rerender(<Shell state={withOut(main, [3, 2])} />);
    // The battle outlasts the crumble and the beat, and the board still waits.
    settle(BEAT_AND_CRUMBLE + 1000);
    expect(heldOf(container, 2)).toBe(true);
    expect(finaleOf(container)).toBeNull();
    battleRunning = false;
    untilReleased(container, 2);
    expect(heldOf(container, 2)).toBe(false);
    settle(BEAT_AND_CRUMBLE - CRUMBLE_GATE_TICK_MS);
    expect(finaleOf(container)).toBeNull();
    settle(CRUMBLE_GATE_TICK_MS * 2);
    expect(finaleOf(container)).not.toBeNull();
  });

  it("holds the finale for two seats that go out together until both crumbles have started", () => {
    const main = FFA4_FIXTURES.states.main;
    const { container, rerender } = render(<Shell state={main} />);
    battleRunning = true;
    rerender(<Shell state={withOut(main, [2, 3])} />);
    expect(crumbles(container)).toBe(2);
    settle(BEAT_AND_CRUMBLE + 1000);
    expect(heldOf(container, 2)).toBe(true);
    expect(heldOf(container, 3)).toBe(true);
    expect(finaleOf(container)).toBeNull();
    battleRunning = false;
    untilReleased(container, 2);
    // They crumble together: the board is not held for one of them.
    expect(heldOf(container, 3)).toBe(false);
    settle(BEAT_AND_CRUMBLE - CRUMBLE_GATE_TICK_MS);
    expect(finaleOf(container)).toBeNull();
    settle(CRUMBLE_GATE_TICK_MS * 2);
    expect(finaleOf(container)).not.toBeNull();
  });

  it("does not wait for the board under reduced motion, only for the short pause, however long the battle", () => {
    const main = FFA3_FIXTURES.states.main;
    const { container, rerender } = render(<Shell state={main} reducedMotion />);
    battleRunning = true;
    noteLpMotion(1500);
    rerender(<Shell state={withOut(main, [2])} reducedMotion />);
    settle(GATE_TIMING.resultReducedPauseMs - CRUMBLE_GATE_TICK_MS);
    expect(heldOf(container, 2)).toBe(true);
    settle(CRUMBLE_GATE_TICK_MS);
    expect(heldOf(container, 2)).toBe(false);
    expect(stateOf(container)).toBe("reduced");
  });

  it("pauses only the regroup transitions of its own table while it waits, and lets them go on when the crumble starts", () => {
    const main = FFA3_FIXTURES.states.main;
    const { container, rerender } = render(<Shell state={main} />);
    const stage = container.querySelector<HTMLElement>("[data-table-stage]")!;
    const other = document.createElement("div");
    stage.append(other);
    class CSSTransition {
      playState = "running";
      currentTime = 100;
      pause = vi.fn(() => { this.playState = "paused"; });
      play = vi.fn(() => { this.playState = "running"; });
      finished = new Promise(() => {});
      effect: { target: Element; getTiming: () => { delay: number } };
      constructor(target: Element) {
        this.effect = { target, getTiming: () => ({ delay: 2200 }) };
      }
    }
    const regroup = { current: null as CSSTransition | null };
    const unrelated = new CSSTransition(other);
    (stage as unknown as { getAnimations: () => unknown[] }).getAnimations = () => [regroup.current, unrelated].filter(Boolean);
    battleRunning = true;
    rerender(<Shell state={withOut(main, [2])} />);
    regroup.current = new CSSTransition(container.querySelector("[data-seat-slot='1']")!);
    expect(regroup.current.effect.target.getAttribute("data-glide")).toBe("true");
    // Two frames on, the regroup is paused; the rest of the table (the LP colour, the chain slot) runs on.
    act(() => { vi.advanceTimersByTime(48); });
    expect(regroup.current.pause).toHaveBeenCalledTimes(1);
    expect(unrelated.pause).not.toHaveBeenCalled();
    settle(1000);
    expect(regroup.current.play).not.toHaveBeenCalled();
    battleRunning = false;
    untilReleased(container, 2);
    expect(regroup.current.play).toHaveBeenCalledTimes(1);
    expect(unrelated.play).not.toHaveBeenCalled();
  });

  it("keeps the 4-way cell of the seat out, and its outline hidden, for as long as the board is held, and counts the out hold from the crumble start", () => {
    const main = FFA4_FIXTURES.states.main;
    const { container, rerender } = render(<Shell state={main} />);
    const cell = () => container.querySelector("[data-grid-cell='3']");
    battleRunning = true;
    rerender(<Shell state={withOut(main, [3])} />);
    settle(OUT_HOLD_MS + 1000);
    expect(heldOf(container, 3)).toBe(true);
    expect(cell()?.getAttribute("data-cell-state")).toBe("out");
    // jsdom does not apply :has, so the marks the CSS hides the outline and the plate label by are checked: the outline is
    // a late one (it waits for the crumble) and the plate of the seat is held (no "Eliminated" label, no strike line).
    const outline = () => container.querySelector("[data-out-outline='3']");
    const plate = () => container.querySelector("[data-grid-lp='3'] [data-holo]");
    expect(outline()?.getAttribute("data-late")).toBe("true");
    expect(plate()?.getAttribute("data-held")).toBe("true");
    battleRunning = false;
    untilReleased(container, 3);
    expect(outline()?.getAttribute("data-late")).toBe("true");
    expect(plate()?.getAttribute("data-held")).toBeNull();
    settle(OUT_HOLD_MS - 2 * CRUMBLE_GATE_TICK_MS);
    expect(cell()?.getAttribute("data-cell-state")).toBe("out");
    settle(CRUMBLE_GATE_TICK_MS * 4);
    expect(cell()?.getAttribute("data-cell-state")).toBe("empty");
  });
});
