import type { DuelEngineView, DuelMasterRule } from "@yugidraft/shared/duels";
import type { TableFormat, TableLayout } from "./types";

/**
 * Layout of the 4-way grid table, pure. Four full fields sit in two columns of two. The two fields of a column FACE
 * each other and are partners (pairs 0+1 and 2+3). They share one row of two Extra Monster Zones in the middle band
 * between them, like the two sides of a 1v1 table, and the life boxes of the pair sit in that same band.
 *
 * `gridFocusLayout` is the one place that sizes and places the fields: it returns the final px rect of every field and
 * life box for a focus ("Stage and side"). The stage writes those rects as real sizes (never a zoom or a scale at
 * rest, so text stays sharp) and only animates between two layouts with a FLIP.
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
 * The seat that draws the shared Extra Monster row of a column: the `prefer` seat (the focused one) when it is in the
 * column and its cell is not empty, else the bottom field, or the top one while the bottom cell is empty. Null when
 * both cells are empty.
 */
export function pairDrawer(cells: readonly GridCell[], states: ReadonlyMap<number, CellState>, column: 0 | 1, prefer: number | null = null): number | null {
  const inColumn = cells.filter((cell) => cell.column === column).sort((a, b) => b.row - a.row);
  const shown = (cell: GridCell) => (states.get(cell.seat) ?? "live") !== "empty";
  const wanted = prefer != null ? inColumn.find((cell) => cell.seat === prefer) : undefined;
  if (wanted && shown(wanted)) return wanted.seat;
  return inColumn.find(shown)?.seat ?? null;
}

/* ------------------------------------------------------------------------------------------------------------ */
/* Geometry. Every measure is a share of the card height `z` of the field it belongs to.                          */
/* ------------------------------------------------------------------------------------------------------------ */

const FIELD_ZONES_WIDE: Record<number, number> = { 3: 7.35 };
const FIELD_ZONES_DEFAULT = 5.83;
const FIELD_ZONES_HIGH = 3.393;
/** Pad around the zone grid, one card row, the gap between card rows (field.module.css `.sfGrid`, `.seatField --gy`). */
const PAD = 0.125;
const ROW = 1;
const ROW_GAP = 0.071;
/**
 * How far the two fields of a pair overlap: the drawing field's pad and Extra Monster row, plus the gap to its
 * monster row. The other field's mat ends exactly there (field.module.css clips it at the same measure), so its
 * monster row is whole and the two mats meet with no seam.
 */
export const OVERLAP = PAD + ROW + ROW_GAP;
/** Room for a rival's hand backs above the top row (and below a rival's bottom row). Shares of that field's card height. */
const TOP_LANE = 0.62;
const RIVAL_BOTTOM_LANE = 0.62;
/**
 * Room for your hand below your row, as a share of the card height of your field, but never of more than the EQUAL
 * card height: the lane stops growing when your field is focused (a lane that grew with the focus cost the focus its
 * size). About 0.8 of the old 1.3 lane; the hand rises over the field's lower edge by `HAND_RISE` of its own height
 * instead of leaving a gap there.
 */
const HOME_LANE = 1.04;
/** Drawn height of your hand cards as a share of the equal card height (a field smaller than that draws a smaller hand). */
export const HAND_SHARE = 0.95;
/** How far your hand rises over the lower edge of your field, as a share of a hand card's height. */
export const HAND_RISE = 0.2;
const COLUMN_GAP = 0.34;
/** Card width of a zone, and the horizontal space the pile column and its gaps take on each side of the middle. */
const CARD_W = 0.686;
const EMZ_REGION_INSET = 1.0503;
/** Width of the viewer's life box and the gap between the two Extra Monster Zones. */
const LP_ME = 1.3;
const LP_GAP = 0.06;
/** Air between a life box and the Extra Monster Zone beside it. */
const LP_MARGIN = 0.05;
/** A life box is a share of the card height tall (the field width / 7.6), and never taller than this many px. */
const LP_HEIGHT = 0.767;
export const LP_MAX_HEIGHT = 76;
/** Free space round the whole table. */
const EDGE = 8;

