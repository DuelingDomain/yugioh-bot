// @vitest-environment jsdom
import React from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/font/google", () => {
  const font = () => ({ variable: "font-var", className: "font-class" });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});

import { FFA3_FIXTURES, ffa3Variant } from "@/components/duel/table/fixtures/ffa3";
import type { TableFixtureState } from "@/components/duel/table/fixtures/common";
import { useFixtureController } from "@/components/duel/table/fixtures/use-fixture-controller";
import { TableShell } from "@/components/duel/table/table-shell";
import { clearLpMotion } from "@/components/duel/lp-motion";
import { GLIDE_MS } from "@/components/duel/table/use-seat-exits";
import { LP_TIMING } from "@/components/duel/duel-timing";
import { CRUMBLE_GATE_TICK_MS } from "@/components/duel/table/crumble-gate";

vi.setConfig({ testTimeout: 20_000 });

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

function Shell({ state, reducedMotion = false }: { state: TableFixtureState; reducedMotion?: boolean }) {
  const controller = useFixtureController(state, { reducedMotion });
  return <TableShell controller={controller} />;
}

/** The 3-way fixture with the engine's pair contract (seats 0 and 1 share one Extra Monster row) and `out` seats swept. */
const variant = (out: readonly number[]) => ffa3Variant(FFA3_FIXTURES, { out, pair: true }).states.main;
const settle = (ms: number) => {
  for (let left = ms; left > 0; left -= CRUMBLE_GATE_TICK_MS) act(() => { vi.advanceTimersByTime(Math.min(CRUMBLE_GATE_TICK_MS, left)); });
};
const transformOf = (container: HTMLElement, seat: number) => container.querySelector<HTMLElement>(`[data-seat-slot='${seat}']`)?.style.transform ?? null;
const linkIds = (container: HTMLElement) => [...container.querySelectorAll("[data-link-id]")].map((node) => node.getAttribute("data-link-id"));

describe("the 3-way face-off keeps the fixed pairs, whoever is left", () => {
  // Each way a 3-way duel ends in two: the survivors are the pair (0, 1), or one seat of the pair and seat 2.
  it.each([
    { out: [2], survivors: [0, 1], linked: true },
    { out: [1], survivors: [0, 2], linked: false },
    { out: [0], survivors: [1, 2], linked: false },
  ])("seats $survivors stand face to face; linked: $linked", ({ out, survivors, linked }) => {
    const { container } = render(<Shell state={variant(out)} />);
    const [a, b] = survivors.map((seat) => transformOf(container, seat));
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(a).not.toEqual(b);
    // The seat that is out has no field slot.
    expect(container.querySelector(`[data-seat-slot='${out[0]}']`)).toBeNull();
    // Two separate fields, each with its own Extra Monster row; a link light only between the pair.
    expect(container.querySelectorAll("[data-seat-slot]").length).toBe(2);
    if (linked) {
      expect(container.querySelector("[data-emz-pair]")?.getAttribute("data-emz-pair")).toBe("0-1");
      expect(linkIds(container).length).toBeGreaterThan(0);
      expect(linkIds(container).every((id) => id?.startsWith("0-1-"))).toBe(true);
    } else {
      expect(container.querySelector("[data-emz-pair]")).toBeNull();
      expect(linkIds(container)).toEqual([]);
    }
  });

  it("glides the survivors of a live duel to the face-off, then lets the glide end", () => {
    const { container, rerender } = render(<Shell state={variant([])} />);
    const before = transformOf(container, 1);
    rerender(<Shell state={variant([2])} />);
    expect(transformOf(container, 1)).not.toEqual(before);
    expect(container.querySelector("[data-plaza]")?.getAttribute("data-glide")).toBe("true");
    settle(LP_TIMING.rollMaxMs + CRUMBLE_GATE_TICK_MS + GLIDE_MS + 200);
    expect(container.querySelector("[data-plaza]")?.hasAttribute("data-glide")).toBe(false);
    expect(transformOf(container, 1)).not.toEqual(before);
  });

  it("opens a table that already has two seats left on the face-off pose with no glide (a reload, a replay seek)", () => {
    const { container } = render(<Shell state={variant([2])} />);
    expect(container.querySelector("[data-plaza]")?.hasAttribute("data-glide")).toBe(false);
    expect(container.querySelector("[data-seat-exit]")).toBeNull();
  });
});
