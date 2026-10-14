// @vitest-environment jsdom
import React from "react";
import { act, cleanup, render, renderHook } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/font/google", () => {
  const font = () => ({ variable: "font-var", className: "font-class" });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});

import { FFA4_FIXTURES, ffa4Variant } from "@/components/duel/table/fixtures/ffa4";
import { useFixtureController } from "@/components/duel/table/fixtures/use-fixture-controller";
import { tableLayout } from "@/components/duel/table/geometry";
import { CAPTION_MS, FINALE_BEAT_MS, useFinalDuel } from "@/components/duel/table/final-duel-caption";
import { FINALE_GLIDE_MS, finaleBoard, type FinaleCell } from "@/components/duel/table/grid-finale";
import { gridCells, gridFocusLayout, gridWorld, type GridFinaleCells, type GridRect } from "@/components/duel/table/grid-layout";
import { EXIT_CRUMBLE_MS } from "@/components/duel/table/rival-field";
import { TableShell } from "@/components/duel/table/table-shell";

// Seat 0 is home (bottom left), 1 faces it (top left); 2 (top right) faces 3 (bottom right).
const cells: FinaleCell[] = [
  { seat: 0, column: 0, row: 1, home: true },
  { seat: 1, column: 0, row: 0, home: false },
  { seat: 2, column: 1, row: 0, home: false },
  { seat: 3, column: 1, row: 1, home: false },
];
const seatsOut = (out: number[]) => [0, 1, 2, 3].map((seat) => ({ seat, eliminated: out.includes(seat) }));
const SURVIVORS = [[0, 1], [2, 3], [0, 2], [0, 3], [1, 2], [1, 3]];

describe("finaleBoard", () => {
  it("is 'same' for two seats of one facing pair and 'cross' for two of different pairs", () => {
    expect(finaleBoard([0, 1], cells)).toEqual({ kind: "same", bottom: 0, top: 1 });
    expect(finaleBoard([2, 3], cells)).toEqual({ kind: "same", bottom: 3, top: 2 });
    expect(finaleBoard([0, 2], cells)).toEqual({ kind: "cross", bottom: 0, top: 2 });
    expect(finaleBoard([1, 3], cells)).toEqual({ kind: "cross", bottom: 3, top: 1 });
  });

  it("puts the home seat at the bottom, even when it sits on the top row", () => {
    const top = cells.map((cell) => ({ ...cell, home: cell.seat === 1 }));
    expect(finaleBoard([1, 3], top)).toEqual({ kind: "cross", bottom: 1, top: 3 });
  });

  it("puts the seat of the home column at the bottom when neither is home and both are on one row", () => {
    expect(finaleBoard([1, 2], cells)).toEqual({ kind: "cross", bottom: 1, top: 2 });
  });

  it("is null for any other number of seats", () => {
    expect(finaleBoard([0, 1, 2], cells)).toBeNull();
    expect(finaleBoard([0], cells)).toBeNull();
    expect(finaleBoard([], cells)).toBeNull();
  });
});