/** Focused field and the other column, as a share of the equal 2x2 card size; the partner never goes below the minimum. */
export const FOCUS_SHARE = 1.3;
export const OTHER_SHARE = 0.8;
/** The other column gives up width down to this share so the focused field can reach its size on a box that is width-bound. */
export const OTHER_MIN_SHARE = 0.66;
export const PARTNER_MAX_SHARE = 0.8;
export const PARTNER_MIN_SHARE = 0.62;
/** A field narrower than this (px) is "small": no zone labels, ATK only. */
export const SMALL_FIELD_WIDTH = 520;

export interface GridWorld {
  masterRule: DuelMasterRule;
  /** Width of a field box in card heights. */
  zones: number;
}

export function gridWorld(masterRule: DuelMasterRule): GridWorld {
  return { masterRule, zones: FIELD_ZONES_WIDE[masterRule] ?? FIELD_ZONES_DEFAULT };
}

export interface GridRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface GridViewport {
  width: number;
  height: number;
}

export type GridFocusTarget = Pick<GridCell, "column" | "row">;

export interface GridLayoutOptions {
  /** Column of the viewer's own field: its bottom lane keeps room for the larger hand, and its life box is the wide one. */
  homeColumn?: 0 | 1;
  /**
   * Row of the field that draws the shared Extra Monster row of each column (1 = bottom). Default: the focused field
   * for its column (so the band sits under a focused top field), the bottom field everywhere else.
   */
  drawerRow?: readonly [0 | 1, 0 | 1];
}

export interface GridCellRect {
  column: 0 | 1;
  row: 0 | 1;
  /** Card height of this field in px (the field is `zones * z` wide). */
  z: number;
  /** The field box. */
  rect: GridRect;
  /** The field draws the shared Extra Monster row of its column. */
  drawer: boolean;
  small: boolean;
  /** Card height of a hand card of this field in px (only the home field draws a hand). */
  lh: number;
}

/**
 * The shared Extra Monster row of a column, left to right: [bottom life box] [Extra Monster] [gap] [Extra Monster]
 * [top life box]. The viewer's box is the wider one. `bottomRoom` and `topRoom` are the room of each life box in
 * card heights of the drawing field (what the field leaves free in its Extra Monster row).
 */
export interface GridBandRect {
  column: 0 | 1;
  /** Card height of the drawing field. */
  z: number;
  rect: GridRect;
  bottomLp: GridRect;
  topLp: GridRect;
  bottomRoom: number;
  topRoom: number;
}

export interface GridFocusLayout {
  /** Cells in the order column 0 top, column 0 bottom, column 1 top, column 1 bottom. */
  cells: GridCellRect[];
  bands: [GridBandRect, GridBandRect];
  /** Card heights in px: the equal 2x2 size, the focused field, its partner, and the fields of the other column. */
  sizes: { equal: number; focus: number; partner: number; other: number };
}

export const cellIndex = (cell: GridFocusTarget): number => cell.column * 2 + cell.row;

const round2 = (value: number) => Math.round(value * 100) / 100;
/** Left and top are whole px (a box on a half px blurs its text at rest); sizes keep two decimals. */
const rect = (x: number, y: number, width: number, height: number): GridRect => ({ x: Math.round(x), y: Math.round(y), width: round2(width), height: round2(height) });

/** Height of a column from the top of its top lane to the bottom of its bottom lane (px). The fields overlap by the Extra Monster rows. */
function columnHeight(zt: number, zb: number, drawerRow: 0 | 1, lane: number): number {
  const nonDrawer = drawerRow === 1 ? zt : zb;
  return (TOP_LANE + FIELD_ZONES_HIGH) * zt - OVERLAP * nonDrawer + FIELD_ZONES_HIGH * zb + lane;
}

