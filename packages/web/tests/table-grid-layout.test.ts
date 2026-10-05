import { describe, expect, it } from "vitest";
import { extraMonster, extraMonsterKeys } from "@/components/duel/field-keys";
import { tableLayout } from "@/components/duel/table/geometry";
import {
  cellIndex,
  cellState,
  FOCUS_SHARE,
  gridCells,
  gridFocusLayout,
  gridPartnerOf,
  gridPlacement,
  gridWorld,
  HAND_RISE,
  HAND_SHARE,
  LP_MAX_HEIGHT,
  OUT_HOLD_MS,
  OTHER_SHARE,
  OVERLAP,
  PARTNER_MIN_SHARE,
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

  it("is drawn by the bottom field, or by the top field once the bottom cell is empty", () => {
    const cells = gridCells(layoutOf(0));
    const states = (entries: [number, CellState][]) => new Map<number, CellState>(entries);
    expect(pairDrawer(cells, states([]), 0)).toBe(0);
    expect(pairDrawer(cells, states([]), 1)).toBe(3);
    expect(pairDrawer(cells, states([[0, "empty"]]), 0)).toBe(1);
    expect(pairDrawer(cells, states([[0, "out"]]), 0)).toBe(0);
    expect(pairDrawer(cells, states([[0, "empty"], [1, "empty"]]), 0)).toBeNull();
  });

  it("is drawn by the focused seat of the column when that seat is not empty", () => {
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
  it("lays four equal fields in a 2x2 for all fields, rows lined up, the equal size height-bound", () => {
    const layout = gridFocusLayout(gridWorld(5), VIEWPORTS[0], null);
    const [tl, bl, tr, br] = layout.cells;
    expect(layout.cells.map((cell) => cell.z)).toEqual([layout.sizes.equal, layout.sizes.equal, layout.sizes.equal, layout.sizes.equal]);
    expect(tl.rect.y).toBe(tr.rect.y);
    expect(bl.rect.y).toBe(br.rect.y);
    expect(tl.rect.x).toBe(bl.rect.x);
    expect(tl.rect.x).toBeLessThan(tr.rect.x);
    expect(tl.rect.y).toBeLessThan(bl.rect.y);
    expect(layout.sizes.equal).toBeGreaterThan(95);
  });

  it("keeps every field and every life box inside the box, for every focus and box", () => {
    for (const rule of [3, 4, 5] as const) {
      every((layout, view) => {
        for (const cell of layout.cells) expect(inside(cell.rect, view)).toBe(true);
        for (const band of layout.bands) {
          expect(inside(band.rect, view)).toBe(true);
          expect(inside(band.bottomLp, view)).toBe(true);
          expect(inside(band.topLp, view)).toBe(true);
        }
      }, rule);
    }
  });

  it("keeps each field inside its own column: the two columns never overlap", () => {
    every((layout) => {
      const left = layout.cells.filter((cell) => cell.column === 0);
      const right = layout.cells.filter((cell) => cell.column === 1);
      for (const a of left) for (const b of right) expect(overlap(a.rect, b.rect)).toBe(false);
      for (const band of [layout.bands[0]]) for (const b of right) expect(overlap(band.rect, b.rect)).toBe(false);
    });
  });

  it("overlaps the two fields of a column by their Extra Monster rows only, and puts no life box over an Extra Monster Zone", () => {
    every((layout) => {
      for (const column of [0, 1] as const) {
        const top = layout.cells[cellIndex({ column, row: 0 })];
        const bottom = layout.cells[cellIndex({ column, row: 1 })];
        const drawer = top.drawer ? top : bottom;
        const other = top.drawer ? bottom : top;
        // the mat of the field that does not draw the row ends where the row of the drawer starts
        const visible = top.drawer ? other.rect.y + OVERLAP * other.z : other.rect.y + other.rect.height - OVERLAP * other.z;
        expect(Math.abs(visible - (top.drawer ? drawer.rect.y + drawer.rect.height : drawer.rect.y))).toBeLessThanOrEqual(1);
        const band = layout.bands[column];
        expect(overlap(band.bottomLp, band.topLp)).toBe(false);
        expect(band.bottomLp.x + band.bottomLp.width).toBeLessThanOrEqual(band.topLp.x);
        expect(band.bottomLp.y).toBeGreaterThanOrEqual(band.rect.y - 0.01);
        expect(band.bottomLp.y + band.bottomLp.height).toBeLessThanOrEqual(band.rect.y + band.rect.height + 0.01);
        expect(band.bottomLp.height).toBeLessThanOrEqual(LP_MAX_HEIGHT);
      }
    });
  });

  it("makes the focused field about 1.3x the equal size and the other column about 0.8x, the partner in between", () => {
    const view = { width: 1904, height: 930 };
    for (const focus of FOCUSES.filter((entry) => entry != null)) {
      const layout = gridFocusLayout(gridWorld(5), view, focus, { homeColumn: 0 });
      const { equal } = layout.sizes;
      const focused = layout.cells[cellIndex(focus!)];
      const partner = layout.cells[cellIndex({ column: focus!.column, row: focus!.row === 1 ? 0 : 1 })];
      expect(focused.z).toBe(layout.sizes.focus);
      expect(focused.z).toBeGreaterThanOrEqual(equal * 1.29);
      expect(focused.z).toBeLessThanOrEqual(equal * FOCUS_SHARE + 0.01);
      expect(partner.z).toBeLessThan(focused.z);
      expect(partner.z).toBeGreaterThanOrEqual(equal * PARTNER_MIN_SHARE - 0.01);
      expect(partner.z).toBeLessThanOrEqual(equal * OTHER_SHARE + 0.01);
      for (const cell of layout.cells.filter((entry) => entry.column !== focus!.column)) expect(cell.z).toBeCloseTo(equal * OTHER_SHARE, 1);
    }
  });

  it("makes every focus at least 1.29x the equal size at 1440x900 and 1920x1080, for the home column too", () => {
    for (const view of [{ width: 1440, height: 900 }, { width: 1920, height: 1080 }]) {
      for (const focus of FOCUSES.filter((entry) => entry != null)) {
        const layout = gridFocusLayout(gridWorld(5), view, focus, { homeColumn: 0 });
        expect(layout.sizes.focus / layout.sizes.equal).toBeGreaterThanOrEqual(1.29);
        expect(layout.sizes.partner / layout.sizes.equal).toBeGreaterThanOrEqual(PARTNER_MIN_SHARE - 0.001);
      }
    }
  });

  it("keeps the home hand lane fixed from the equal size: a focused home field does not grow it", () => {
    const view = { width: 1440, height: 900 };
    const lane = (focus: (typeof FOCUSES)[number]) => {
      const layout = gridFocusLayout(gridWorld(5), view, focus, { homeColumn: 0 });
      const home = layout.cells[cellIndex({ column: 0, row: 1 })];
      return { layout, home, below: view.height - 8 - (home.rect.y + home.rect.height) };
    };
    const all = lane(null);
    const mine = lane({ column: 0, row: 1 });
    const rival = lane({ column: 1, row: 1 });
    // the room below the home field: 1.04 of its card height, never of more than the equal size (the hand rises over the field's edge by HAND_RISE)
    for (const entry of [all, mine, rival]) expect(entry.below).toBeGreaterThanOrEqual(1.04 * Math.min(entry.home.z, entry.layout.sizes.equal) - 1);
    // the hand card is drawn from the equal size, never from the focused size, and fits the lane with its rise
    expect(mine.home.z).toBeGreaterThan(all.home.z);
    expect(mine.home.lh).toBeCloseTo(HAND_SHARE * mine.layout.sizes.equal, 1);
    expect(mine.home.lh * (1 - HAND_RISE)).toBeLessThan(mine.below);
  });

  it("puts left and top of every field and life box on whole px", () => {
    every((layout) => {
      for (const box of [...layout.cells.map((cell) => cell.rect), ...layout.bands.flatMap((band) => [band.rect, band.bottomLp, band.topLp])]) {
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
        // the mat of the other field is cut OVERLAP of its card height from the pair side; its monster row ends 1.196 from there
        expect(Math.abs(top.rect.y + top.rect.height - bottom.rect.y - OVERLAP * nonDrawer.z)).toBeLessThanOrEqual(1);
        expect(drawer.drawer).toBe(true);
      }
    });
  });

  it("reaches 1.3x when the focused column has no larger hand lane, and gives up size for the partner minimum when it has", () => {
    const view = { width: 1356, height: 744 };
    const rival = gridFocusLayout(gridWorld(5), view, { column: 1, row: 1 }, { homeColumn: 0 });
    expect(rival.sizes.focus / rival.sizes.equal).toBeCloseTo(FOCUS_SHARE, 2);
    const mine = gridFocusLayout(gridWorld(5), view, { column: 0, row: 1 }, { homeColumn: 0 });
    expect(mine.sizes.focus / mine.sizes.equal).toBeGreaterThanOrEqual(1.29);
    expect(mine.sizes.partner / mine.sizes.equal).toBeGreaterThanOrEqual(PARTNER_MIN_SHARE - 0.001);
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

  it("honours an explicit drawer row (the focused cell is empty or a pair has one seat left)", () => {
    const layout = gridFocusLayout(gridWorld(5), VIEWPORTS[0], { column: 0, row: 0 }, { drawerRow: [1, 1] });
    expect(layout.cells[cellIndex({ column: 0, row: 1 })].drawer).toBe(true);
    expect(layout.cells[cellIndex({ column: 0, row: 0 })].drawer).toBe(false);
  });

  it("makes the viewer's life box the wide one on the left of its band", () => {
    const layout = gridFocusLayout(gridWorld(5), VIEWPORTS[0], null, { homeColumn: 0 });
    const [home, other] = layout.bands;
    expect(home.bottomLp.width).toBeGreaterThan(home.topLp.width);
    expect(home.bottomLp.width).toBeGreaterThan(other.bottomLp.width);
    expect(home.bottomLp.x).toBeLessThan(home.topLp.x);
    expect(other.bottomLp.x + other.bottomLp.width).toBeLessThan(other.topLp.x);
  });

  it("marks the fields that are narrower than the small limit", () => {
    const layout = gridFocusLayout(gridWorld(5), { width: 1356, height: 744 }, { column: 0, row: 1 }, { homeColumn: 0 });
    for (const cell of layout.cells) expect(cell.small).toBe(cell.rect.width < SMALL_FIELD_WIDTH);
    expect(layout.cells.some((cell) => cell.small)).toBe(true);
    expect(layout.cells[cellIndex({ column: 0, row: 1 })].small).toBe(false);
  });

  it("gives an empty box a zero layout instead of throwing", () => {
    const layout = gridFocusLayout(gridWorld(5), { width: 0, height: 0 }, { column: 0, row: 1 });
    expect(layout.cells.every((cell) => cell.z === 0 || Number.isFinite(cell.z))).toBe(true);
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
