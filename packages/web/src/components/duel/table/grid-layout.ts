import type { DuelEngineView, DuelMasterRule } from "@yugidraft/shared/duels";
import type { TableFormat, TableLayout } from "./types";

/**
 * Layout of the 4-way grid table, pure ("Pair lift"). Four full fields sit in two columns of two. The two fields of a
 * column FACE each other and are partners (pairs 0+1 and 2+3). They share one row of two Extra Monster Zones in the
 * middle band between them, over the 2nd and 4th monster columns, like the two sides of a 1v1 table. The life plates
 * sit above and below the pair, not in the band, so the free cells of the band are free for the phase hub.
 *
 * `gridFocusLayout` is the one place that sizes and places the fields: it returns the final px rect of every field and
 * life plate for a focus. The focus lifts the whole pair (about 1.12x of the rest size, by the column width); the other
 * pair keeps its size or gives up a little width. With two seats left (`finale`) they are laid out as one full 1v1
 * board in the middle, with both plates on its left, as in the 1v1 room; the other fields are gone. The stage writes those rects as real sizes (never a zoom or a scale at rest, so
 * text stays sharp) and only animates between two layouts with a FLIP.
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
 * The seat that draws the shared Extra Monster row of a column: the bottom field, or the top one while the bottom cell
 * is empty. It does NOT follow the focus: the zones stay mounted in the same field, so an effect that plays on one never
 * loses its node when the focus moves. (`prefer` names a seat that wins when it is in the column and not empty; the
 * stage does not use it.) Null when both cells are empty.
 */
export function pairDrawer(cells: readonly GridCell[], states: ReadonlyMap<number, CellState>, column: 0 | 1, prefer: number | null = null): number | null {
  const inColumn = cells.filter((cell) => cell.column === column).sort((a, b) => b.row - a.row);
  const live = (cell: GridCell) => (states.get(cell.seat) ?? "live") === "live";
  const wanted = prefer != null ? inColumn.find((cell) => cell.seat === prefer) : undefined;
  if (wanted && live(wanted)) return wanted.seat;
  return inColumn.find(live)?.seat ?? null;
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
/** A life plate is this tall and wide (shares of the card height of its field), with a little air to the field. */
export const PLATE_H = 0.66;
export const PLATE_W = 1.9;
const PLATE_GAP = 0.04;
/**
 * Room above the top row for a rival's hand backs and the life plate that sits in the same lane (and below a rival's
 * bottom row). Shares of that field's card height.
 */
const TOP_LANE = PLATE_H + PLATE_GAP;
const RIVAL_BOTTOM_LANE = PLATE_H + PLATE_GAP;
/**
 * Room for your hand below your row, as a share of the card height of your field, but never of more than the base card
 * height: the lane does not grow when your pair is lifted (a lane that grew with the focus cost the focus its size).
 */
const HOME_LANE = 1.04;
/** Drawn height of your hand cards as a share of the base card height (a field smaller than that draws a smaller hand). */
export const HAND_SHARE = 0.95;
/**
 * How far your hand rises over the lower edge of your field, in card heights of that field. The field has a pad of 0.125
 * under its Spell/Trap row, so the hand covers only the last HAND_OVER of a zone: at rest the zones stay clickable.
 */
export const HAND_OVER = 0.06;
export const HAND_RISE = PAD + HAND_OVER;
/** The hand sits to the right of the plate that shares its lane (a share of the card height), over this width. */
export const HAND_SHIFT = PLATE_W / 2;
export const HAND_WIDTH = FIELD_ZONES_DEFAULT - PLATE_W;
const COLUMN_GAP = 0.34;
/** The shared Extra Monster Zones sit over the 2nd and 4th monster columns: the room left of the first, and between them. */
export const PAIR_LEFT = 0.761;
export const PAIR_GAP = 0.836;
/** Share of a card height of the monster zone column gap, and of the room the Extra Monster region leaves each side. */
const EMZ_REGION_INSET = 1.0503;
/** Free space round the whole table. */
const EDGE = 8;

/** The pair of the viewer lifts to this share of the rest size (by the column width), never under MIN when height-bound. */
export const PAIR_FOCUS = 1.12;
export const PAIR_FOCUS_MIN = 1.06;
/** The other pair gives up width down to this share of the rest size so the lifted pair can reach its size. */
export const OTHER_MIN_SHARE = 0.66;
/** A field narrower than this (px) is "small": no zone labels, ATK only. */
export const SMALL_FIELD_WIDTH = 520;

/** The finale: one board with the plates on its left (shares of the card height); the same room is kept on its right. */
export const FINALE_SIDE = 2;
export const FINALE_GAP = 0.22;
/**
 * How far the two fields of a cross finale overlap: only their pads. Each keeps its own Extra Monster row (the engine
 * gives two seats of different pairs no shared zones), so the two rows lie face to face in a double band.
 */
export const CROSS_OVERLAP = PAD;

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
  /**
   * Column of the viewer's own field: its bottom lane keeps room for the larger hand. `null` is a spectator: no own
   * field, so no larger lane (the hands are all rival backs). Default 0.
   */
  homeColumn?: 0 | 1 | null;
  /**
   * Row of the field that draws the shared Extra Monster row of each column (1 = bottom). Default: the bottom field.
   * It follows the live seat (see `pairDrawer`); the band is sized from the drawer and only moves with it.
   */
  drawerRow?: readonly [0 | 1, 0 | 1];
  /**
   * The last two seats: laid out as one full board in the middle (the 1v1 composition), `bottom` turned 0 and `top`
   * turned 180. Two cells of one column share the Extra Monster row; two of different columns each keep their own.
   * `homeHand`: the bottom seat is yours and draws your hand (its lane is the larger one).
   */
  finale?: GridFinaleCells | null;
}

