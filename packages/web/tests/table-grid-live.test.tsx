// @vitest-environment jsdom
import React from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next/font/google", () => {
  const font = () => ({ variable: "font-var", className: "font-class" });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});

import { FFA4_FIXTURES } from "@/components/duel/table/fixtures/ffa4";
import type { TableFixtureState } from "@/components/duel/table/fixtures/common";
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
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function Shell({ state }: { state: TableFixtureState }) {
  const controller = useFixtureController(state, { reducedMotion: true });
  return <TableShell controller={controller} />;
}

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

const main = FFA4_FIXTURES.states.main;
const nameOf = (seat: number) => ["Aster", "Rook", "Juniper", "Mirelle"][seat];
const liveOf = (container: HTMLElement) => container.querySelector("[data-testid='table-live']");

// The 4-way HUD hides the out notes from the eye and draws the finale caption only: the one live region says both.
describe("the 4-way grid live region", () => {
  it("says a rival who leaves while you watch, with the place", () => {
    const { container, rerender } = render(<Shell state={main} />);
    const live = liveOf(container);
    expect(live?.textContent).toBe("");
    rerender(<Shell state={withOut(main, [3])} />);
    expect(liveOf(container)).toBe(live);
    expect(live?.textContent).toBe(`${nameOf(3)} is out, 4th.`);
  });

  it("says the last two when the final duel begins, and the caption itself is not read twice", () => {
    vi.useFakeTimers();
    const { container, rerender } = render(<Shell state={withOut(main, [3])} />);
    rerender(<Shell state={withOut(main, [3, 2])} />);
    act(() => {
      vi.runOnlyPendingTimers();
    });
    const caption = container.querySelector("[data-testid='grid-caption']");
    expect(caption?.getAttribute("aria-hidden")).toBe("true");
    expect(caption?.getAttribute("role")).toBeNull();
    expect(liveOf(container)?.textContent).toBe(`${nameOf(2)} is out, 3rd. Final duel: ${nameOf(0)} vs ${nameOf(1)}.`);
  });

  it("says nothing for a seat that was already out when the table opened", () => {
    const { container } = render(<Shell state={withOut(main, [3])} />);
    expect(liveOf(container)?.textContent).toBe("");
  });
});
