/**
 * Where the card peek (hover and pinned) stands. It must not cover the board (zones and life-point plates), the chain tower, the Deck Master
 * plates, the icon dock or the controls. This file measures those parts on screen and lists the places to try, best first;
 * `grid-preview.tsx` ranks them with the real size of the panel. All rects are viewport rects.
 */

export interface Box { left: number; top: number; right: number; bottom: number }

/** What the peek stays clear of. `keep` is never covered when a place exists; `board` is the lesser rule (the least bad place may touch it). */
export interface Obstacles { board: Box[]; keep: Box[] }

/** One place to try. `top` is a viewport y; `maxH` is the room from there down to the next part that stays clear. */
export interface Place {
  side: "left" | "right";
  width: number;
  /** The art of a pinned panel: normal, small or none. */
  art: "normal" | "small" | "none";
  top: number;
  maxH: number;
}

/** The gap kept between the peek and what it stays clear of, and the offsets of the panel from the layer edges (grid-hud.module.css). */
export const GAP_PX = 12;
export const EDGE_LEFT_PX = 72;
export const EDGE_RIGHT_PX = 16;
/** The top offset of the peek in the layer (under the header pills) and the room left under it. */
export const TOP_PX = 50;
const BOTTOM_PX = 8;
/** The narrowest panel; under `ROW_PX` the art goes on top of the text (a taller panel instead of a wider one). */
export const MIN_WIDTH_PX = 220;
export const ROW_PX = 430;
/** The width of the hover panel (its CSS). */
export const HOVER_WIDTH_PX = 284;
/** A free band shorter than this is used only when there is no taller one. */
const MIN_BAND_PX = 200;
/** The height of a typical panel: the free width is measured beside the board over this span from the top of a band. */
const SPAN_PX = 520;
/** Overlaps thinner than this are no overlap (a tilted zone has a loose bounding box). */
const THIN_PX = 4;

const BOARD_SELECTOR = "[data-zones], [data-lp-seat]";
const KEEP_SELECTOR = [
  '[data-testid="chain-tower"]', "[data-chain-panel]", '[data-testid="hud-dock"]', '[data-testid="hud-master"]', '[data-testid="hud-other"]',
  "[data-team-plate]", "[data-grid-controls]", "[data-view-reset]", "[data-camera-panel]",
].join(", ");

/** Can the part be seen and clicked: it has a size, it is not collapsed and not invisible. */
export function isShown(node: Element, rect: DOMRect = node.getBoundingClientRect()): boolean {
  if (rect.width <= 0 || rect.height <= 0) return false;
  const style = getComputedStyle(node);
  return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) > 0;
}

const boxOf = (rect: DOMRect): Box => ({ left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom });

/** The bottom right controls: the direct children of the corner that show (a hidden item still takes room in the column but is no control). */
function cornerBoxes(): Box[] {
  const corner = document.querySelector<HTMLElement>('[data-testid="hud-corner"]');
  if (!corner) return [];
  const boxes: Box[] = [];
  for (const child of Array.from(corner.children)) {
    const rect = child.getBoundingClientRect();
    if (isShown(child, rect)) boxes.push(boxOf(rect));
  }
  return boxes;
}

/** The top of the bottom right controls, or `null` when there are none. */
export function controlsTop(): number | null {
  const boxes = cornerBoxes();
  return boxes.length === 0 ? null : Math.min(...boxes.map((box) => box.top));
}

/**
 * Measure what the peek stays clear of. `peek`: the panel itself (it never counts). `card`: the clicked card; the zone that holds it is
 * left out of the board (the panel keeps clear of the card itself by the card rule, so it may stand right up to the cell next to it).
 */
export function measureObstacles(peek?: Element | null, card?: Element | null): Obstacles {
  const boxes = (selector: string) => {
    const found: Box[] = [];
    for (const node of Array.from(document.querySelectorAll(selector))) {
      if (peek?.contains(node) || (card && (card === node || node.contains(card) || card.contains(node)))) continue;
      const rect = node.getBoundingClientRect();
      if (rect.width > 1 && rect.height > 1 && isShown(node, rect)) found.push(boxOf(rect));
    }
    return found;
  };
  return { board: boxes(BOARD_SELECTOR), keep: [...boxes(KEEP_SELECTOR), ...cornerBoxes()] };
}