export interface GridFinaleCells {
  bottom: GridFocusTarget;
  top: GridFocusTarget;
  homeHand: boolean;
}

export interface GridCellRect {
  column: 0 | 1;
  row: 0 | 1;
  /** The turn of the field: 180 on the top row, and for the top seat of the finale board; else 0. */
  turn: 0 | 180;
  /** Card height of this field in px (the field is `zones * z` wide). */
  z: number;
  /** The field box. */
  rect: GridRect;
  /** The field draws the shared Extra Monster row of its column. */
  drawer: boolean;
  small: boolean;
  /** Card height of a hand card of this field in px (only the home field draws a hand). */
  lh: number;
  /** The life plate of this seat. */
  plate: GridRect;
  /** Where the hand of this field sits: the shift of its centre and its width, in card heights of the field. */
  hand: { shift: number; width: number };
  /** The part of the box that is this seat's own (the board without the shared Extra Monster row), for the out outline. */
  own: GridRect;
}

/** The shared Extra Monster row of a column: the five monster columns wide, one card tall, between the two fields. */
export interface GridBandRect {
  column: 0 | 1;
  /** Card height of the drawing field. */
  z: number;
  rect: GridRect;
}

/** The finale board: one frame round both fields, and the Extra Monster row where the phase hub sits (the bottom seat's). */
export interface GridFinaleRect {
  kind: "same" | "cross";
  frame: GridRect;
  band: GridBandRect;
}

export interface GridFocusLayout {
  /** Cells in the order column 0 top, column 0 bottom, column 1 top, column 1 bottom. */
  cells: GridCellRect[];
  bands: [GridBandRect, GridBandRect];
  /** The cells as they lie without the finale board (the same as `cells` when there is no finale). */
  regular: GridCellRect[];
  /** Card heights in px: all fields equal, the rest size, the lifted pair, and the pair that is not lifted. */
  sizes: { equal: number; rest: number; focus: number; other: number };
  /** The finale board, else null. */
  finale: GridFinaleRect | null;
}

export const cellIndex = (cell: GridFocusTarget): number => cell.column * 2 + cell.row;

const round2 = (value: number) => Math.round(value * 100) / 100;
/** Left and top are whole px (a box on a half px blurs its text at rest); sizes keep two decimals. */
const rect = (x: number, y: number, width: number, height: number): GridRect => ({ x: Math.round(x), y: Math.round(y), width: round2(width), height: round2(height) });

/** Height of a column from the top of its top lane to the bottom of its bottom lane (px). The fields overlap by the Extra Monster rows. */
function columnHeight(z: number, drawerRow: 0 | 1, lane: number): number {
  return (TOP_LANE + FIELD_ZONES_HIGH) * z - OVERLAP * z + FIELD_ZONES_HIGH * z + lane;
}

interface PlacedColumn {
  cells: [GridCellRect, GridCellRect];
  band: GridBandRect;
}

/** The box round two rects. */
function union(a: GridRect, b: GridRect): GridRect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return rect(x, y, Math.max(a.x + a.width, b.x + b.width) - x, Math.max(a.y + a.height, b.y + b.height) - y);
}

/** Height of the finale board from the top of its top lane to the bottom of its bottom lane (px; `lane` in card heights). */
function finaleHeight(z: number, overlap: number, lane: number): number {
  return (TOP_LANE + 2 * FIELD_ZONES_HIGH - overlap + lane) * z;
}

/**
 * The finale board in the box: the bottom seat under the top seat, in the middle, both plates on the left (the 1v1
 * room). The fields of one pair overlap by the shared Extra Monster row; two of different pairs only by their pads.
 */
