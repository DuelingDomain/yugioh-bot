import { describe, expect, it } from "vitest";
import { extraMonster, extraMonsterKeys } from "@/components/duel/field-keys";
import { tableLayout } from "@/components/duel/table/geometry";
import {
  cellIndex,
  cellState,
  CROSS_OVERLAP,
  FINALE_SIDE,
  gridCells,
  gridFocusLayout,
  gridPartnerOf,
  gridPlacement,
  gridWorld,
  HAND_RISE,
  HAND_SHARE,
  OUT_HOLD_MS,
  OTHER_MIN_SHARE,
  PAIR_FOCUS,
  PAIR_FOCUS_MIN,
  OVERLAP,
  PLATE_H,
  pairDrawer,
  SMALL_FIELD_WIDTH,
  usesGridLayout,
  type CellState,
  type GridFocusLayout,
  type GridRect,
} from "@/components/duel/table/grid-layout";

type Seat = { seat: number; eliminated?: boolean; pendingElimination?: boolean };
const seats = (out: number[] = []): Seat[] => [0, 1, 2, 3].map((seat) => ({ seat, eliminated: out.includes(seat) }));
const layoutOf = (viewer: number | null, out: number[] = []) => {
  const engine = { format: "ffa4", seats: seats(out) } as never;
  return tableLayout("ffa4", engine, viewer);
};
const quadrants = (viewer: number | null) => Object.fromEntries(gridCells(layoutOf(viewer)).map((cell) => [cell.seat, cell.quadrant]));

describe("usesGridLayout", () => {
  it("is on for a 4-seat free-for-all, even while a seat is out, and off elsewhere", () => {
    expect(usesGridLayout("ffa4", seats())).toBe(true);
    expect(usesGridLayout("ffa4", seats([2]))).toBe(true);
    expect(usesGridLayout("ffa3", seats().slice(0, 3))).toBe(false);
    expect(usesGridLayout("tag", seats())).toBe(false);
    expect(usesGridLayout("1v1", seats().slice(0, 2))).toBe(false);
  });
});

describe("gridCells", () => {
  it("puts the viewer bottom-left with the partner (seat ^ 1) in front of them", () => {
    expect(quadrants(0)).toEqual({ 0: "bl", 1: "tl", 2: "tr", 3: "br" });
    expect(quadrants(1)).toEqual({ 1: "bl", 0: "tl", 3: "tr", 2: "br" });
    expect(quadrants(2)).toEqual({ 2: "bl", 3: "tl", 0: "tr", 1: "br" });
    expect(quadrants(3)).toEqual({ 3: "bl", 2: "tl", 1: "tr", 0: "br" });
  });

  it("follows BL = v, TL = v ^ 1, BR = 3 - v, TR = (3 - v) ^ 1 for every viewer", () => {
    for (const v of [0, 1, 2, 3]) {
      expect(gridPlacement(v)).toEqual({ bl: v, tl: v ^ 1, br: 3 - v, tr: (3 - v) ^ 1 });
    }
    expect(gridPlacement(null)).toEqual(gridPlacement(0));
  });

  it("has one partner rule: the facing seat of the same column, pairs 0+1 and 2+3", () => {
    for (const viewer of [0, 1, 2, 3, null]) {
      const cells = gridCells(layoutOf(viewer));
      for (const cell of cells) {
        expect(cell.partner).toBe(gridPartnerOf(cell.seat));
        const other = cells.find((entry) => entry.seat === cell.partner)!;
        expect(other.column).toBe(cell.column);
        expect(other.row).not.toBe(cell.row);
      }
    }
    expect([0, 1, 2, 3].map(gridPartnerOf)).toEqual([1, 0, 3, 2]);
  });

  it("seats a spectator with seat 0 at bottom-left", () => {
    expect(quadrants(null)).toEqual({ 0: "bl", 1: "tl", 2: "tr", 3: "br" });
    expect(gridCells(layoutOf(null)).find((cell) => cell.seat === 0)?.home).toBe(true);
  });

  it("turns the top fields 180 degrees and keeps the bottom fields upright", () => {
    for (const viewer of [0, 1, 2, 3, null]) {
      for (const cell of gridCells(layoutOf(viewer))) {
        expect(cell.rotateDeg).toBe(cell.row === 0 ? 180 : 0);
        expect(cell.row === 0).toBe(cell.quadrant === "tl" || cell.quadrant === "tr");
      }
    }
  });

  it("marks exactly one home cell", () => {
    expect(gridCells(layoutOf(2)).filter((cell) => cell.home).map((cell) => cell.seat)).toEqual([2]);
  });
});