describe("the pose of the face-off (gridFocusLayout)", () => {
  const layoutOf = (viewer: number | null) => tableLayout("ffa4", { format: "ffa4", seats: seatsOut([]) } as never, viewer);
  const poseOf = (viewer: number | null, live: number[], size = { width: 1920, height: 1080 }) => {
    const grid = gridCells(layoutOf(viewer));
    const board = finaleBoard(live, grid)!;
    const at = (seat: number) => grid.find((cell) => cell.seat === seat)!;
    const finale: GridFinaleCells = { bottom: at(board.bottom), top: at(board.top), homeHand: at(board.bottom).home };
    const withFinale = gridFocusLayout(gridWorld(4), size, null, { homeColumn: viewer == null ? 0 : grid.find((cell) => cell.home)!.column, finale });
    const without = gridFocusLayout(gridWorld(4), size, null, { homeColumn: viewer == null ? 0 : grid.find((cell) => cell.home)!.column });
    const spot = (seat: number) => withFinale.cells[cellIdx(grid, seat)];
    return { board, withFinale, without, spot };
  };
  const cellIdx = (grid: ReturnType<typeof gridCells>, seat: number) => {
    const cell = grid.find((entry) => entry.seat === seat)!;
    return cell.column * 2 + cell.row;
  };
  const inside = (outer: GridRect, box: GridRect) => box.x >= outer.x - 0.5 && box.y >= outer.y - 0.5 && box.x + box.width <= outer.x + outer.width + 0.5 && box.y + box.height <= outer.y + outer.height + 0.5;

  for (const size of [{ width: 1920, height: 1080 }, { width: 1366, height: 768 }]) {
    for (const viewer of [0, 1, 2, 3, null]) {
      for (const live of SURVIVORS) {
        it(`seats ${live.join("+")} face each other in the middle, whole and inside the stage (viewer ${viewer ?? "spectator"}, ${size.width}x${size.height})`, () => {
          const pose = poseOf(viewer, live, size);
          const bottom = pose.spot(pose.board.bottom);
          const top = pose.spot(pose.board.top);
          // The bottom field is upright, the top one turned; both are as wide as each other and on one axis.
          expect(bottom.turn).toBe(0);
          expect(top.turn).toBe(180);
          expect(bottom.rect.width).toBeCloseTo(top.rect.width, 1);
          expect(bottom.rect.x).toBeCloseTo(top.rect.x, 1);
          // The top field lies above the bottom one; they overlap by their pads only (two fields, not one merged field).
          expect(top.rect.y + top.rect.height).toBeGreaterThan(bottom.rect.y);
          expect(top.rect.y + top.rect.height - bottom.rect.y).toBeLessThan(0.2 * bottom.z * 10);
          expect(top.rect.y).toBeLessThan(bottom.rect.y);
          // Centred across the stage, the plates at the left of the board.
          expect(bottom.rect.x + bottom.rect.width / 2).toBeCloseTo(size.width / 2, 0);
          expect(bottom.plate.x + bottom.plate.width).toBeLessThan(bottom.rect.x);
          expect(top.plate.x + top.plate.width).toBeLessThan(top.rect.x);
          // Inside the stage, at full size (never smaller than 40 percent of the table at rest).
          const stage = { x: 0, y: 0, width: size.width, height: size.height };
          for (const spot of [bottom, top]) {
            expect(inside(stage, spot.rect)).toBe(true);
            expect(inside(stage, spot.plate)).toBe(true);
          }
          // Height decides the size (as for a pair), so it is about the size of the 2x2 grid, never a shrink.
          expect(bottom.z).toBeGreaterThanOrEqual(pose.without.sizes.equal * 0.97);
          // The frame covers both fields; the hub row lies on the bottom field.
          const finale = pose.withFinale.finale!;
          expect(inside(finale.frame, bottom.rect) && inside(finale.frame, top.rect)).toBe(true);
          expect(inside(bottom.rect, finale.band.rect)).toBe(true);
        });
      }
    }
  }

  it("has no face-off pose unless two seats are asked for, and the places of the other fields stay as they were", () => {
    const pose = poseOf(0, [0, 1]);
    expect(pose.without.finale).toBeNull();
    expect(pose.withFinale.regular).toEqual(pose.without.cells);
  });
});