/** A short text that changes when what the peek stays clear of moves (a camera move, a chain that opens): the peek is placed again then. */
export function obstaclesKey(obstacles: Obstacles): string {
  const keep = obstacles.keep.map((box) => [box.left, box.top, box.right, box.bottom].map(Math.round).join(",")).join(";");
  // The board moves in small steps while the camera glides: its union to 8 px is enough.
  let union: Box | null = null;
  for (const box of obstacles.board) {
    union = union
      ? { left: Math.min(union.left, box.left), top: Math.min(union.top, box.top), right: Math.max(union.right, box.right), bottom: Math.max(union.bottom, box.bottom) }
      : box;
  }
  return `${keep}|${union ? [union.left, union.top, union.right, union.bottom].map((value) => Math.round(value / 8)).join(",") : ""}`;
}

/** The area of `box` that lies on `others`. Overlaps thinner than a few px do not count. */
export function coveredArea(box: Box, others: readonly Box[]): number {
  let area = 0;
  for (const other of others) {
    const width = Math.min(box.right, other.right) - Math.max(box.left, other.left);
    const height = Math.min(box.bottom, other.bottom) - Math.max(box.top, other.top);
    if (width > THIN_PX && height > THIN_PX) area += width * height;
  }
  return area;
}

export interface Band { top: number; bottom: number }

/** The free vertical bands of a column (x0 to x1) between `top` and `bottom`: each part that stays clear cuts the column. */
export function bandsOf(x0: number, x1: number, top: number, bottom: number, keep: readonly Box[]): Band[] {
  const blockers = keep.filter((box) => box.right > x0 && box.left < x1 && box.bottom > top && box.top < bottom).sort((a, b) => a.top - b.top);
  const bands: Band[] = [];
  let cursor = top;
  for (const box of blockers) {
    if (box.top - GAP_PX > cursor) bands.push({ top: cursor, bottom: box.top - GAP_PX });
    cursor = Math.max(cursor, box.bottom + GAP_PX);
  }
  if (bottom > cursor) bands.push({ top: cursor, bottom });
  const tall = bands.filter((band) => band.bottom - band.top >= MIN_BAND_PX);
  if (tall.length > 0) return tall;
  // No tall band: the tallest one is the least bad.
  return bands.length === 0 ? [{ top, bottom }] : [bands.reduce((best, band) => (band.bottom - band.top > best.bottom - best.top ? band : best))];
}

/** The room from the panel edge to the nearest board part inside the band, on one side. `Infinity` with no board there. */
export function freeWidth(side: "left" | "right", layer: Box, band: Band, board: readonly Box[]): number {
  // Only the board next to where the panel stands counts: a panel is about this tall, and it starts at the top of the band.
  const inBand = board.filter((box) => box.bottom > band.top && box.top < Math.min(band.bottom, band.top + SPAN_PX));
  if (side === "left") {
    const edge = layer.left + EDGE_LEFT_PX;
    const limits = inBand.filter((box) => box.right > edge).map((box) => box.left);
    return limits.length === 0 ? Infinity : Math.floor(Math.min(...limits) - GAP_PX - edge);
  }
  const edge = layer.right - EDGE_RIGHT_PX;
  const limits = inBand.filter((box) => box.left < edge).map((box) => box.right);
  return limits.length === 0 ? Infinity : Math.floor(edge - (Math.max(...limits) + GAP_PX));
}

const columnOf = (side: "left" | "right", width: number, layer: Box): [number, number] =>
  side === "left" ? [layer.left + EDGE_LEFT_PX, layer.left + EDGE_LEFT_PX + width] : [layer.right - EDGE_RIGHT_PX - width, layer.right - EDGE_RIGHT_PX];

