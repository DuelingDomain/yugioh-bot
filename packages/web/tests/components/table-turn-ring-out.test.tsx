// @vitest-environment jsdom
import React from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next/font/google", () => {
  const font = () => ({ variable: "font-var", className: "font-class" });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});

import type { DuelEngineView } from "@yugidraft/shared/duels";
import { FFA3_FIXTURES } from "@/components/duel/table/fixtures/ffa3";
import { FFA4_FIXTURES } from "@/components/duel/table/fixtures/ffa4";
import type { TableFixtureState } from "@/components/duel/table/fixtures/common";
import { useFixtureController } from "@/components/duel/table/fixtures/use-fixture-controller";
import { tableLayout } from "@/components/duel/table/geometry";
import { nextLivingSeat } from "@/components/duel/table/seat-state";
import { targetChoices } from "@/components/duel/table/targets";
import { TableShell } from "@/components/duel/table/table-shell";
import { TurnRing } from "@/components/duel/table/turn-ring";

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
afterEach(cleanup);

type Flags = { eliminated?: boolean; pendingElimination?: boolean };

/** The fixture's engine with flags set on some seats and the turn seat moved. */
function withSeats(state: TableFixtureState, flags: Record<number, Flags>, turnSeat: number): DuelEngineView {
  const engine = state.room.engine!;
  return { ...engine, turnSeat, seats: engine.seats.map((view) => ({ ...view, ...(flags[view.seat] ?? {}) })) };
}

function ringOf(engine: DuelEngineView, format: "ffa3" | "ffa4") {
  const layout = tableLayout(format, engine, 0);
  const step = 360 / layout.slots.length;
  const angles = new Map(layout.slots.map((slot, i) => [slot.seat, 90 + i * step]));
  return render(<TurnRing layout={layout} engine={engine} angles={angles} pose={{ x: 550, y: 322, scale: 1 }} promptSeat={null} />);
}

const arcsOf = (container: HTMLElement) =>
  [...container.querySelectorAll("[data-arc]")].map((node) => ({
    from: Number(node.getAttribute("data-arc")),
    to: Number(node.getAttribute("data-arc-to")),
    lit: node.getAttribute("data-lit") === "true",
  }));

describe("TurnRing with seats out (4-way)", () => {
  const main = FFA4_FIXTURES.states.main;

  it("draws a full ring when nobody is out", () => {
    const { container } = ringOf(withSeats(main, {}, 0), "ffa4");
    expect(arcsOf(container)).toEqual([
      { from: 0, to: 1, lit: true },
      { from: 1, to: 2, lit: false },
      { from: 2, to: 3, lit: false },
      { from: 3, to: 0, lit: false },
    ]);
  });

  it("skips an eliminated seat: no arc to or from it, and the lit arc goes 0 to 2", () => {
    const { container } = ringOf(withSeats(main, { 1: { eliminated: true } }, 0), "ffa4");
    expect(arcsOf(container)).toEqual([
      { from: 0, to: 2, lit: true },
      { from: 2, to: 3, lit: false },
      { from: 3, to: 0, lit: false },
    ]);
    const node = container.querySelector("[data-ring-seat='1']")!;
    expect(node.getAttribute("data-status")).toBe("eliminated");
    expect(node.textContent).toContain("OUT");
    expect(container.querySelector("[data-arc='1']")).toBeNull();
  });

  it("lights the arc past a Leaving seat to the next living seat", () => {
    const { container } = ringOf(withSeats(main, { 1: { pendingElimination: true } }, 0), "ffa4");
    expect(arcsOf(container).find((arc) => arc.lit)).toEqual({ from: 0, to: 2, lit: true });
    expect(container.querySelector("[data-ring-seat='1']")?.getAttribute("data-status")).toBe("leaving");
  });

  it("lights the arc past both an eliminated and a Leaving seat", () => {
    const { container } = ringOf(withSeats(main, { 1: { eliminated: true }, 2: { pendingElimination: true } }, 0), "ffa4");
    expect(arcsOf(container).find((arc) => arc.lit)).toEqual({ from: 0, to: 3, lit: true });
  });

  it("a Leaving turn seat reads Leaving, never the turn marker, and its lit arc goes to the next living seat", () => {
    const { container } = ringOf(withSeats(main, { 0: { pendingElimination: true } }, 0), "ffa4");
    const node = container.querySelector("[data-ring-seat='0']")!;
    expect(node.getAttribute("data-status")).toBe("leaving");
    expect(node.textContent).toContain("LEAVING");
    expect(node.textContent).not.toContain("TURN");
    expect(arcsOf(container).find((arc) => arc.lit)).toEqual({ from: 0, to: 1, lit: true });
  });

  it("marks the next living seat as NEXT, not a Leaving or eliminated one", () => {
    const { container } = ringOf(withSeats(main, { 1: { eliminated: true }, 2: { pendingElimination: true } }, 0), "ffa4");
    expect(container.querySelector("[data-ring-seat='3']")?.getAttribute("data-status")).toBe("next");
  });

  it("draws no arcs when one seat is left", () => {
    const { container } = ringOf(withSeats(main, { 1: { eliminated: true }, 2: { eliminated: true }, 3: { eliminated: true } }, 0), "ffa4");
    expect(arcsOf(container)).toEqual([]);
  });
});

