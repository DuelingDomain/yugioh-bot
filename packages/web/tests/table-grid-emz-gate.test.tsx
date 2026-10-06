// @vitest-environment jsdom
import React from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next/font/google", () => {
  const font = () => ({ variable: "font-var", className: "font-class" });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});

import { FFA4_FIXTURES } from "@/components/duel/table/fixtures/ffa4";
import type { TableFixtureState } from "@/components/duel/table/fixtures/common";
import { useFixtureController } from "@/components/duel/table/fixtures/use-fixture-controller";
import { gridExtraZonesFit, usesGridLayout, type GridSeatLike } from "@/components/duel/table/grid-layout";
import { TableShell } from "@/components/duel/table/table-shell";

// The production core today (P92, capability "ffa4-shared-extra-zones") shares the Extra Monster Zones between ACROSS
// seats (0+2, 1+3). The grid draws one shared row per FACING pair (0+1, 2+3), the layout of the facing core
// ("ffa4-facing-extra-zones"). The duel server reports the core's pairing in `sharedExtraWith`.
type Pairing = "across" | "facing" | "none";
const partnerOf: Record<Pairing, (seat: number) => number | null> = {
  across: (seat) => (seat + 2) % 4,
  facing: (seat) => seat ^ 1,
  none: () => null,
};
/** Seat views as the duel server builds them: a seat out of the duel has no partner, nor does a seat whose partner is out. */
function seatsOf(pairing: Pairing, out: number[] = []): GridSeatLike[] {
  return [0, 1, 2, 3].map((seat) => {
    const partner = partnerOf[pairing](seat);
    const shares = !out.includes(seat) && partner != null && !out.includes(partner);
    return { seat, eliminated: out.includes(seat), sharedExtraWith: shares ? partner : null };
  });
}

describe("the grid needs the facing Extra Monster pairing", () => {
  it("draws the grid for a facing core, also while seats are out", () => {
    for (const out of [[], [1], [2], [1, 2], [0, 1], [1, 3]]) {
      expect(gridExtraZonesFit(seatsOf("facing", out))).toBe(true);
      expect(usesGridLayout("ffa4", seatsOf("facing", out))).toBe(true);
    }
  });

  it("refuses the grid for the across core (P92) and for a core with no shared zones", () => {
    for (const out of [[], [1], [2], [0, 1], [1, 3]]) {
      expect(usesGridLayout("ffa4", seatsOf("across", out))).toBe(false);
    }
    expect(usesGridLayout("ffa4", seatsOf("none"))).toBe(false);
    expect(usesGridLayout("ffa4", seatsOf("none", [3]))).toBe(false);
  });

  it("cannot tell the cores apart when the last two seats come from different pairs (they share nothing in either)", () => {
    expect(usesGridLayout("ffa4", seatsOf("across", [1, 2]))).toBe(true);
    expect(usesGridLayout("ffa4", seatsOf("facing", [1, 2]))).toBe(true);
  });

  it("does not count a seat view without sharedExtraWith (fixtures, older views)", () => {
    const seats = [0, 1, 2, 3].map((seat) => ({ seat }));
    expect(usesGridLayout("ffa4", seats)).toBe(true);
    expect(usesGridLayout("ffa3", seats.slice(0, 3))).toBe(false);
  });
});

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
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function Shell({ state }: { state: TableFixtureState }) {
  return <TableShell controller={useFixtureController(state, { reducedMotion: true })} />;
}

function stateWith(pairing: Pairing, out: number[] = []): TableFixtureState {
  const state = structuredClone(FFA4_FIXTURES.states.main);
  const views = seatsOf(pairing, out);
  for (const seat of state.room.engine!.seats) Object.assign(seat, views[seat.seat]);
  return state;
}

const gridShown = (container: HTMLElement) => container.querySelector("[data-grid='true']") != null;
const hudShown = (container: HTMLElement) => container.querySelector("[data-hud='true']") != null;

describe("the table shell picks the stage from the engine's Extra Monster pairing", () => {
  it("shows the grid and its HUD for a facing core", () => {
    const { container } = render(<Shell state={stateWith("facing")} />);
    expect(gridShown(container)).toBe(true);
    expect(hudShown(container)).toBe(true);
  });

  it("keeps the plaza stage for the across core (P92)", () => {
    const { container } = render(<Shell state={stateWith("across")} />);
    expect(gridShown(container)).toBe(false);
    expect(hudShown(container)).toBe(false);
  });

  it("keeps the plaza stage for the rest of the duel once the core showed the across pairing", () => {
    const { container, rerender } = render(<Shell state={stateWith("across")} />);
    expect(gridShown(container)).toBe(false);
    // Seats 1 and 2 go out: the last two (0 and 3) share nothing, so their views alone would allow the grid.
    rerender(<Shell state={stateWith("across", [1, 2])} />);
    expect(gridShown(container)).toBe(false);
    expect(hudShown(container)).toBe(false);
  });
});
