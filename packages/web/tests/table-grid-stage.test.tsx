// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next/font/google", () => {
  const font = () => ({ variable: "font-var", className: "font-class" });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});

import { FFA4_FIXTURES } from "@/components/duel/table/fixtures/ffa4";
import { useFixtureController } from "@/components/duel/table/fixtures/use-fixture-controller";
import { OUT_HOLD_MS } from "@/components/duel/table/grid-layout";
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

function Shell({ id }: { id: keyof typeof FFA4_FIXTURES.states }) {
  const controller = useFixtureController(FFA4_FIXTURES.states[id], { reducedMotion: true });
  return <TableShell controller={controller} />;
}

const cellOf = (container: HTMLElement, seat: number) => container.querySelector<HTMLElement>(`[data-grid-cell="${seat}"]`)!;

describe("GridStage", () => {
  it("places the four cells by seat, viewer bottom-left (Aster is seat 0)", () => {
    const { container } = render(<Shell id="main" />);
    const quadrants = [0, 1, 2, 3].map((seat) => cellOf(container, seat).getAttribute("data-quadrant"));
    expect(quadrants).toEqual(["bl", "tl", "tr", "br"]);
    expect(container.querySelector("[data-grid-stage]")?.getAttribute("data-table-stage")).toBe("ffa4");
  });

  it("turns the top fields 180 degrees and leaves the bottom fields upright", () => {
    const { container } = render(<Shell id="main" />);
    const angle = (seat: number) => cellOf(container, seat).querySelector("[data-seat-slot]")?.getAttribute("style") ?? "";
    for (const seat of [1, 2]) expect(angle(seat)).toMatch(/rotate\(180deg\)/);
    for (const seat of [0, 3]) expect(angle(seat)).not.toMatch(/rotate\(180deg\)/);
  });

  it("shows the viewer hand face up and the rival hands as backs", () => {
    const { container } = render(<Shell id="main" />);
    const mine = container.querySelector('[data-hand-seat="0"]')!;
    expect(mine.getAttribute("data-side")).toBe("you");
    for (const seat of [1, 2, 3]) {
      const hand = container.querySelector(`[data-hand-seat="${seat}"]`)!;
      expect(hand.getAttribute("data-side")).toBe("opp");
      expect(cellOf(container, seat).contains(hand)).toBe(true);
    }
  });

  it("marks the column partner (seat + 2, the diagonal) and draws the link", () => {
    const { container } = render(<Shell id="main" />);
    expect(cellOf(container, 2).getAttribute("data-partner")).toBe("true");
    expect(cellOf(container, 1).getAttribute("data-partner")).toBeNull();
    expect(cellOf(container, 3).getAttribute("data-partner")).toBeNull();
    expect(container.querySelector('[data-column-link="2"]')).not.toBeNull();
  });

  it("draws no partner mark for a spectator", () => {
    const { container } = render(<Shell id="spectator" />);
    expect(container.querySelector("[data-column-link]")).toBeNull();
    expect(container.querySelector('[data-grid-cell][data-partner="true"]')).toBeNull();
    expect(cellOf(container, 0).getAttribute("data-quadrant")).toBe("bl");
  });

  it("lights legal zones on a rival field, on the rival field's own cell, and they stay clickable", () => {
    const { container } = render(<Shell id="target-pick" />);
    const legal = [...container.querySelectorAll<HTMLElement>('[data-zones][data-legal="true"]')];
    expect(legal.length).toBeGreaterThan(0);
    const inRival = legal.filter((zone) => [1, 2, 3].some((seat) => cellOf(container, seat).contains(zone)));
    expect(inRival.length).toBeGreaterThan(0);
    for (const zone of inRival) {
      const hit = zone.querySelector<HTMLButtonElement>("button");
      expect(hit).not.toBeNull();
      expect(hit!.disabled).toBe(false);
      expect(cellOf(container, Number(zone.closest("[data-seat-field]")?.getAttribute("data-seat-field"))).getAttribute("data-cell-state")).toBe("live");
    }
    const target = inRival[0].querySelector<HTMLButtonElement>("button")!;
    act(() => {
      fireEvent.click(target);
    });
    expect(container.querySelector('[data-zones][data-selected="true"]')).not.toBeNull();
  });

  it("leaves the other cells where they are when a seat is out, and keeps its LP panel", () => {
    const main = render(<Shell id="main" />).container;
    const before = [0, 1, 2, 3].map((seat) => cellOf(main, seat).getAttribute("data-quadrant"));
    cleanup();
    const { container } = render(<Shell id="elimination" />);
    expect([0, 1, 2, 3].map((seat) => cellOf(container, seat).getAttribute("data-quadrant"))).toEqual(before);
    expect(cellOf(container, 2).getAttribute("data-cell-state")).toBe("empty");
    expect(container.querySelectorAll("[data-seat-field]")).toHaveLength(3);
    expect(container.querySelector("[data-lp-seat='2']")).not.toBeNull();
  });

  it("drops the partner mark once the partner is out", () => {
    const { container } = render(<Shell id="elimination" />);
    // Juniper (seat 2) is the column partner of Aster and is the one leaving in this state.
    expect(container.querySelector("[data-column-link]")).toBeNull();
    expect(container.querySelector('[data-grid-cell][data-partner="true"]')).toBeNull();
  });

  it("opens an already-out seat as an empty, untargetable cell; the other cells stay put", () => {
    const { container } = render(<Shell id="result" />);
    for (const seat of [1, 2, 3]) {
      const cell = cellOf(container, seat);
      expect(cell.getAttribute("data-cell-state")).toBe("empty");
      expect(cell.querySelector("[data-seat-field]")).toBeNull();
      expect(cell.querySelector("[data-zones]")).toBeNull();
    }
    expect(cellOf(container, 0).getAttribute("data-cell-state")).toBe("live");
    expect(cellOf(container, 0).getAttribute("data-quadrant")).toBe("bl");
    expect(OUT_HOLD_MS).toBeGreaterThan(0);
  });
});