describe("shared Extra Monster row", () => {
  it("reads my left slot from my zone 5 or the partner's zone 6, my right slot the other way round", () => {
    expect(extraMonsterKeys(0, 1, "left")).toEqual(["0:4:5", "1:4:6"]);
    expect(extraMonsterKeys(0, 1, "right")).toEqual(["0:4:6", "1:4:5"]);
    expect(extraMonsterKeys(3, 2, "left")).toEqual(["3:4:5", "2:4:6"]);
    const mine = { monsters: [] as unknown[] };
    mine.monsters[5] = { code: 1 };
    const partner = { monsters: [] as unknown[] };
    partner.monsters[5] = { code: 2 };
    expect(extraMonster(mine as never, partner as never, "left")).toEqual({ code: 1 });
    expect(extraMonster(mine as never, partner as never, "right")).toEqual({ code: 2 });
  });

  it("is drawn by the bottom field, or by the top field once the bottom seat is not live", () => {
    const cells = gridCells(layoutOf(0));
    const states = (entries: [number, CellState][]) => new Map<number, CellState>(entries);
    expect(pairDrawer(cells, states([]), 0)).toBe(0);
    expect(pairDrawer(cells, states([]), 1)).toBe(3);
    expect(pairDrawer(cells, states([[0, "empty"]]), 0)).toBe(1);
    expect(pairDrawer(cells, states([[0, "out"]]), 0)).toBe(1);
    expect(pairDrawer(cells, states([[0, "empty"], [1, "empty"]]), 0)).toBeNull();
    expect(pairDrawer(cells, states([[0, "out"], [1, "out"]]), 0)).toBeNull();
  });

  it("is drawn by the preferred seat of the column when that seat is live", () => {
    const cells = gridCells(layoutOf(0));
    const states = (entries: [number, CellState][]) => new Map<number, CellState>(entries);
    expect(pairDrawer(cells, states([]), 0, 1)).toBe(1);
    expect(pairDrawer(cells, states([]), 1, 2)).toBe(2);
    expect(pairDrawer(cells, states([]), 0, 2)).toBe(0);
    expect(pairDrawer(cells, states([[1, "empty"]]), 0, 1)).toBe(0);
  });
});

const VIEWPORTS = [
  { width: 1356, height: 744 },
  { width: 1904, height: 930 },
  { width: 949, height: 747 },
  { width: 1100, height: 860 },
];
const FOCUSES = [null, { column: 0, row: 1 }, { column: 0, row: 0 }, { column: 1, row: 1 }, { column: 1, row: 0 }] as const;
const overlap = (a: GridRect, b: GridRect) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
const inside = (box: GridRect, view: { width: number; height: number }) =>
  box.x >= -0.01 && box.y >= -0.01 && box.x + box.width <= view.width + 0.01 && box.y + box.height <= view.height + 0.01;
const every = (run: (layout: GridFocusLayout, view: (typeof VIEWPORTS)[number], focus: (typeof FOCUSES)[number]) => void, rule: 3 | 4 | 5 = 5) => {
  for (const view of VIEWPORTS) for (const focus of FOCUSES) run(gridFocusLayout(gridWorld(rule), view, focus, { homeColumn: 0 }), view, focus);
};

