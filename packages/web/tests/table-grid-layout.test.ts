import { describe, expect, it } from "vitest";
import { tableLayout } from "@/components/duel/table/geometry";
import {
  cellCenter,
  cellState,
  gridCells,
  gridMetrics,
  gridPartnerSeat,
  gridPose,
  lpAnchor,
  LP_WIDTH,
  LP_WIDTH_ME,
  OUT_HOLD_MS,
  usesGridLayout,
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
  it("puts the viewer bottom-left and walks the turn order top-left, top-right, bottom-right", () => {
    expect(quadrants(0)).toEqual({ 0: "bl", 1: "tl", 2: "tr", 3: "br" });
    expect(quadrants(1)).toEqual({ 1: "bl", 2: "tl", 3: "tr", 0: "br" });
    expect(quadrants(2)).toEqual({ 2: "bl", 3: "tl", 0: "tr", 1: "br" });
    expect(quadrants(3)).toEqual({ 3: "bl", 0: "tl", 1: "tr", 2: "br" });
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

describe("gridPartnerSeat", () => {
  it("is the diagonal field (seat + 2)", () => {
    for (const viewer of [0, 1, 2, 3]) {
      const layout = layoutOf(viewer);
      const partner = gridPartnerSeat(layout, seats() as never);
      expect(partner).toBe((viewer + 2) % 4);
      const cells = gridCells(layout);
      const mine = cells.find((cell) => cell.seat === viewer)!;
      const theirs = cells.find((cell) => cell.seat === partner)!;
      expect(theirs.column).not.toBe(mine.column);
      expect(theirs.row).not.toBe(mine.row);
    }
  });

  it("is null for a spectator, and once the partner is out", () => {
    expect(gridPartnerSeat(layoutOf(null), seats() as never)).toBeNull();
    expect(gridPartnerSeat(layoutOf(0, [2]), seats([2]) as never)).toBeNull();
    expect(gridPartnerSeat(layoutOf(0, [1]), seats([1]) as never)).toBe(2);
  });
});

describe("grid geometry", () => {
  it("lays four equal fields in two columns, with the 180 turn on the top row", () => {
    const metrics = gridMetrics(5);
    const cells = gridCells(layoutOf(0));
    const poses = cells.map((cell) => gridPose(cell, metrics));
    expect(new Set(poses.map((pose) => pose.scale)).size).toBe(1);
    expect(poses.every((pose) => !pose.hidden && !pose.compact && !pose.docked)).toBe(true);
    const [bl, tl, tr, br] = poses;
    expect(bl.x).toBe(tl.x);
    expect(tr.x).toBe(br.x);
    expect(tl.y).toBe(tr.y);
    expect(bl.y).toBe(br.y);
    expect(tl.x).toBeLessThan(tr.x);
    expect(tl.y).toBeLessThan(bl.y);
    expect([bl.rotateDeg, tl.rotateDeg, tr.rotateDeg, br.rotateDeg]).toEqual([0, 180, 180, 0]);
  });

  it("fits two fields side by side in the 1100 wide stage, and every cell stays inside it", () => {
    for (const rule of [3, 4, 5] as const) {
      const metrics = gridMetrics(rule);
      expect(metrics.fieldWidth * 2).toBeLessThan(1100);
      for (const cell of gridCells(layoutOf(0))) {
        const { x, y } = cellCenter(cell, metrics);
        expect(x - metrics.fieldWidth / 2).toBeGreaterThanOrEqual(0);
        expect(x + metrics.fieldWidth / 2).toBeLessThanOrEqual(1100);
        expect(y + metrics.fieldHeight / 2).toBeLessThanOrEqual(metrics.height);
      }
    }
  });

  it("keeps the LP band between the facing fields and the four panels apart", () => {
    const metrics = gridMetrics(5);
    const cells = gridCells(layoutOf(0));
    const boxes = cells.map((cell) => {
      const { x, y } = lpAnchor(cell, metrics);
      return { seat: cell.seat, left: x, right: x + (cell.home ? LP_WIDTH_ME : LP_WIDTH), y };
    });
    for (const box of boxes) {
      expect(box.y).toBeGreaterThanOrEqual(metrics.bandTop);
      expect(box.y).toBeLessThan(metrics.bandTop + metrics.bandHeight);
    }
    const sorted = [...boxes].sort((a, b) => a.left - b.left);
    for (let index = 1; index < sorted.length; index += 1) expect(sorted[index].left).toBeGreaterThanOrEqual(sorted[index - 1].right);
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