describe("TurnRing with seats out (3-way)", () => {
  it("skips the eliminated seat and keeps the two living seats joined", () => {
    const { container } = ringOf(withSeats(FFA3_FIXTURES.states.main, { 1: { eliminated: true } }, 0), "ffa3");
    expect(arcsOf(container)).toEqual([
      { from: 0, to: 2, lit: true },
      { from: 2, to: 0, lit: false },
    ]);
  });
});

describe("nextLivingSeat", () => {
  const seats = [{ seat: 0, lp: 1 }, { seat: 1, lp: 1, pendingElimination: true }, { seat: 2, lp: 1, eliminated: true }, { seat: 3, lp: 1 }];
  it("skips eliminated and Leaving seats", () => {
    expect(nextLivingSeat(seats, 0)).toBe(3);
    expect(nextLivingSeat(seats, 3)).toBe(0);
  });
  it("works from a seat that is out itself", () => {
    expect(nextLivingSeat(seats, 1)).toBe(3);
  });
  it("is null when nobody else is living", () => {
    expect(nextLivingSeat([{ seat: 0, lp: 1 }, { seat: 1, lp: 1, eliminated: true }], 0)).toBeNull();
  });
});

describe("targets with an open chain (4-way)", () => {
  const chain = FFA4_FIXTURES.states["chain-2"];
  const attack = FFA4_FIXTURES.states["battle-aim"].room.engine!.prompt!;
  it("keeps a Leaving seat as a target and never offers an eliminated one", () => {
    const engine = withSeats(chain, { 2: { pendingElimination: true }, 3: { eliminated: true } }, 0);
    expect(engine.chain.length).toBeGreaterThan(0);
    const seats = targetChoices(attack, engine, 0).map((choice) => choice.seat);
    expect(seats).toContain(2);
    expect(seats).not.toContain(3);
  });
});

describe("TableShell with a Leaving turn seat", () => {
  function Shell({ state }: { state: TableFixtureState }) {
    const controller = useFixtureController(state, { reducedMotion: true });
    return <TableShell controller={controller} />;
  }

  // The seat strip's own text ("To play" on a Leaving seat) is fixed and tested with seat-strip.tsx (seat-rules).
  it("shows Leaving on the turn seat and no 'To play' in the header or the ring (3-way, open chain)", () => {
    const base = FFA3_FIXTURES.states["chain-2"];
    const engine = withSeats(base, { 1: { pendingElimination: true } }, 1);
    const state: TableFixtureState = { ...base, room: { ...base.room, engine } };
    const { container } = render(<Shell state={state} />);
    expect(container.querySelector("[data-testid='who-pill']")?.textContent).not.toContain("To play");
    expect(container.querySelector("[data-turn-ring]")?.textContent).not.toContain("To play");
    const node = container.querySelector("[data-ring-seat='1']")!;
    expect(node.getAttribute("data-status")).toBe("leaving");
    expect(node.textContent).toContain("LEAVING");
  });
});