describe("useFinalDuel", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const run = (initial: number[], resetKey = "a:0") =>
    renderHook(({ out, key }) => useFinalDuel({ seats: seatsOut(out), viewerSeat: null, reducedMotion: false, resetKey: key }), { initialProps: { out: initial, key: resetKey } });

  it("reaches the face-off after the crumble and a beat, with the caption, then drops the caption and keeps the face-off", () => {
    const hook = run([2]);
    hook.rerender({ out: [2, 3], key: "a:0" });
    expect(hook.result.current).toEqual({ caption: null, reached: null });
    act(() => void vi.advanceTimersByTime(EXIT_CRUMBLE_MS + FINALE_BEAT_MS - 1));
    expect(hook.result.current.reached).toBeNull();
    act(() => void vi.advanceTimersByTime(1));
    expect(hook.result.current.reached).toEqual([0, 1]);
    expect(hook.result.current.caption).toMatchObject({ seats: [0, 1] });
    act(() => void vi.advanceTimersByTime(CAPTION_MS));
    expect(hook.result.current.caption).toBeNull();
    expect(hook.result.current.reached).toEqual([0, 1]);
  });

  it("opens straight on the face-off, with no caption, when two seats are already left (a reload, a seek)", () => {
    const hook = run([1, 2]);
    expect(hook.result.current).toEqual({ caption: null, reached: [0, 3] });
  });

  it("keeps the face-off when one of the last two goes out, and drops it for a new duel", () => {
    const hook = run([2, 3]);
    hook.rerender({ out: [1, 2, 3], key: "a:0" });
    act(() => void vi.advanceTimersByTime(EXIT_CRUMBLE_MS + FINALE_BEAT_MS));
    expect(hook.result.current.reached).toEqual([0, 1]);
    // A new game of the series (or another duel): the state starts again, as already seen.
    hook.rerender({ out: [], key: "a:1" });
    expect(hook.result.current).toEqual({ caption: null, reached: null });
  });

  it("follows a jump to a state with two left at once, and out of it", () => {
    const hook = run([]);
    hook.rerender({ out: [], key: "b:0" });
    expect(hook.result.current.reached).toBeNull();
    hook.rerender({ out: [0, 2], key: "b:1" });
    expect(hook.result.current).toEqual({ caption: null, reached: [1, 3] });
    hook.rerender({ out: [], key: "b:2" });
    expect(hook.result.current).toEqual({ caption: null, reached: null });
  });
});

describe("GridStage face-off", () => {
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
  afterEach(() => cleanup());

  function Shell({ id, out }: { id: "main" | "spectator"; out: number[] }) {
    const set = ffa4Variant(FFA4_FIXTURES, { out });
    const controller = useFixtureController(set.states[id], { reducedMotion: true });
    return <TableShell controller={controller} />;
  }
  const cellOf = (container: HTMLElement, seat: number) => container.querySelector<HTMLElement>(`[data-grid-cell="${seat}"]`)!;
  const fieldOf = (container: HTMLElement, seat: number) => cellOf(container, seat).querySelector<HTMLElement>("[data-seat-field]")!;
  const turnOf = (container: HTMLElement, seat: number) => cellOf(container, seat).querySelector("[data-seat-slot]")?.getAttribute("style") ?? "";

  for (const id of ["main", "spectator"] as const) {
    for (const out of [[2, 3], [0, 1], [1, 3], [1, 2], [0, 3], [0, 2]]) {
      const live = [0, 1, 2, 3].filter((seat) => !out.includes(seat));
      const same = Math.floor(live[0] / 2) === Math.floor(live[1] / 2);
      it(`${id}, seats ${live.join("+")} left: ${same ? "a facing pair keeps its link light" : "two pairs get no link light and no shared row"}`, () => {
        const { container } = render(<Shell id={id} out={out} />);
        const stage = container.querySelector("[data-grid-stage]")!;
        expect(stage.getAttribute("data-grid-finale")).toBe(same ? "same" : "cross");
        // Each of the two draws its own Extra Monster row (no data-emz mark: not the shared one of a pair), one turned 180 (top); the others are gone.
        const turned = live.filter((seat) => /rotate: 180deg/.test(turnOf(container, seat)));
        expect(turned).toHaveLength(1);
        for (const seat of live) expect(fieldOf(container, seat).hasAttribute("data-emz")).toBe(false);
        for (const seat of out) expect(cellOf(container, seat).getAttribute("data-cell-state")).toBe("empty");
        // The link: the hover light ids and the pair badge exist for a facing pair only.
        const links = container.querySelectorAll("[data-link-id]");
        const badges = container.querySelectorAll("[data-pair-badge]");
        if (same) {
          expect(links.length).toBeGreaterThan(0);
          expect(badges.length).toBe(2);
        } else {
          expect(links.length).toBe(0);
          expect(badges.length).toBe(0);
        }
      });
    }
  }

  it("glide time of the face-off is the restored 1400 ms", () => {
    expect(FINALE_GLIDE_MS).toBe(1400);
  });
});
