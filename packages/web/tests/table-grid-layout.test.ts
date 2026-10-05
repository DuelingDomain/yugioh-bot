import { describe, expect, it } from "vitest";
import { extraMonster, extraMonsterKeys } from "@/components/duel/field-keys";
import { tableLayout } from "@/components/duel/table/geometry";
import {
  cellState,
  fitZoom,
  gridBand,
  gridCells,
  gridPartnerOf,
  gridPlacement,
  gridPose,
  gridView,
  gridWorld,
  lpBox,
  OUT_HOLD_MS,
  pairDrawer,
  usesGridLayout,
  type CellState,
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

describe("grid geometry", () => {
  it("lays four equal fields in two columns, with the 180 turn on the top row and no scale", () => {
    const world = gridWorld(5);
    const poses = gridCells(layoutOf(0)).map((cell) => gridPose(cell, world));
    expect(poses.every((pose) => pose.scale === 1 && !pose.hidden && !pose.compact && !pose.docked)).toBe(true);
    const [bl, tl, tr, br] = poses;
    expect(bl.x).toBe(tl.x);
    expect(tr.x).toBe(br.x);
    expect(tl.y).toBe(tr.y);
    expect(bl.y).toBe(br.y);
    expect(tl.x).toBeLessThan(tr.x);
    expect(tl.y).toBeLessThan(bl.y);
    expect([bl.rotateDeg, tl.rotateDeg, tr.rotateDeg, br.rotateDeg]).toEqual([0, 180, 180, 0]);
  });

  it("keeps every field inside the world", () => {
    for (const rule of [3, 4, 5] as const) {
      const world = gridWorld(rule);
      for (const pose of gridCells(layoutOf(0)).map((cell) => gridPose(cell, world))) {
        expect(pose.x - world.fieldWidth / 2).toBeGreaterThanOrEqual(0);
        expect(pose.x + world.fieldWidth / 2).toBeLessThanOrEqual(world.width);
        expect(pose.y - world.fieldHeight / 2).toBeGreaterThanOrEqual(0);
        expect(pose.y + world.fieldHeight / 2).toBeLessThanOrEqual(world.height);
      }
    }
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
});

describe("life boxes in the middle band", () => {
  it("orders them [bottom player] [Extra Monster] [gap] [Extra Monster] [top player], mine bigger and on the left", () => {
    const world = gridWorld(5);
    const home = gridBand(0, true, world);
    const other = gridBand(1, false, world);
    for (const band of [home, other]) {
      expect(band.bottomLp.x).toBe(band.x);
      expect(band.topLp.x + band.topLp.width).toBeCloseTo(band.x + band.width, 1);
      expect(band.bottomLp.x + band.bottomLp.width).toBeLessThan(band.topLp.x);
    }
    expect(home.bottomLp.width).toBeGreaterThan(other.bottomLp.width);
    expect(home.bottomLp.width).toBeGreaterThan(home.topLp.width);
  });

  it("keeps the boxes inside the band, one band row high, apart from each other", () => {
    const world = gridWorld(5);
    const cells = gridCells(layoutOf(0));
    const boxes = cells.map((cell) => ({ cell, box: lpBox(cell, cell.home, world) }));
    for (const { box } of boxes) {
      expect(box.y).toBeGreaterThanOrEqual(world.bandTop);
      expect(box.y + box.height).toBeLessThanOrEqual(world.bandTop + world.bandHeight);
    }
    const left = boxes.filter(({ cell }) => cell.column === 0).map(({ box }) => box).sort((a, b) => a.x - b.x);
    expect(left[0].x + left[0].width).toBeLessThan(left[1].x);
    expect(boxes.find(({ cell }) => cell.home)!.box.x).toBeLessThan(boxes.find(({ cell }) => cell.seat === 1)!.box.x);
  });
});

describe("gridView", () => {
  const viewport = { width: 949, height: 747 };
  const world = gridWorld(5);

  it("shows the whole world centred when no field is in focus", () => {
    const view = gridView(world, viewport, null);
    expect(view.zoom).toBeCloseTo(fitZoom(world, viewport), 6);
    expect(view.x).toBeGreaterThanOrEqual(0);
    expect(view.x + world.width * view.zoom).toBeLessThanOrEqual(viewport.width);
  });

  it("zooms in on a focused field, and the +/- factor changes the size within bounds", () => {
    const home = gridCells(layoutOf(0)).find((cell) => cell.home)!;
    const all = gridView(world, viewport, null);
    const focus = gridView(world, viewport, home);
    expect(focus.zoom).toBeGreaterThan(all.zoom);
    expect(gridView(world, viewport, home, 1.3).zoom).toBeGreaterThan(focus.zoom);
    expect(gridView(world, viewport, home, 0.1).zoom).toBeGreaterThanOrEqual(all.zoom);
  });

  it("keeps the focused field on screen", () => {
    for (const cell of gridCells(layoutOf(0))) {
      const view = gridView(world, viewport, cell);
      const left = view.x + world.side * view.zoom + cell.column * (world.fieldWidth + world.columnGap) * view.zoom;
      expect(left + world.fieldWidth * view.zoom * 0.5).toBeGreaterThan(0);
      expect(left).toBeLessThan(viewport.width);
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