function placeFinale(finale: GridFinaleCells, zones: number, edge: number, width: number, height: number): { top: GridCellRect; bottom: GridCellRect; rect: GridFinaleRect } {
  const same = finale.bottom.column === finale.top.column;
  const overlap = same ? OVERLAP : CROSS_OVERLAP;
  const lane = finale.homeHand ? HOME_LANE : RIVAL_BOTTOM_LANE;
  const z = Math.max(0, Math.min(height / finaleHeight(1, overlap, lane), width / (zones + 2 * (FINALE_SIDE + FINALE_GAP))));
  const top0 = edge + (height - finaleHeight(z, overlap, lane)) / 2;
  const x = edge + width / 2 - (zones * z) / 2;
  const topBox = rect(x, top0 + TOP_LANE * z, zones * z, FIELD_ZONES_HIGH * z);
  const bottomBox = rect(x, topBox.y + topBox.height - overlap * z, zones * z, FIELD_ZONES_HIGH * z);
  const plateX = x - (FINALE_GAP + FINALE_SIDE) * z;
  const bottomPlate = rect(plateX, bottomBox.y + bottomBox.height - PLATE_H * z, FINALE_SIDE * z, PLATE_H * z);
  const topPlate = rect(plateX, topBox.y, FINALE_SIDE * z, PLATE_H * z);
  // Of one pair, the top field's own part ends where the shared row begins; of two pairs each field is whole.
  const ownTop = same ? rect(topBox.x, topBox.y, topBox.width, topBox.height - OVERLAP * z) : topBox;
  const ownBottom = same ? rect(bottomBox.x, bottomBox.y + OVERLAP * z, bottomBox.width, bottomBox.height - OVERLAP * z) : bottomBox;
  const at = (target: GridFocusTarget, turn: 0 | 180, box: GridRect, plate: GridRect, own: GridRect, drawer: boolean): GridCellRect => ({
    column: target.column,
    row: target.row,
    turn,
    z: round2(z),
    rect: box,
    drawer,
    small: box.width < SMALL_FIELD_WIDTH,
    lh: round2(HAND_SHARE * z),
    plate,
    // The plates sit beside the board, so a hand takes the whole board width.
    hand: { shift: 0, width: zones },
    own,
  });
  const rowTop = bottomBox.y + PAD * z;
  const band: GridBandRect = { column: finale.bottom.column, z: round2(z), rect: rect(bottomBox.x + EMZ_REGION_INSET * z, rowTop, bottomBox.width - 2 * EMZ_REGION_INSET * z, ROW * z) };
  return {
    top: at(finale.top, 180, topBox, topPlate, ownTop, !same),
    bottom: at(finale.bottom, 0, bottomBox, bottomPlate, ownBottom, true),
    rect: { kind: same ? "same" : "cross", frame: union(topBox, bottomBox), band },
  };
}

function placeColumn(column: 0 | 1, z: number, drawerRow: 0 | 1, centerX: number, top: number, zones: number, base: number, home: boolean): PlacedColumn {
  const topBox = rect(centerX - (zones * z) / 2, top + TOP_LANE * z, zones * z, FIELD_ZONES_HIGH * z);
  const bottomBox = rect(centerX - (zones * z) / 2, topBox.y + topBox.height - OVERLAP * z, zones * z, FIELD_ZONES_HIGH * z);
  const box = drawerRow === 1 ? bottomBox : topBox;
  const rowTop = drawerRow === 1 ? box.y + PAD * z : box.y + box.height - (PAD + ROW) * z;
  const bandX = box.x + EMZ_REGION_INSET * z;
  const bandWidth = box.width - 2 * EMZ_REGION_INSET * z;
  const band: GridBandRect = { column, z: round2(z), rect: rect(bandX, rowTop, bandWidth, ROW * z) };
  const plateH = PLATE_H * z;
  const cell = (row: 0 | 1, box: GridRect, plate: GridRect, own: GridRect): GridCellRect => ({
    column,
    row,
    turn: row === 0 ? 180 : 0,
    z: round2(z),
    rect: box,
    drawer: drawerRow === row,
    small: box.width < SMALL_FIELD_WIDTH,
    lh: round2(HAND_SHARE * Math.min(z, base)),
    plate,
    hand: row === 1 && home ? { shift: HAND_SHIFT, width: zones - PLATE_W } : { shift: 0, width: zones },
    own,
  });
  // The own part of a field: the box without the pad, the Extra Monster row and the row gap on the side of its partner.
  const ownTop = rect(topBox.x, topBox.y, topBox.width, topBox.height - OVERLAP * z);
  const ownBottom = rect(bottomBox.x, bottomBox.y + OVERLAP * z, bottomBox.width, bottomBox.height - OVERLAP * z);
  const topPlate = rect(topBox.x, topBox.y - TOP_LANE * z, PLATE_W * z, plateH);
  const bottomPlate = rect(bottomBox.x, bottomBox.y + bottomBox.height + PLATE_GAP * z, PLATE_W * z, plateH);
  return { cells: [cell(0, topBox, topPlate, ownTop), cell(1, bottomBox, bottomPlate, ownBottom)], band };
}

