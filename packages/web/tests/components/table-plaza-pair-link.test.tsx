// @vitest-environment jsdom
import React from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next/font/google", () => {
  const font = () => ({ variable: "font-var", className: "font-class" });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});

import { FFA3_FIXTURES, ffa3Variant } from "@/components/duel/table/fixtures/ffa3";
import { TABLE_CARDS as C, type TableFixtureState } from "@/components/duel/table/fixtures/common";
import { useFixtureController } from "@/components/duel/table/fixtures/use-fixture-controller";
import { TableShell } from "@/components/duel/table/table-shell";

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

function Shell({ state }: { state: TableFixtureState }) {
  const controller = useFixtureController(state, { reducedMotion: true });
  return <TableShell controller={controller} />;
}

const paired = ffa3Variant(FFA3_FIXTURES, { out: [], pair: true });
const asSeat = (state: TableFixtureState, seat: number): TableFixtureState => ({ ...state, room: { ...state.room, mySeat: seat } }) as TableFixtureState;

describe("the 3-way plaza links the facing pair 0 and 1", () => {
  it("keeps the plaza (no grid) and draws one link between seats 0 and 1 for the viewer, a rival and a spectator", () => {
    for (const state of [paired.states.main, asSeat(paired.states.main, 2), paired.states.spectator]) {
      const { container, unmount } = render(<Shell state={state} />);
      expect(container.querySelector("[data-grid-stage]")).toBeNull();
      expect(container.querySelectorAll("[data-pair-link]")).toHaveLength(1);
      expect(container.querySelector("[data-pair-link]")!.getAttribute("data-pair-link")).toBe("0-1");
      // Both Extra Monster Zones of the two seats say they are linked; seat 2 shares nothing.
      expect(container.querySelectorAll('[data-testid="seat-field-0"] [data-link]')).toHaveLength(2);
      expect(container.querySelectorAll('[data-testid="seat-field-1"] [data-link]')).toHaveLength(2);
      expect(container.querySelectorAll('[data-testid="seat-field-2"] [data-link]')).toHaveLength(0);
      unmount();
    }
  });

  it("shows no link on an older core without sharedExtraWith, or when one seat of the pair is out", () => {
    const plain = render(<Shell state={FFA3_FIXTURES.states.main} />);
    expect(plain.container.querySelector("[data-pair-link]")).toBeNull();
    expect(plain.container.querySelector("[data-link]")).toBeNull();
    plain.unmount();
    const out = ffa3Variant(FFA3_FIXTURES, { out: [1], pair: true });
    const dead = render(<Shell state={out.states.main} />);
    expect(dead.container.querySelector("[data-pair-link]")).toBeNull();
    expect(dead.container.querySelector("[data-link]")).toBeNull();
  });

  it("shows a monster of seat 0 in the shared zone as a taken ghost on the mirrored zone of seat 1", () => {
    // The fixture already holds Jinzo in zone 5 of seat 0.
    const state = paired.states.main;
    expect(state.room.engine!.seats[0].monsters[5]?.name).toBe(C.jinzo.name);
    const { container } = render(<Shell state={state} />);
    // Zone 5 of seat 0 is zone 6 of seat 1: seat 0 owns the card, seat 1 sees the zone taken.
    const own = container.querySelector('[data-testid="seat-field-0"] [data-link-seq="5"]')!;
    const taken = container.querySelector('[data-testid="seat-field-1"] [data-link-seq="6"]')!;
    expect(own.getAttribute("data-link")).toBe("shared");
    expect(taken.getAttribute("data-link")).toBe("taken");
    expect(taken.getAttribute("data-zones")).toBe("");
    expect(taken.querySelector("button")?.getAttribute("aria-label") ?? taken.textContent).toMatch(/shared with|taken/i);
    // The other zone of seat 1 stays free.
    expect(container.querySelector('[data-testid="seat-field-1"] [data-link-seq="5"]')!.getAttribute("data-link")).toBe("shared");
  });
});
