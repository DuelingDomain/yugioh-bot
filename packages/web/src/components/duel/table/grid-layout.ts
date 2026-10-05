import type { DuelEngineView, DuelMasterRule } from "@yugidraft/shared/duels";
import { SEAT_Z } from "./geometry";
import type { SeatPose, TableFormat, TableLayout } from "./types";

/**
 * Layout of the 4-way grid table, pure. Four full fields sit in two columns of two. The two fields of a column FACE
 * each other and are partners (pairs 0+1 and 2+3). They share one row of two Extra Monster Zones in the middle band
 * between them, like the two sides of a 1v1 table, and the life boxes of the pair sit in that same band.
 *
 * Sizes here are "natural" px: a field is laid out at `SEAT_Z` (card height 112 px). The stage shows the world at a
 * zoom (`gridView`); it never scales a layer with a transform, so text stays sharp.
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
  /** The facing seat of the same column: it shares the Extra Monster row with this one. */
  partner: number;
}

/**
 * The partner of a seat. The ONE place that knows the pairing: the facing seats, 0+1 and 2+3. (The engine's own
 * "across" seat for the shared Extra Monster Zone is a different rule that the engine owns; the grid draws this one.)
 */
export const gridPartnerOf = (seat: number): number => seat ^ 1;

/**
 * Who sits where, seen from `viewer` (a spectator sees the table from seat 0). You are always bottom-left with your
 * partner in front of you (top-left); the other pair is on the right, turned the same way:
 * BL = v, TL = v ^ 1, BR = 3 - v, TR = (3 - v) ^ 1.
 */
export function gridPlacement(viewer: number | null): Record<GridQuadrant, number> {
  const v = viewer != null && viewer >= 0 && viewer <= 3 ? viewer : 0;
  const rivals = 3 - v;
  return { bl: v, tl: gridPartnerOf(v), br: rivals, tr: gridPartnerOf(rivals) };
}

const QUADRANTS: Record<GridQuadrant, { column: 0 | 1; row: 0 | 1 }> = {
  bl: { column: 0, row: 1 },
  tl: { column: 0, row: 0 },
  tr: { column: 1, row: 0 },
  br: { column: 1, row: 1 },
};

/**
 * The one place that decides whether a table draws the grid. Today: every 4-seat free-for-all, for the whole duel.
 * An out seat keeps its cell (the field crumbles, then the cell stays empty), so the seat count never changes it.
 */
export function usesGridLayout(format: TableFormat | "1v1", seats: readonly unknown[]): boolean {
  return format === "ffa4" && seats.length === 4;
}