/**
 * The final layout of the grid in a box, pure. `focus` null = all fields: an equal 2x2. A focus lifts its WHOLE pair
 * (both fields of its column) to about 1.12x of the rest size, by the column width; the other pair keeps the rest size,
 * or gives up width (down to 0.66x) so the lifted pair fits. The two shared Extra Monster rows lie on one line. With
 * `finale` the column of the last two seats is one full board and the other column stays where it is.
 */
export function gridFocusLayout(world: GridWorld, viewport: GridViewport, focus: GridFocusTarget | null, options: GridLayoutOptions = {}): GridFocusLayout {
  const { zones } = world;
  const homeColumn = options.homeColumn === undefined ? 0 : options.homeColumn;
  const ownLane = homeColumn == null ? RIVAL_BOTTOM_LANE : HOME_LANE;
  const width = Math.max(0, viewport.width - 2 * EDGE);
  const height = Math.max(0, viewport.height - 2 * EDGE);
  const drawerOf = (column: 0 | 1): 0 | 1 => options.drawerRow?.[column] ?? 1;
  const gap = (z: number) => COLUMN_GAP * z;

  // The tallest pair that fits the height, and the equal 2x2 that fits the width.
  const tallest = Math.max(0, height / columnHeight(1, 1, ownLane));
  const wide = Math.max(0, width / (2 * zones + COLUMN_GAP));
  const equal = Math.min(wide, tallest);
  // At rest a little height is kept for the lift.
  const rest = focus ? Math.min(wide, tallest / PAIR_FOCUS_MIN) : equal;
  const laneOf = (column: 0 | 1, z: number) => (column === homeColumn ? HOME_LANE * Math.min(z, rest) : RIVAL_BOTTOM_LANE * z);
  const heightOf = (column: 0 | 1, z: number) => columnHeight(z, drawerOf(column), laneOf(column, z));

  let zs: [number, number] = [rest, rest];
  if (focus) {
    const widthCap = (width - gap(rest) - zones * OTHER_MIN_SHARE * rest) / zones;
    const lift = Math.max(rest, Math.min(PAIR_FOCUS * rest, tallest, widthCap));
    const other = Math.min(rest, (width - gap(rest) - zones * lift) / zones);
    zs = focus.column === 0 ? [lift, other] : [other, lift];
  }
  const total = zones * zs[0] + gap(rest) + zones * zs[1];
  const x0 = EDGE + (width - total) / 2;
  const centers: [number, number] = [x0 + (zones * zs[0]) / 2, x0 + zones * zs[0] + gap(rest) + (zones * zs[1]) / 2];

  // Both shared Extra Monster rows lie on one line; every column stays whole inside the box.
  const probe = ([0, 1] as const).map((column) => {
    const placed = placeColumn(column, zs[column], drawerOf(column), 0, 0, zones, rest, column === homeColumn);
    const offset = placed.band.rect.y + placed.band.rect.height / 2;
    return { offset, below: heightOf(column, zs[column]) - offset };
  });
  const big = zs[0] >= zs[1] ? 0 : 1;
  const ideal = EDGE + (height - (probe[big].offset + probe[big].below)) / 2 + probe[big].offset;
  const lineMin = Math.max(EDGE + probe[0].offset, EDGE + probe[1].offset);
  const lineMax = Math.min(EDGE + height - probe[0].below, EDGE + height - probe[1].below);
  const line = lineMax >= lineMin ? Math.min(lineMax, Math.max(lineMin, ideal)) : lineMax;
  const columns = ([0, 1] as const).map((column) =>
    placeColumn(column, zs[column], drawerOf(column), centers[column], line - probe[column].offset, zones, rest, column === homeColumn),
  ) as [PlacedColumn, PlacedColumn];

  const regular = [...columns[0].cells, ...columns[1].cells];
  const cells = [...regular];
  let finale: GridFinaleRect | null = null;
  if (options.finale != null) {
    const board = placeFinale(options.finale, zones, EDGE, width, height);
    cells[cellIndex(options.finale.top)] = board.top;
    cells[cellIndex(options.finale.bottom)] = board.bottom;
    finale = board.rect;
    for (const target of [options.finale.top, options.finale.bottom]) zs[target.column] = board.bottom.z;
  }
  return {
    cells,
    bands: [columns[0].band, columns[1].band],
    regular,
    sizes: {
      equal: round2(equal),
      rest: round2(rest),
      focus: round2(focus ? zs[focus.column] : equal),
      other: round2(focus ? zs[focus.column === 0 ? 1 : 0] : equal),
    },
    finale,
  };
}