function placeColumn(
  column: 0 | 1,
  zt: number,
  zb: number,
  drawerRow: 0 | 1,
  centerX: number,
  top: number,
  home: boolean,
  zones: number,
  equal: number,
): { cells: [GridCellRect, GridCellRect]; band: GridBandRect } {
  const topBox = rect(centerX - (zones * zt) / 2, top + TOP_LANE * zt, zones * zt, FIELD_ZONES_HIGH * zt);
  const overlap = OVERLAP * (drawerRow === 1 ? zt : zb);
  const bottomBox = rect(centerX - (zones * zb) / 2, topBox.y + topBox.height - overlap, zones * zb, FIELD_ZONES_HIGH * zb);
  const zd = drawerRow === 1 ? zb : zt;
  const box = drawerRow === 1 ? bottomBox : topBox;
  const rowTop = drawerRow === 1 ? box.y + PAD * zd : box.y + box.height - (PAD + ROW) * zd;
  const bandX = box.x + EMZ_REGION_INSET * zd;
  const bandWidth = box.width - 2 * EMZ_REGION_INSET * zd;
  const emz = 2 * CARD_W * zd;
  const gap = LP_GAP * zd;
  const bottomWidth = home ? LP_ME * zd : (bandWidth - emz - gap) / 2;
  const topWidth = bandWidth - emz - gap - bottomWidth;
  const lpHeight = Math.min(LP_HEIGHT * zd, LP_MAX_HEIGHT);
  const lpTop = rowTop + (ROW * zd - lpHeight) / 2;
  const band: GridBandRect = {
    column,
    z: round2(zd),
    rect: rect(bandX, rowTop, bandWidth, ROW * zd),
    bottomLp: rect(bandX, lpTop, bottomWidth - LP_MARGIN * zd, lpHeight),
    topLp: rect(bandX + bandWidth - topWidth + LP_MARGIN * zd, lpTop, topWidth - LP_MARGIN * zd, lpHeight),
    bottomRoom: round2(bottomWidth / zd),
    topRoom: round2(topWidth / zd),
  };
  const cell = (row: 0 | 1, box: GridRect, z: number): GridCellRect => ({
    column,
    row,
    z: round2(z),
    rect: box,
    drawer: drawerRow === row,
    small: box.width < SMALL_FIELD_WIDTH,
    lh: round2(HAND_SHARE * Math.min(z, equal)),
  });
  return { cells: [cell(0, topBox, zt), cell(1, bottomBox, zb)], band };
}

/**
 * The final layout of the grid in a box ("Stage and side"), pure. `focus` null = all fields: an equal 2x2. A focus =
 * that field about 1.3x the equal size, its partner (the other field of its column) smaller above or below it with
 * the shared Extra Monster row between them, and the other column at about 0.8x (down to 0.66x on a box that is narrow). Each field stays inside its own
 * column and all four are always whole inside the box. The partner never goes under 0.62x: when the column is too
 * short for 1.3x, the focused field gives up size instead.
 */