const SIDES = ["left", "right"] as const;
const bandsAt = (side: "left" | "right", width: number, layer: Box, obstacles: Obstacles) => {
  const [x0, x1] = columnOf(side, width, layer);
  return bandsOf(x0, x1, layer.top + TOP_PX, layer.bottom - BOTTOM_PX, obstacles.keep);
};

/**
 * The places of the hover panel: both edges (the left one first), one per free band (the highest first). Its width is the CSS width, or the
 * free room beside the board when that is less (never under the minimum). With no measurable layer it returns nothing: the CSS places it.
 */
export function hoverPlaces(layer: Box, obstacles: Obstacles): Place[] {
  if (layer.bottom - layer.top <= 0) return [];
  const places: Place[] = [];
  for (const side of SIDES) {
    for (const band of bandsAt(side, HOVER_WIDTH_PX, layer, obstacles)) {
      const width = Math.max(MIN_WIDTH_PX, Math.min(HOVER_WIDTH_PX, freeWidth(side, layer, band, obstacles.board)));
      places.push({ side, width, art: "normal", top: band.top, maxH: band.bottom - band.top });
    }
  }
  return places;
}

const WIDE_STEPS = [700, 820, 940];
const NARROW_STEPS = [600, 520, 430, 340, 270, 240, 220];

/**
 * The places of the pinned panel, best first. `cap`: the widest it gets; `target`: the clicked card.
 * Tiers: (1) the natural width (700 px, or all the room beside the board when that is less) with the normal art, then a small art, then
 * wider panels; (2) the widest panels that stand clear of the clicked card; (3) narrower panels; (4) the same with no art.
 * Inside a tier: the left edge before the right, the highest free band first. The caller ranks them with the real size of the panel.
 */
export function pinnedPlaces(layer: Box, obstacles: Obstacles, target: Box | null, cap: number): Place[] {
  const measurable = layer.bottom - layer.top > 0;
  const limit = Math.max(WIDE_STEPS[0], cap);
  const tiers: Place[][] = [[], [], [], []];
  const add = (tier: number, side: "left" | "right", band: Band, width: number, arts: ReadonlyArray<Place["art"]>) => {
    for (const art of arts) tiers[tier].push({ side, width, art, top: band.top, maxH: band.bottom - band.top });
  };
  const noBand: Band = { top: layer.top + TOP_PX, bottom: layer.bottom - BOTTOM_PX };
  const ART = ["normal", "small"] as const;
  const clearOf = (side: "left" | "right") => target
    ? Math.floor(side === "left" ? target.left - GAP_PX - (layer.left + EDGE_LEFT_PX) : layer.right - EDGE_RIGHT_PX - (target.right + GAP_PX))
    : 0;
  for (const side of SIDES) {
    // The widths depend on the bands, the bands on the widths: the bands at the standard width give the room.
    const probe = measurable ? bandsAt(side, WIDE_STEPS[0], layer, obstacles) : [noBand];
    for (const band of probe) {
      const free = measurable ? freeWidth(side, layer, band, obstacles.board) : Infinity;
      const room = Math.min(limit, free);
      const natural = Math.max(MIN_WIDTH_PX, Math.min(WIDE_STEPS[0], room));
      const wide = [natural, ...WIDE_STEPS.slice(1).filter((step) => step < room), ...(room > natural && Number.isFinite(room) ? [room] : [])];
      const bandsFor = (width: number) => (measurable ? bandsAt(side, width, layer, obstacles) : [noBand]);
      for (const width of new Set(wide)) for (const own of bandsFor(width)) if (own.top === band.top) add(0, side, own, width, ART);
      const clear = clearOf(side);
      if (clear >= ROW_PX && clear < limit && clear <= room) for (const own of bandsFor(clear)) if (own.top === band.top) add(1, side, own, clear, ART);
      for (const width of NARROW_STEPS) if (width < natural) add(2, side, band, width, ["small"]);
      for (const width of new Set([...wide, ...NARROW_STEPS.filter((step) => step < natural)])) add(3, side, band, width, ["none"]);
    }
  }
  return tiers.flat();
}
