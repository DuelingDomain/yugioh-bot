import { sharedExtraSeatOf, type DuelEngineView, type DuelMasterRule } from "@yugidraft/shared/duels";
import { SEAT_Z, STAGE } from "./geometry";
import { isOut } from "./seat-state";
import type { SeatPose, TableFormat, TableLayout } from "./types";

/**
 * Layout of the 4-way grid table, pure. Four full fields sit in a 2 by 2 grid, like two 1v1 boards side by side.
 * The stage is 1100 stage px wide (the width every table stage uses, so the attack line and the tethers measure
 * the same way); its height follows from the rows. Reading order is turn order: you bottom-left, the seat after you
 * top-left, then top-right, then bottom-right. The top fields turn 180 degrees, as a 1v1 opponent does.
 */

export type GridQuadrant = "bl" | "tl" | "tr" | "br";

export interface GridCell {
  seat: number;
  quadrant: GridQuadrant;
  /** 0 = left pair, 1 = right pair. */
  column: 0 | 1;
  /** 0 = top row (turned 180), 1 = bottom row. */
  row: 0 | 1;
  rotateDeg: 0 | 180;
  /** The viewer's own cell (bottom-left). A spectator's anchor seat fills it too. */
  home: boolean;
}

/** Quadrant by place in `TableLayout.slots` (viewer or anchor first, then turn order). */
const QUADRANTS: readonly { quadrant: GridQuadrant; column: 0 | 1; row: 0 | 1 }[] = [
  { quadrant: "bl", column: 0, row: 1 },
  { quadrant: "tl", column: 0, row: 0 },
  { quadrant: "tr", column: 1, row: 0 },
  { quadrant: "br", column: 1, row: 1 },
];

/**
 * The one place that decides whether a table draws the grid. Today: every 4-seat free-for-all, for the whole duel.
 * An out seat keeps its cell (the field crumbles, then the cell stays empty), so the seat count never changes it.
 */
export function usesGridLayout(format: TableFormat | "1v1", seats: readonly unknown[]): boolean {
  return format === "ffa4" && seats.length === 4;
}

/** The cell of every seat of the layout, in layout order. Spectators have seat 0 (the anchor) at bottom-left. */
export function gridCells(layout: Pick<TableLayout, "slots">): GridCell[] {
  return layout.slots.slice(0, QUADRANTS.length).map((slot, place) => {
    const at = QUADRANTS[place];
    return { seat: slot.seat, ...at, rotateDeg: at.row === 0 ? 180 : 0, home: place === 0 };
  });
}

/**
 * The viewer's column and Extra Monster Zone partner (ADR 0002, R-FFA-ACROSS-EMZ: seat + 2, so 0/2 and 1/3). In
 * this grid that is the diagonal field. Null for a spectator, and while that seat is out or leaving.
 */
export function gridPartnerSeat(layout: Pick<TableLayout, "viewerSeat">, seats: DuelEngineView["seats"]): number | null {
  if (layout.viewerSeat == null) return null;
  const out = new Set(seats.filter((view) => isOut(view)).map((view) => view.seat));
  return sharedExtraSeatOf("ffa4", layout.viewerSeat, out);
}

/** Stage px metrics of the grid. */
export interface GridMetrics {
  /** Drawn scale of a field (a field is laid out at `SEAT_Z`). */
  scale: number;
  fieldWidth: number;
  fieldHeight: number;
  /** Stage height needed for the rows, the middle band and the two hand lanes. */
  height: number;
  /** Tilt of the whole grid plane, in degrees (a little depth, not the plaza). */
  tiltDeg: number;
  bandTop: number;
  bandHeight: number;
}

const OUTER = 6;
const COLUMN_GAP = 10;
const BAND = 118;
/** Card backs of a top rival hang this far over the top edge. */
const TOP_LANE = 58;
/** The viewer's hand, and the backs of the bottom-right rival, below the bottom row. */
const BOTTOM_LANE = 104;
const FIELD_ZONES_WIDE: Record<number, number> = { 3: 7.35 };
const FIELD_ZONES_HIGH = 3.393;
const FIELD_ZONES_DEFAULT = 5.83;

export function gridMetrics(masterRule: DuelMasterRule): GridMetrics {
  const zonesWide = FIELD_ZONES_WIDE[masterRule] ?? FIELD_ZONES_DEFAULT;
  const scale = (STAGE.width - OUTER * 2 - COLUMN_GAP) / (2 * zonesWide * SEAT_Z);
  const fieldWidth = zonesWide * SEAT_Z * scale;
  const fieldHeight = FIELD_ZONES_HIGH * SEAT_Z * scale;
  const height = Math.round(TOP_LANE + fieldHeight * 2 + BAND + BOTTOM_LANE);
  return { scale, fieldWidth, fieldHeight, height, tiltDeg: 6, bandTop: Math.round(TOP_LANE + fieldHeight), bandHeight: BAND };
}

/** Centre of a cell in stage px. */
export function cellCenter(cell: Pick<GridCell, "column" | "row">, metrics: GridMetrics): { x: number; y: number } {
  const x = OUTER + metrics.fieldWidth / 2 + cell.column * (metrics.fieldWidth + COLUMN_GAP);
  const y = TOP_LANE + metrics.fieldHeight / 2 + cell.row * (metrics.fieldHeight + BAND);
  return { x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100 };
}

export function gridPose(cell: GridCell, metrics: GridMetrics): SeatPose {
  const { x, y } = cellCenter(cell, metrics);
  return {
    seat: cell.seat,
    x,
    y,
    scale: metrics.scale,
    rotateDeg: cell.rotateDeg,
    z: SEAT_Z,
    docked: false,
    compact: false,
    hidden: false,
  };
}

/** Width of a holo LP panel (stage px). The viewer's own panel is a little wider. */
export const LP_WIDTH = 196;
export const LP_WIDTH_ME = 212;
const LP_HEIGHT = 96;
const LP_GAP = 8;

/**
 * Top-left of the LP panel of a cell, in the middle band between the facing pair. The seat of the top row sits left
 * of the column centre and the seat of the bottom row right of it, so you and your column partner meet at the
 * seam between the columns.
 */
export function lpAnchor(cell: Pick<GridCell, "column" | "row" | "home">, metrics: GridMetrics): { x: number; y: number } {
  const { x: centre } = cellCenter(cell, metrics);
  const width = cell.home ? LP_WIDTH_ME : LP_WIDTH;
  const x = cell.row === 0 ? centre - LP_GAP / 2 - width : centre + LP_GAP / 2;
  const y = metrics.bandTop + (metrics.bandHeight - LP_HEIGHT) / 2;
  return { x: Math.round(x), y: Math.round(y) };
}

export type CellState = "live" | "out" | "empty";

/** How long an out field stays drawn (greyed, with its label) while it crumbles; after that its cell is empty. */
export const OUT_HOLD_MS = 2600;

/**
 * State of a cell. A seat in the duel is `live`. A seat that just went out keeps its field mounted as `out` (the
 * crumble layer renders in it); once it has been out for `OUT_HOLD_MS`, or it was already out when the table
 * opened (`outSince` null), the cell is `empty`: nothing drawn, nothing to target. The other cells never move.
 */
export function cellState(view: Pick<DuelEngineView["seats"][number], "eliminated" | "pendingElimination"> | undefined, outSince: number | null, now: number): CellState {
  if (view?.eliminated !== true) return "live";
  if (outSince == null) return "empty";
  return now - outSince >= OUT_HOLD_MS ? "empty" : "out";
}