export function gridFocusLayout(world: GridWorld, viewport: GridViewport, focus: GridFocusTarget | null, options: GridLayoutOptions = {}): GridFocusLayout {
  const { zones } = world;
  const homeColumn = options.homeColumn ?? 0;
  const width = Math.max(0, viewport.width - 2 * EDGE);
  const height = Math.max(0, viewport.height - 2 * EDGE);
  const drawerOf = (column: 0 | 1): 0 | 1 => options.drawerRow?.[column] ?? (focus && focus.column === column ? focus.row : 1);

  // The equal 2x2: both columns as tall as the one with the larger hand lane, so the rows line up.
  const equal = Math.max(0, Math.min(width / (2 * zones + COLUMN_GAP), height / columnHeight(1, 1, 1, HOME_LANE)));
  const gap = COLUMN_GAP * equal;
  const homeLane = HOME_LANE * equal;
  const laneOf = (column: 0 | 1, zb: number) => (column === homeColumn ? HOME_LANE * Math.min(zb, equal) : RIVAL_BOTTOM_LANE * zb);
  const place = (column: 0 | 1, zt: number, zb: number, centerX: number, top: number) =>
    placeColumn(column, zt, zb, drawerOf(column), centerX, top, column === homeColumn, zones, equal);

  let sizes = { equal, focus: equal, partner: equal, other: equal };
  const columns: { cells: [GridCellRect, GridCellRect]; band: GridBandRect }[] = [];
  if (!focus) {
    const x0 = EDGE + (width - (2 * zones * equal + gap)) / 2;
    const top = EDGE + (height - columnHeight(equal, equal, 1, homeLane)) / 2;
    columns[0] = place(0, equal, equal, x0 + (zones * equal) / 2, top);
    columns[1] = place(1, equal, equal, x0 + zones * equal + gap + (zones * equal) / 2, top);
  } else {
    const fc = focus.column;
    const oc: 0 | 1 = fc === 0 ? 1 : 0;
    const drawerRow = drawerOf(fc);
    // Column height grows with both sizes. The partner's share is solved from it (affine in the partner's size).
    const heightOf = (zs: number, zp: number) => {
      const zt = focus.row === 1 ? zp : zs;
      const zb = focus.row === 1 ? zs : zp;
      return columnHeight(zt, zb, drawerRow, laneOf(fc, zb));
    };
    const widthCap = (width - gap - zones * OTHER_MIN_SHARE * equal) / zones;
    const focusMax = Math.min(FOCUS_SHARE * equal, widthCap);
    const partnerFor = (zs: number) => {
      const base = heightOf(zs, 0);
      return (height - base) / (heightOf(zs, 1) - base);
    };
    const partnerMin = PARTNER_MIN_SHARE * equal;
    let zs = focusMax;
    let zp = Math.min(PARTNER_MAX_SHARE * equal, partnerFor(zs));
    if (zp < partnerMin) {
      // The column is too short: the partner stays at its minimum and the focused field gives up size (bisection:
      // the height only grows with the focused size).
      zp = partnerMin;
      let lo = partnerMin;
      let hi = focusMax;
      if (heightOf(hi, zp) <= height) lo = hi;
      else for (let step = 0; step < 40; step++) {
        const mid = (lo + hi) / 2;
        if (heightOf(mid, zp) <= height) lo = mid;
        else hi = mid;
      }
      zs = Math.max(partnerMin, lo);
    }
    const other = Math.min(OTHER_SHARE * equal, (width - gap - zones * zs) / zones);
    sizes = { equal, focus: zs, partner: zp, other };
    const total = zones * zs + gap + zones * other;
    const x0 = EDGE + (width - total) / 2;
    const focusX = fc === 0 ? x0 + (zones * zs) / 2 : x0 + zones * other + gap + (zones * zs) / 2;
    const otherX = fc === 0 ? x0 + zones * zs + gap + (zones * other) / 2 : x0 + (zones * other) / 2;
    const focusTop = EDGE + (height - heightOf(zs, zp)) / 2;
    const otherTop = EDGE + (height - columnHeight(other, other, drawerOf(oc), laneOf(oc, other))) / 2;
    columns[fc] = focus.row === 1 ? place(fc, zp, zs, focusX, focusTop) : place(fc, zs, zp, focusX, focusTop);
    columns[oc] = place(oc, other, other, otherX, otherTop);
  }
  return {
    cells: [...columns[0].cells, ...columns[1].cells],
    bands: [columns[0].band, columns[1].band],
    sizes: { equal: round2(sizes.equal), focus: round2(sizes.focus), partner: round2(sizes.partner), other: round2(sizes.other) },
  };
}