describe("gridFocusLayout", () => {
  it("lays four equal fields in a 2x2 for all fields, rows lined up", () => {
    const layout = gridFocusLayout(gridWorld(5), VIEWPORTS[0], null);
    const [tl, bl, tr, br] = layout.cells;
    expect(layout.cells.map((cell) => cell.z)).toEqual([layout.sizes.equal, layout.sizes.equal, layout.sizes.equal, layout.sizes.equal]);
    expect(tl.rect.y).toBe(tr.rect.y);
    expect(bl.rect.y).toBe(br.rect.y);
    expect(tl.rect.x).toBe(bl.rect.x);
    expect(tl.rect.x).toBeLessThan(tr.rect.x);
    expect(tl.rect.y).toBeLessThan(bl.rect.y);
    expect(layout.sizes.equal).toBeGreaterThan(95);
    expect(layout.finale).toBeNull();
  });

  it("keeps every field, plate and shared row inside the box, for every focus and box", () => {
    for (const rule of [3, 4, 5] as const) {
      every((layout, view) => {
        for (const cell of layout.cells) {
          expect(inside(cell.rect, view)).toBe(true);
          expect(inside(cell.plate, view)).toBe(true);
        }
        for (const band of layout.bands) expect(inside(band.rect, view)).toBe(true);
      }, rule);
    }
  });

  it("keeps each pair inside its own column: the two columns never overlap", () => {
    every((layout) => {
      const left = layout.cells.filter((cell) => cell.column === 0);
      const right = layout.cells.filter((cell) => cell.column === 1);
      for (const a of left) for (const b of right) expect(overlap(a.rect, b.rect)).toBe(false);
      for (const b of right) expect(overlap(layout.bands[0].rect, b.rect)).toBe(false);
    });
  });

  it("gives a plate to every seat, above the top field and below the bottom field, clear of the shared row", () => {
    every((layout) => {
      for (const column of [0, 1] as const) {
        const top = layout.cells[cellIndex({ column, row: 0 })];
        const bottom = layout.cells[cellIndex({ column, row: 1 })];
        const band = layout.bands[column];
        expect(overlap(top.plate, band.rect)).toBe(false);
        expect(overlap(bottom.plate, band.rect)).toBe(false);
        expect(overlap(top.plate, bottom.plate)).toBe(false);
        expect(top.plate.y + top.plate.height).toBeLessThanOrEqual(top.rect.y + top.rect.height);
        expect(bottom.plate.y).toBeGreaterThanOrEqual(band.rect.y + band.rect.height);
      }
    });
  });

  it("lifts the focused pair to about 1.12x of the rest size, the other pair a little smaller", () => {
    const view = { width: 1904, height: 930 };
    for (const focus of FOCUSES.filter((entry) => entry != null)) {
      const layout = gridFocusLayout(gridWorld(5), view, focus, { homeColumn: 0 });
      const { rest, focus: lifted, other } = layout.sizes;
      expect(lifted).toBeGreaterThan(rest);
      expect(lifted).toBeLessThanOrEqual(rest * PAIR_FOCUS + 0.01);
      expect(lifted).toBeGreaterThanOrEqual(rest * PAIR_FOCUS_MIN - 0.01);
      expect(other).toBeLessThanOrEqual(rest + 0.01);
      expect(other).toBeGreaterThanOrEqual(rest * OTHER_MIN_SHARE - 0.01);
      for (const cell of layout.cells) expect(cell.z).toBeCloseTo(cell.column === focus!.column ? lifted : other, 1);
    }
  });

  it("keeps the home hand lane fixed from the rest size: a lifted home pair does not grow the hand", () => {
    const view = { width: 1440, height: 900 };
    const lane = (focus: (typeof FOCUSES)[number]) => {
      const layout = gridFocusLayout(gridWorld(5), view, focus, { homeColumn: 0 });
      const home = layout.cells[cellIndex({ column: 0, row: 1 })];
      return { layout, home, below: view.height - 8 - (home.rect.y + home.rect.height) };
    };
    const mine = lane({ column: 0, row: 1 });
    const rival = lane({ column: 1, row: 1 });
    for (const entry of [mine, rival]) {
      expect(entry.home.lh).toBeCloseTo(HAND_SHARE * entry.layout.sizes.rest, 1);
      // the hand rises over the field's edge by HAND_RISE and still fits under it
      expect(entry.home.lh * (1 - HAND_RISE)).toBeLessThan(entry.below);
    }
  });

  it("puts left and top of every field, plate and shared row on whole px", () => {
    every((layout) => {
      for (const box of [...layout.cells.flatMap((cell) => [cell.rect, cell.plate]), ...layout.bands.map((band) => band.rect)]) {
        expect(Number.isInteger(box.x)).toBe(true);
        expect(Number.isInteger(box.y)).toBe(true);
      }
    });
  });

  it("overlaps a pair by the drawing field's pad, row and row gap, so the other field's monster row stays on its mat", () => {
    expect(OVERLAP).toBeCloseTo(0.125 + 1 + 0.071, 5);
    every((layout) => {
      for (const column of [0, 1] as const) {
        const top = layout.cells[cellIndex({ column, row: 0 })];
        const bottom = layout.cells[cellIndex({ column, row: 1 })];
        const nonDrawer = top.drawer ? bottom : top;
        const drawer = top.drawer ? top : bottom;
        expect(Math.abs(top.rect.y + top.rect.height - bottom.rect.y - OVERLAP * nonDrawer.z)).toBeLessThanOrEqual(1);
        expect(drawer.drawer).toBe(true);
      }
    });
  });

  it("keeps the shared Extra Monster row on the bottom field of each column, whatever the focus", () => {
    for (const focus of FOCUSES) {
      const layout = gridFocusLayout(gridWorld(5), VIEWPORTS[0], focus);
      const drawers = layout.cells.filter((cell) => cell.drawer);
      expect(drawers).toHaveLength(2);
      expect(drawers.every((cell) => cell.row === 1)).toBe(true);
      for (const column of [0, 1] as const) {
        const band = layout.bands[column];
        const drawer = layout.cells.find((cell) => cell.column === column && cell.drawer)!;
        expect(band.rect.x).toBeGreaterThan(drawer.rect.x);
        expect(band.rect.x + band.rect.width).toBeLessThan(drawer.rect.x + drawer.rect.width);
        expect(band.rect.y).toBeGreaterThanOrEqual(drawer.rect.y);
        expect(band.rect.y + band.rect.height).toBeLessThanOrEqual(drawer.rect.y + drawer.rect.height);
      }
    }
  });

  it("lines the two shared Extra Monster rows up on one line", () => {
    every((layout) => {
      const [a, b] = layout.bands;
      expect(Math.abs(a.rect.y + a.rect.height / 2 - (b.rect.y + b.rect.height / 2))).toBeLessThanOrEqual(1);
    });
  });

  it("honours an explicit drawer row (the focused cell is empty or a pair has one seat left)", () => {
    const layout = gridFocusLayout(gridWorld(5), VIEWPORTS[0], { column: 0, row: 0 }, { drawerRow: [0, 1] });
    expect(layout.cells[cellIndex({ column: 0, row: 0 })].drawer).toBe(true);
    expect(layout.cells[cellIndex({ column: 0, row: 1 })].drawer).toBe(false);
  });

  it("marks the fields that are narrower than the small limit", () => {
    const layout = gridFocusLayout(gridWorld(5), { width: 1356, height: 744 }, { column: 0, row: 1 }, { homeColumn: 0 });
    for (const cell of layout.cells) expect(cell.small).toBe(cell.rect.width < SMALL_FIELD_WIDTH);
    expect(layout.cells[cellIndex({ column: 0, row: 1 })].small).toBe(false);
  });

  it("gives an empty box a zero layout instead of throwing", () => {
    const layout = gridFocusLayout(gridWorld(5), { width: 0, height: 0 }, { column: 0, row: 1 });
    expect(layout.cells.every((cell) => cell.z === 0 || Number.isFinite(cell.z))).toBe(true);
  });
});