/** The cell of every seat of the layout. Spectators have seat 0 (the anchor) at bottom-left. */
export function gridCells(layout: Pick<TableLayout, "slots" | "viewerSeat">): GridCell[] {
  const placement = gridPlacement(layout.viewerSeat);
  const present = new Set(layout.slots.map((slot) => slot.seat));
  return (Object.keys(QUADRANTS) as GridQuadrant[])
    .filter((quadrant) => present.has(placement[quadrant]))
    .map((quadrant) => {
      const at = QUADRANTS[quadrant];
      const seat = placement[quadrant];
      return { seat, quadrant, ...at, rotateDeg: at.row === 0 ? 180 : 0, home: quadrant === "bl", partner: gridPartnerOf(seat) };
    });
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

/**
 * The seat that draws the shared Extra Monster row of a column: the bottom field, or the top one while the bottom
 * cell is empty. Null when both cells are empty.
 */
export function pairDrawer(cells: readonly GridCell[], states: ReadonlyMap<number, CellState>, column: 0 | 1): number | null {
  const inColumn = cells.filter((cell) => cell.column === column).sort((a, b) => b.row - a.row);
  return inColumn.find((cell) => (states.get(cell.seat) ?? "live") !== "empty")?.seat ?? null;
}

/* ------------------------------------------------------------------------------------------------------------ */
/* Geometry, in natural px (zoom 1). Every measure below is a share of the card height `z = SEAT_Z`.              */
/* ------------------------------------------------------------------------------------------------------------ */

const Z = SEAT_Z;
const FIELD_ZONES_WIDE: Record<number, number> = { 3: 7.35 };
const FIELD_ZONES_DEFAULT = 5.83;
const FIELD_ZONES_HIGH = 3.393;
/** Pad around the zone grid, one card row, the gap between card rows (field.module.css `.sfGrid`). */
const PAD = 0.125;
const ROW = 1;
const ROW_GAP = 0.071;
/** Room for a rival's hand backs above the top row, and for your hand below the bottom row. */
const TOP_LANE = 0.62;
const BOTTOM_LANE = 1.3;
const COLUMN_GAP = 0.34;
const SIDE = 0.16;
/** Card width of a zone, and the horizontal space the pile column and its gaps take on each side of the middle. */
const CARD_W = 0.686;
const EMZ_REGION_INSET = 1.0503;
/** Width of the viewer's life box and the gap between the two Extra Monster Zones. */
const LP_ME = 1.3;
const LP_GAP = 0.06;
/** Air between a life box and the Extra Monster Zone beside it. */
const LP_MARGIN = 0.05;
const LP_HEIGHT = 0.9;

export interface GridWorld {
  masterRule: DuelMasterRule;
  /** Natural px of the field box. */
  fieldWidth: number;
  fieldHeight: number;
  /** Top-left y of the bottom field below the top field box (the fields overlap by one Extra Monster row). */
  bottomOffset: number;
  /** Size of the whole world: lanes, both columns and the gap. */
  width: number;
  height: number;
  columnGap: number;
  side: number;
  topLane: number;
  bottomLane: number;
  /** Where the shared Extra Monster row sits: top y (world) and height. */
  bandTop: number;
  bandHeight: number;
}

export function gridWorld(masterRule: DuelMasterRule): GridWorld {
  const zones = FIELD_ZONES_WIDE[masterRule] ?? FIELD_ZONES_DEFAULT;
  const fieldWidth = zones * Z;
  const fieldHeight = FIELD_ZONES_HIGH * Z;
  const bottomOffset = fieldHeight - (2 * PAD + ROW) * Z;
  const topLane = TOP_LANE * Z;
  const bottomLane = BOTTOM_LANE * Z;
  const side = SIDE * Z;
  const columnGap = COLUMN_GAP * Z;
  return {
    masterRule,
    fieldWidth,
    fieldHeight,
    bottomOffset,
    width: side * 2 + fieldWidth * 2 + columnGap,
    height: topLane + bottomOffset + fieldHeight + bottomLane,
    columnGap,
    side,
    topLane,
    bottomLane,
    bandTop: topLane + fieldHeight - (PAD + ROW) * Z,
    bandHeight: ROW * Z,
  };
}

/** Top-left of the field box of a cell, natural px. */
export function cellOrigin(cell: Pick<GridCell, "column" | "row">, world: GridWorld): { x: number; y: number } {
  return {
    x: world.side + cell.column * (world.fieldWidth + world.columnGap),
    y: world.topLane + (cell.row === 1 ? world.bottomOffset : 0),
  };
}

export function cellCenter(cell: Pick<GridCell, "column" | "row">, world: GridWorld): { x: number; y: number } {
  const { x, y } = cellOrigin(cell, world);
  return { x: round2(x + world.fieldWidth / 2), y: round2(y + world.fieldHeight / 2) };
}

const round2 = (value: number) => Math.round(value * 100) / 100;

export function gridPose(cell: GridCell, world: GridWorld): SeatPose {
  const { x, y } = cellCenter(cell, world);
  return { seat: cell.seat, x, y, scale: 1, rotateDeg: cell.rotateDeg, z: SEAT_Z, docked: false, compact: false, hidden: false };
}

/**
 * The middle band of a column, in world px, left to right: [bottom life box] [Extra Monster] [gap] [Extra Monster]
 * [top life box]. The viewer's box is the wider one. The field that draws the row leaves `bottomRoom` free on its left
 * and `topRoom` on its right when it is the bottom field; the top field (turned 180 degrees) the other way round.
 */
export interface GridBand {
  x: number;
  y: number;
  width: number;
  height: number;
  bottomLp: { x: number; width: number };
  topLp: { x: number; width: number };
  emzGap: number;
  /** The room of each life box in card heights (what a field leaves free in its Extra Monster row). */
  bottomRoom: number;
  topRoom: number;
}

export function gridBand(column: 0 | 1, home: boolean, world: GridWorld): GridBand {
  const x = world.side + column * (world.fieldWidth + world.columnGap) + EMZ_REGION_INSET * Z;
  const width = world.fieldWidth - 2 * EMZ_REGION_INSET * Z;
  const emz = 2 * CARD_W * Z;
  const gap = LP_GAP * Z;
  const bottomWidth = home ? LP_ME * Z : (width - emz - gap) / 2;
  const topWidth = width - emz - gap - bottomWidth;
  return {
    x: round2(x),
    y: round2(world.bandTop),
    width: round2(width),
    height: world.bandHeight,
    bottomLp: { x: round2(x), width: round2(bottomWidth - LP_MARGIN * Z) },
    topLp: { x: round2(x + width - topWidth + LP_MARGIN * Z), width: round2(topWidth - LP_MARGIN * Z) },
    emzGap: round2(gap),
    bottomRoom: round2(bottomWidth / Z),
    topRoom: round2(topWidth / Z),
  };
}

/** Top-left and width of the life box of a cell, natural px. */
export function lpBox(cell: Pick<GridCell, "column" | "row">, home: boolean, world: GridWorld): { x: number; y: number; width: number; height: number } {
  const band = gridBand(cell.column, home, world);
  const box = cell.row === 1 ? band.bottomLp : band.topLp;
  const height = LP_HEIGHT * Z;
  return { x: box.x, y: round2(band.y + (band.height - height) / 2), width: box.width, height };
}

/* ------------------------------------------------------------------------------------------------------------ */
/* The view: where the camera looks. Pure; the stage animates between two views.                                  */
/* ------------------------------------------------------------------------------------------------------------ */

export interface GridView {
  /** Zoom of the world (1 = natural px). */
  zoom: number;
  /** Screen px of the world origin. */
  x: number;
  y: number;
}

export interface GridViewport {
  width: number;
  height: number;
}

/** Share of the box width the focused field may fill. The rest shows the next column, cut off by the edge. */
const FOCUS_WIDTH_SHARE = 0.74;
const FOCUS_HEIGHT_SHARE = 0.97;
const EDGE = 8;
export const ZOOM_MUL_MIN = 0.6;
export const ZOOM_MUL_MAX = 1.5;

/** The zoom that fits the whole world. */
export function fitZoom(world: GridWorld, viewport: GridViewport): number {
  if (!(viewport.width > 0 && viewport.height > 0)) return 1;
  return Math.min((viewport.width - 2 * EDGE) / world.width, (viewport.height - 2 * EDGE) / world.height);
}

function clampAxis(offset: number, extent: number, box: number): number {
  const min = box - extent - EDGE;
  const max = EDGE;
  if (min > max) return (box - extent) / 2;
  return Math.min(max, Math.max(min, offset));
}

/**
 * The view of a focus. `null` = all fields (the whole world, centred). A cell = that field with its half of the
 * middle band and its hand lane big (bottom cells: down to the hand; top cells: up to the rival's hand backs), the
 * rest of the world cut off by the box edge. `mul` is the player's +/- zoom (1 = default size).
 */
export function gridView(world: GridWorld, viewport: GridViewport, focus: Pick<GridCell, "column" | "row"> | null, mul = 1): GridView {
  const fit = fitZoom(world, viewport);
  const centre = (zoom: number): GridView => ({
    zoom,
    x: round2((viewport.width - world.width * zoom) / 2),
    y: round2((viewport.height - world.height * zoom) / 2),
  });
  if (!focus) return centre(fit);

  const origin = cellOrigin(focus, world);
  const top = focus.row === 1 ? origin.y : 0;
  const bottom = focus.row === 1 ? world.height : origin.y + world.fieldHeight;
  const byWidth = (viewport.width * FOCUS_WIDTH_SHARE) / world.fieldWidth;
  const byHeight = (viewport.height * FOCUS_HEIGHT_SHARE) / (bottom - top);
  const base = Math.max(fit, Math.min(byWidth, byHeight));
  const zoom = Math.max(fit, base * Math.min(ZOOM_MUL_MAX, Math.max(ZOOM_MUL_MIN, mul)));
  const cx = origin.x + world.fieldWidth / 2;
  const cy = (top + bottom) / 2;
  return {
    zoom,
    x: round2(clampAxis(viewport.width / 2 - cx * zoom, world.width * zoom, viewport.width)),
    y: round2(clampAxis(viewport.height / 2 - cy * zoom, world.height * zoom, viewport.height)),
  };
}
