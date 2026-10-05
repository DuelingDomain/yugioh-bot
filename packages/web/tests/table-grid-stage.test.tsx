// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, renderHook } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next/font/google", () => {
  const font = () => ({ variable: "font-var", className: "font-class" });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});

// disabledZones runs once per draw of a seat field: a count of its calls is a count of draws.
vi.mock("@/components/duel/multi-seat", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/components/duel/multi-seat")>();
  return { ...real, disabledZones: vi.fn(real.disabledZones) };
});

import { disabledZones } from "@/components/duel/multi-seat";
import { FFA4_FIXTURES, ffa4Variant } from "@/components/duel/table/fixtures/ffa4";
import { useFixtureController } from "@/components/duel/table/fixtures/use-fixture-controller";
import { OUT_HOLD_MS } from "@/components/duel/table/grid-layout";
import { pairFrameRect, useCellStates } from "@/components/duel/table/grid-stage";
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

function Shell({ id, out = [] }: { id: keyof typeof FFA4_FIXTURES.states; out?: number[] }) {
  const set = out.length > 0 ? ffa4Variant(FFA4_FIXTURES, { out }) : FFA4_FIXTURES;
  const controller = useFixtureController(set.states[id], { reducedMotion: true });
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
    for (const seat of [1, 2]) expect(angle(seat)).toMatch(/rotate: 180deg/);
    for (const seat of [0, 3]) expect(angle(seat)).not.toMatch(/rotate: 180deg/);
    for (const seat of [0, 1, 2, 3]) expect(angle(seat)).not.toMatch(/transform/);
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

  it("pairs the facing seats (0+1, 2+3) and draws ONE shared Extra Monster row per column", () => {
    const { container } = render(<Shell id="main" />);
    expect(cellOf(container, 0).getAttribute("data-partner")).toBe("1");
    const fieldOf = (seat: number) => cellOf(container, seat).querySelector("[data-seat-field]")!;
    expect(fieldOf(0).getAttribute("data-emz")).toBe("pair");
    expect(fieldOf(3).getAttribute("data-emz")).toBe("pair");
    expect(fieldOf(1).getAttribute("data-emz")).toBe("none");
    expect(fieldOf(2).getAttribute("data-emz")).toBe("none");
    const keys = [...fieldOf(0).querySelectorAll("[data-zones]")].map((node) => node.getAttribute("data-zones") ?? "");
    expect(keys.some((key) => key.includes("0:4:5") && key.includes("1:4:6"))).toBe(true);
    expect(keys.some((key) => key.includes("0:4:6") && key.includes("1:4:5"))).toBe(true);
    expect(container.querySelector("[data-column-link]")).toBeNull();
  });

  it("puts a life box for every seat in the middle bands, mine first on the left", () => {
    const { container } = render(<Shell id="main" />);
    const lps = [0, 1, 2, 3].map((seat) => container.querySelector(`[data-grid-lp="${seat}"]`));
    expect(lps.every((node) => node != null)).toBe(true);
  });

  it("anchors a spectator on seat 0 at bottom-left", () => {
    const { container } = render(<Shell id="spectator" />);
    expect(cellOf(container, 0).getAttribute("data-quadrant")).toBe("bl");
    expect(container.querySelector("[data-column-link]")).toBeNull();
  });

  it("starts with my field in focus; keys 1-4 focus a field, O and Esc show all fields, a click on a field focuses it", () => {
    const { container } = render(<Shell id="main" />);
    const stage = container.querySelector("[data-grid-stage]")!;
    const press = (key: string) => act(() => void fireEvent.keyDown(window, { key }));
    expect(stage.getAttribute("data-grid-focus")).toBe("0");
    press("3");
    expect(stage.getAttribute("data-grid-focus")).toBe("2");
    press("o");
    expect(stage.getAttribute("data-grid-focus")).toBe("all");
    press("2");
    expect(stage.getAttribute("data-grid-focus")).toBe("1");
    press("Escape");
    expect(stage.getAttribute("data-grid-focus")).toBe("all");
    act(() => {
      fireEvent.click(cellOf(container, 3).querySelector("[data-seat-field]")!);
    });
    expect(stage.getAttribute("data-grid-focus")).toBe("3");
    act(() => {
      fireEvent.click(container.querySelector('[data-testid="grid-all"]')!);
    });
    expect(stage.getAttribute("data-grid-focus")).toBe("all");
    // the old zoom keys and buttons are gone
    expect(container.querySelector('[data-testid="grid-zoom-in"]')).toBeNull();
    expect(container.querySelector('[data-testid="grid-zoom-out"]')).toBeNull();
    press("+");
    press("-");
    expect(stage.getAttribute("data-grid-focus")).toBe("all");
    // keys with a modifier or in a text field are ignored
    act(() => void fireEvent.keyDown(window, { key: "2", ctrlKey: true }));
    expect(stage.getAttribute("data-grid-focus")).toBe("all");
  });

  it("keeps the digit keys and Esc away from the focus during an attack aim", () => {
    const { container } = render(<Shell id="battle-aim" />);
    const stage = container.querySelector("[data-grid-stage]")!;
    expect(stage.getAttribute("data-grid-focus")).toBe("0");
    for (const key of ["2", "3", "4"]) act(() => void fireEvent.keyDown(window, { key }));
    act(() => void fireEvent.keyDown(window, { key: "Escape" }));
    expect(stage.getAttribute("data-grid-focus")).toBe("0");
  });

  it("sizes the fields from one layout: the focused pair is lifted as a pair, the other pair a little smaller, no transform at rest", () => {
    const { container } = render(<Shell id="main" />);
    const stage = container.querySelector("[data-grid-stage]")!;
    const z = (seat: number) => parseFloat(cellOf(container, seat).querySelector<HTMLElement>("[data-seat-slot]")!.style.getPropertyValue("--sf-z"));
    expect(z(0)).toBeGreaterThan(z(3));
    expect(z(1)).toBeCloseTo(z(0), 1);
    expect(z(3)).toBeLessThan(z(0));
    expect(z(3)).toBeCloseTo(z(2), 1);
    act(() => void fireEvent.keyDown(window, { key: "o" }));
    expect(stage.getAttribute("data-grid-focus")).toBe("all");
    expect(new Set([0, 1, 2, 3].map(z)).size).toBe(1);
    act(() => void fireEvent.keyDown(window, { key: "2" }));
    expect(z(1)).toBeCloseTo(z(0), 1);
    expect(z(1)).toBeGreaterThanOrEqual(z(2));
    for (const seat of [0, 1, 2, 3]) expect(cellOf(container, seat).querySelector<HTMLElement>("[data-seat-slot]")!.style.transform).toBe("");
  });

  it("gives only my field its box x, so the CSS can keep my seat name right of the Deck Master plate", () => {
    const { container } = render(<Shell id="main" />);
    const slot = (seat: number) => cellOf(container, seat).querySelector<HTMLElement>("[data-seat-slot]")!;
    for (const key of ["1", "2", "3", "4", "o"]) {
      act(() => void fireEvent.keyDown(window, { key }));
      expect(slot(0).style.getPropertyValue("--sf-box-x")).toBe(slot(0).style.left);
      for (const seat of [1, 2, 3]) expect(slot(seat).style.getPropertyValue("--sf-box-x")).toBe("");
    }
  });

  it("tells a screen reader the focus: pressed pills with their key, a polite Focus line, labelled cells", () => {
    const { container } = render(<Shell id="main" />);
    const live = container.querySelector("[data-grid-live]")!;
    expect(live.getAttribute("aria-live")).toBe("polite");
    expect(live.textContent).toMatch(/^Focus: .+/);
    expect(live.textContent).not.toMatch(/all fields/);
    const pill = (seat: number) => container.querySelector(`[data-testid="seat-strip-${seat}"] button`) as HTMLElement;
    expect(pill(1).getAttribute("aria-keyshortcuts")).toBe("2");
    expect(pill(0).getAttribute("aria-pressed")).toBe("true");
    expect(pill(1).getAttribute("aria-pressed")).toBe("false");
    act(() => void fireEvent.keyDown(window, { key: "2" }));
    expect(pill(1).getAttribute("aria-pressed")).toBe("true");
    expect(pill(0).getAttribute("aria-pressed")).toBe("false");
    const name = live.textContent!.replace("Focus: ", "");
    expect(pill(1).getAttribute("aria-label")).toContain(name);
    act(() => void fireEvent.keyDown(window, { key: "o" }));
    expect(live.textContent).toBe("Focus: all fields");
    const cells = [...container.querySelectorAll("[data-grid-cell]")];
    expect(cells.length).toBe(4);
    for (const cell of cells) expect(cell.getAttribute("aria-label")).toMatch(/, field/);
  });

  it("does not draw a seat field again for a change of focus (the focus only moves boxes)", () => {
    const { container } = render(<Shell id="main" />);
    const stage = container.querySelector("[data-grid-stage]")!;
    const draws = vi.mocked(disabledZones);
    draws.mockClear();
    for (const key of ["2", "3", "o", "4", "1"]) act(() => void fireEvent.keyDown(window, { key }));
    expect(stage.getAttribute("data-grid-focus")).toBe("0");
    expect(draws).toHaveBeenCalledTimes(0);
  });

  it("keeps the shared Extra Monster row on the same field when the focus moves, so its zone nodes stay mounted", () => {
    const { container } = render(<Shell id="main" />);
    const emz = (seat: number) => cellOf(container, seat).querySelector("[data-seat-field]")!.getAttribute("data-emz");
    const zone = container.querySelector('[data-zones*="0:4:5"]');
    expect(zone).not.toBeNull();
    for (const key of ["2", "1", "3", "4", "o", "2"]) {
      act(() => void fireEvent.keyDown(window, { key }));
      expect([emz(0), emz(1), emz(2), emz(3)]).toEqual(["pair", "none", "none", "pair"]);
    }
    expect(container.querySelector('[data-zones*="0:4:5"]')).toBe(zone);
  });

  it("marks the small fields and fits the life panels into their boxes", () => {
    const { container } = render(<Shell id="main" />);
    const slot = (seat: number) => cellOf(container, seat).querySelector<HTMLElement>("[data-seat-slot]")!;
    expect(slot(0).getAttribute("data-small")).toBeNull();
    expect(slot(3).getAttribute("data-small")).toBe("true");
    const lp = container.querySelector<HTMLElement>('[data-grid-lp="0"]')!;
    expect(lp.style.width).not.toBe("");
    expect(lp.querySelector('[data-fit="true"]')).not.toBeNull();
    expect(lp.querySelectorAll("[data-holo-text]").length).toBeGreaterThan(0);
  });

  it("zooms with the turn strip, and a click on a zone does not zoom", () => {
    const { container } = render(<Shell id="main" />);
    const stage = container.querySelector("[data-grid-stage]")!;
    const strip = container.querySelector('[aria-label="Show Mirelle on the main field"]');
    expect(strip).not.toBeNull();
    act(() => {
      fireEvent.click(strip!);
    });
    expect(stage.getAttribute("data-grid-focus")).toBe("3");
    act(() => {
      fireEvent.click(container.querySelector('[data-grid-lp="1"]')!);
    });
    expect(stage.getAttribute("data-grid-focus")).toBe("1");
    act(() => {
      const zone = cellOf(container, 2).querySelector<HTMLElement>("[data-zones] button");
      if (zone) fireEvent.click(zone);
    });
    expect(stage.getAttribute("data-grid-focus")).toBe("1");
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

  it("hands the shared row to the top field when the bottom cell is empty, and falls back to my zoom when a focused seat goes", () => {
    const { container } = render(<Shell id="result" />);
    const field = cellOf(container, 0).querySelector("[data-seat-field]")!;
    expect(field.getAttribute("data-emz")).toBe("pair");
    expect(field.hasAttribute("data-joined")).toBe(false);
    expect(container.querySelector("[data-grid-stage]")!.getAttribute("data-grid-focus")).toBe("0");
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

describe("pair frames and the finale board", () => {
  const frameOf = (container: HTMLElement, column: number) => container.querySelector<HTMLElement>(`[data-pair-frame="${column}"]`)!;
  const fieldOf = (container: HTMLElement, seat: number) => cellOf(container, seat).querySelector<HTMLElement>("[data-seat-field]")!;
  const turnOf = (container: HTMLElement, seat: number) => cellOf(container, seat).querySelector("[data-seat-slot]")?.getAttribute("style") ?? "";
  // A pair with no live field has no frame; one that fades out of the finale is marked gone.
  const frameHidden = (container: HTMLElement, column: number) => {
    const frame = container.querySelector(`[data-pair-frame="${column}"]`);
    return frame == null || frame.getAttribute("data-gone") === "true";
  };

  it("bounds the live fields of a pair as one rect", () => {
    expect(pairFrameRect([])).toBeNull();
    expect(pairFrameRect([{ x: 10, y: 20, width: 100, height: 50 }, { x: 10, y: 60, width: 100, height: 50 }])).toEqual({ x: 10, y: 20, width: 100, height: 90 });
  });

  it("draws ONE frame round each facing pair (the fields drop their own mats) and marks the lifted pair", () => {
    const { container } = render(<Shell id="main" />);
    expect(container.querySelectorAll("[data-pair-frame]")).toHaveLength(2);
    expect(frameOf(container, 0).getAttribute("data-focus")).toBe("true");
    expect(frameOf(container, 1).hasAttribute("data-focus")).toBe(false);
    for (const seat of [0, 1, 2, 3]) expect(fieldOf(container, seat).getAttribute("data-framed")).toBe("true");
    expect(container.querySelector("[data-grid-finale]")).toBeNull();
  });

  it("keeps the pair frame round the survivor alone, with its shared row, when its facing seat is out", () => {
    const { container } = render(<Shell id="main" out={[2]} />);
    expect(cellOf(container, 2).getAttribute("data-cell-state")).toBe("empty");
    expect(fieldOf(container, 3).getAttribute("data-emz")).toBe("pair");
    expect(frameOf(container, 1).hasAttribute("data-gone")).toBe(false);
    expect(container.querySelector("[data-grid-finale]")).toBeNull();
  });

  it("lays two seats of one pair out as the 1v1 board: my field upright, the other turned, the other pair gone", () => {
    const { container } = render(<Shell id="main" out={[2, 3]} />);
    expect(container.querySelector("[data-grid-stage]")!.getAttribute("data-grid-finale")).toBe("same");
    expect(turnOf(container, 0)).not.toMatch(/rotate: 180deg/);
    expect(turnOf(container, 1)).toMatch(/rotate: 180deg/);
    expect(fieldOf(container, 0).getAttribute("data-emz")).toBe("pair");
    expect(frameHidden(container, 1)).toBe(true);
    for (const seat of [2, 3]) expect(container.querySelector(`[data-grid-lp='${seat}']`)?.getAttribute("data-gone")).toBe("true");
    for (const seat of [0, 1]) expect(container.querySelector(`[data-grid-lp='${seat}']`)?.getAttribute("data-lp-side")).toBe("left");
  });

  it("lays two seats of different pairs out face to face, each with its own Extra Monster row, the other on top", () => {
    const { container } = render(<Shell id="main" out={[1, 2]} />);
    expect(container.querySelector("[data-grid-stage]")!.getAttribute("data-grid-finale")).toBe("cross");
    expect(turnOf(container, 0)).not.toMatch(/rotate: 180deg/);
    expect(turnOf(container, 3)).toMatch(/rotate: 180deg/);
    // "own": a normal single field (no shared row, no hidden row), so no data-emz mark at all.
    for (const seat of [0, 3]) expect(fieldOf(container, seat).hasAttribute("data-emz")).toBe(false);
    expect(frameOf(container, 0).hasAttribute("data-gone")).toBe(false);
    expect(frameHidden(container, 1)).toBe(true);
  });
});

describe("useCellStates", () => {
  const seatsWith = (out: number[]) => [0, 1, 2, 3].map((seat) => ({ seat, eliminated: out.includes(seat) }));

  it("empties a second out seat on its own clock, after the first one is already empty", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const { result, rerender } = renderHook(({ out }) => useCellStates(seatsWith(out)), { initialProps: { out: [] as number[] } });
    rerender({ out: [1] });
    expect(result.current.get(1)).toBe("out");
    act(() => {
      vi.advanceTimersByTime(OUT_HOLD_MS + 100);
    });
    expect(result.current.get(1)).toBe("empty");
    rerender({ out: [1, 2] });
    expect(result.current.get(2)).toBe("out");
    expect(result.current.get(1)).toBe("empty");
    act(() => {
      vi.advanceTimersByTime(OUT_HOLD_MS);
    });
    expect(result.current.get(2)).toBe("empty");
    expect(result.current.get(1)).toBe("empty");
    expect(result.current.get(0)).toBe("live");
  });
});