describe("gridFocusLayout finale", () => {
  const view = { width: 1920, height: 1080 };
  const finaleOf = (bottom: { column: 0 | 1; row: 0 | 1 }, top: { column: 0 | 1; row: 0 | 1 }, homeHand = true) =>
    gridFocusLayout(gridWorld(5), view, { column: bottom.column, row: 1 }, { homeColumn: 0, finale: { bottom, top, homeHand } });
  const same = () => finaleOf({ column: 0, row: 1 }, { column: 0, row: 0 });
  const cross = () => finaleOf({ column: 0, row: 1 }, { column: 1, row: 1 });
  const pair = (layout: GridFocusLayout, bottom: { column: 0 | 1; row: 0 | 1 }, top: { column: 0 | 1; row: 0 | 1 }) => ({
    bottom: layout.cells[cellIndex(bottom)],
    top: layout.cells[cellIndex(top)],
  });

  it("lays the last two out as one board in the middle, the bottom seat turned 0 under the top seat turned 180", () => {
    for (const [layout, bottom, top] of [
      [same(), { column: 0, row: 1 }, { column: 0, row: 0 }],
      [cross(), { column: 0, row: 1 }, { column: 1, row: 1 }],
      [finaleOf({ column: 1, row: 0 }, { column: 1, row: 1 }), { column: 1, row: 0 }, { column: 1, row: 1 }],
    ] as const) {
      const board = pair(layout, bottom, top);
      expect(board.bottom.turn).toBe(0);
      expect(board.top.turn).toBe(180);
      expect(board.bottom.rect.x).toBe(board.top.rect.x);
      expect(board.bottom.rect.y).toBeGreaterThan(board.top.rect.y);
      expect(Math.abs(board.bottom.rect.x + board.bottom.rect.width / 2 - view.width / 2)).toBeLessThanOrEqual(1);
      // One pair is as big as the lifted pair; two pairs give up a little to show two Extra Monster rows.
      const lifted = gridFocusLayout(gridWorld(5), view, { column: 0, row: 1 }, { homeColumn: 0 }).sizes.focus;
      expect(board.bottom.z).toBeGreaterThanOrEqual((layout.finale?.kind === "same" ? 1 : 0.85) * lifted - 0.01);
      for (const cell of [board.top, board.bottom]) {
        expect(inside(cell.rect, view)).toBe(true);
        expect(inside(cell.plate, view)).toBe(true);
      }
    }
  });

  it("puts both plates on the LEFT of the board, the top plate at the top and mine at the bottom", () => {
    const { top, bottom } = pair(same(), { column: 0, row: 1 }, { column: 0, row: 0 });
    for (const cell of [top, bottom]) {
      expect(cell.plate.x + cell.plate.width).toBeLessThanOrEqual(cell.rect.x);
      expect(cell.plate.width).toBeCloseTo(FINALE_SIDE * cell.z, 0);
      expect(cell.plate.height).toBeCloseTo(PLATE_H * cell.z, 0);
    }
    expect(top.plate.y).toBeCloseTo(top.rect.y, 0);
    expect(bottom.plate.y + bottom.plate.height).toBeCloseTo(bottom.rect.y + bottom.rect.height, 0);
  });

  it("shares the Extra Monster row for one pair, and keeps two rows face to face for two pairs", () => {
    const one = pair(same(), { column: 0, row: 1 }, { column: 0, row: 0 });
    expect(one.top.rect.y + one.top.rect.height - one.bottom.rect.y).toBeCloseTo(OVERLAP * one.bottom.z, 0);
    expect([one.top.drawer, one.bottom.drawer]).toEqual([false, true]);
    expect(same().finale?.kind).toBe("same");

    const two = pair(cross(), { column: 0, row: 1 }, { column: 1, row: 1 });
    expect(two.top.rect.y + two.top.rect.height - two.bottom.rect.y).toBeCloseTo(CROSS_OVERLAP * two.bottom.z, 0);
    expect([two.top.drawer, two.bottom.drawer]).toEqual([true, true]);
    expect(two.top.own).toEqual(two.top.rect);
    expect(two.bottom.own).toEqual(two.bottom.rect);
    expect(cross().finale?.kind).toBe("cross");
  });

  it("frames the whole board and puts the hub band in the bottom seat's Extra Monster row", () => {
    for (const layout of [same(), cross()]) {
      const finale = layout.finale!;
      const { top, bottom } = pair(layout, { column: 0, row: 1 }, layout.finale!.kind === "same" ? { column: 0, row: 0 } : { column: 1, row: 1 });
      expect(finale.frame).toEqual({ x: top.rect.x, y: top.rect.y, width: top.rect.width, height: bottom.rect.y + bottom.rect.height - top.rect.y });
      expect(finale.band.column).toBe(0);
      expect(finale.band.rect.y).toBeGreaterThan(bottom.rect.y);
      expect(finale.band.rect.y + finale.band.rect.height).toBeLessThan(bottom.own.y + bottom.own.height);
      expect(finale.band.rect.x).toBeGreaterThan(bottom.rect.x);
      expect(finale.band.rect.x + finale.band.rect.width).toBeLessThan(bottom.rect.x + bottom.rect.width);
    }
  });

  it("keeps the cells without the finale in `regular`, and the same cells as `cells` when there is no finale", () => {
    const layout = cross();
    const plain = gridFocusLayout(gridWorld(5), view, { column: 0, row: 1 }, { homeColumn: 0 });
    expect(layout.regular).toEqual(plain.cells);
    expect(plain.regular).toEqual(plain.cells);
    expect(plain.finale).toBeNull();
    expect(layout.cells[cellIndex({ column: 1, row: 0 })]).toEqual(plain.cells[cellIndex({ column: 1, row: 0 })]);
  });

  it("gives my hand the whole board width in the finale", () => {
    const { bottom } = pair(same(), { column: 0, row: 1 }, { column: 0, row: 0 });
    expect(bottom.hand.shift).toBe(0);
    expect(bottom.hand.width).toBeCloseTo(gridWorld(5).zones, 2);
  });

  it("fits a smaller box", () => {
    const small = { width: 1440, height: 900 };
    for (const finale of [
      { bottom: { column: 0, row: 1 }, top: { column: 0, row: 0 } },
      { bottom: { column: 0, row: 1 }, top: { column: 1, row: 0 } },
    ] as const) {
      const layout = gridFocusLayout(gridWorld(5), small, null, { homeColumn: 0, finale: { ...finale, homeHand: true } });
      for (const target of [finale.bottom, finale.top]) {
        const cell = layout.cells[cellIndex(target)];
        expect(inside(cell.rect, small)).toBe(true);
        expect(inside(cell.plate, small)).toBe(true);
      }
    }
  });
});

describe("cellState", () => {
  it("is live for a seat in the duel and for a missing seat view", () => {
    expect(cellState({ eliminated: false }, null, 0)).toBe("live");
    expect(cellState(undefined, null, 0)).toBe("live");
  });

  it("keeps a seat that just went out mounted as out, then empties the cell", () => {
    expect(cellState({ eliminated: true }, 1000, 1000)).toBe("out");
    expect(cellState({ eliminated: true }, 1000, 1000 + OUT_HOLD_MS - 1)).toBe("out");
    expect(cellState({ eliminated: true }, 1000, 1000 + OUT_HOLD_MS)).toBe("empty");
  });

  it("opens an already-out seat as an empty cell", () => {
    expect(cellState({ eliminated: true }, null, 5000)).toBe("empty");
  });
});
