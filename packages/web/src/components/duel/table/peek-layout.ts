/**
 * Where the card peek stands: one window for hover and pin (a click only freezes it). It must not cover the board (zones and life-point
 * plates), the chain tower and chain panel, the Deck Master plates, the icon dock or the controls. This file measures those parts on screen
 * and lists the places to try, best first; `grid-preview.tsx` ranks them with the real size of the panel. All rects are viewport rects.
 */

export interface Box { left: number; top: number; right: number; bottom: number }

/** What the peek stays clear of. `keep` is never covered when a place exists; `board` is the lesser rule (the least bad place may touch it). */
export interface Obstacles {
  board: Box[];
  keep: Box[];
  /** The chain panel when it stands in the left column (it is also in `keep`): the peek takes its left edge and width, so the two line up. */
  chain?: Box | null;
}

/** One place to try: a free band on one side. The panel stands on the bottom of the band; `maxH` is the room up to its top. */
export interface Place {
  side: "left" | "right";
  width: number;
  /** Left side only: the offset of the panel from the layer's left edge when it is not `EDGE_LEFT_PX` (it lines up with the chain panel). */
  left?: number;
  /** The viewport y of the top of the band. */
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
/** The width of the panel: this, or the free room beside the board when that is less (never under the minimum, the art and text give way). */
export const MIN_WIDTH_PX = 220;
export const WIDTH_PX = 320;
/** The chain panel is at most this wide in the left column (a wider one is a strip across the table, and the peek does not line up with it). */
const CHAIN_COLUMN_MAX_PX = 340;
/** The peek keeps the chain panel's width when the board leaves this much less room than that (the panel stands as near to the board). */
const ALIGN_SLACK_PX = 8;
/** A free band shorter than this is no place for the window (the art and some lines do not fit): used only when no side has a taller one. */
const MIN_BAND_PX = 260;
/** The height of a typical panel: the free width is measured beside the board over this span up from the bottom of a band. */
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

/**
 * Measure what the peek stays clear of. `peek`: the panel itself (it never counts). The clicked card counts like the rest of the board, so a
 * hover and a pin of the same card see the same room and stand in the same place.
 */
export function measureObstacles(peek?: Element | null): Obstacles {
  // The board zones are many (up to 60 on a grid): they count by their rect only (a hidden zone has no size), with no computed style.
  const boxes = (selector: string, styled: boolean) => {
    const found: Box[] = [];
    for (const node of Array.from(document.querySelectorAll(selector))) {
      if (peek?.contains(node)) continue;
      const rect = node.getBoundingClientRect();
      if (rect.width > 1 && rect.height > 1 && (!styled || isShown(node, rect))) found.push(boxOf(rect));
    }
    return found;
  };
  return { board: boxes(BOARD_SELECTOR, false), keep: [...boxes(KEEP_SELECTOR, true), ...cornerBoxes()], chain: chainColumnBox(peek) };
}

/** The chain panel box when it stands in the left column of the layer (a narrow panel on the left half), else null. */
function chainColumnBox(peek?: Element | null): Box | null {
  const layer = peek instanceof HTMLElement ? peek.offsetParent : null;
  const bounds = layer?.getBoundingClientRect();
  for (const node of Array.from(document.querySelectorAll("[data-chain-panel]:not([data-chain-strip-wrap])"))) {
    // The strip of the 1v1 table is no left column: the peek keeps the layer edge there.
    if (peek?.contains(node)) continue;
    const rect = node.getBoundingClientRect();
    if (rect.width <= 1 || rect.height <= 1 || !isShown(node, rect)) continue;
    const mid = bounds ? (bounds.left + bounds.right) / 2 : window.innerWidth / 2;
    if (rect.width <= CHAIN_COLUMN_MAX_PX && (rect.left + rect.right) / 2 < mid) return boxOf(rect);
  }
  return null;
}

/** A short text that changes when what the peek stays clear of moves (a camera move, a chain that opens): the peek is placed again then. */
export function obstaclesKey(obstacles: Obstacles): string {
  const chain = obstacles.chain ? [obstacles.chain.left, obstacles.chain.right].map(Math.round).join(",") : "";
  const keep = obstacles.keep.map((box) => [box.left, box.top, box.right, box.bottom].map(Math.round).join(",")).join(";");
  // The board moves in small steps while the camera glides: its union to 8 px is enough.
  let union: Box | null = null;
  for (const box of obstacles.board) {
    union = union
      ? { left: Math.min(union.left, box.left), top: Math.min(union.top, box.top), right: Math.max(union.right, box.right), bottom: Math.max(union.bottom, box.bottom) }
      : box;
  }
  return `${keep}|${chain}|${union ? [union.left, union.top, union.right, union.bottom].map((value) => Math.round(value / 8)).join(",") : ""}`;
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
export function bandsOf(x0: number, x1: number, top: number, bottom: number, keep: readonly Box[], any = false): Band[] {
  const blockers = keep.filter((box) => box.right > x0 && box.left < x1 && box.bottom > top && box.top < bottom).sort((a, b) => a.top - b.top);
  const bands: Band[] = [];
  let cursor = top;
  for (const box of blockers) {
    if (box.top - GAP_PX > cursor) bands.push({ top: cursor, bottom: box.top - GAP_PX });
    cursor = Math.max(cursor, box.bottom + GAP_PX);
  }
  if (bottom > cursor) bands.push({ top: cursor, bottom });
  const tall = bands.filter((band) => band.bottom - band.top >= MIN_BAND_PX);
  if (tall.length > 0 || !any) return tall;
  // No tall band at all: the tallest one is the least bad.
  return bands.length === 0 ? [{ top, bottom }] : [bands.reduce((best, band) => (band.bottom - band.top > best.bottom - best.top ? band : best))];
}

/** The room from the panel edge to the nearest board part inside the band, on one side. `Infinity` with no board there. */
export function freeWidth(side: "left" | "right", layer: Box, band: Band, board: readonly Box[], leftEdge: number = layer.left + EDGE_LEFT_PX): number {
  // Only the board next to where the panel stands counts: a panel is about this tall, and it stands on the bottom of the band.
  const inBand = board.filter((box) => box.bottom > Math.max(band.top, band.bottom - SPAN_PX) && box.top < band.bottom);
  if (side === "left") {
    const edge = leftEdge;
    const limits = inBand.filter((box) => box.right > edge).map((box) => box.left);
    return limits.length === 0 ? Infinity : Math.floor(Math.min(...limits) - GAP_PX - edge);
  }
  const edge = layer.right - EDGE_RIGHT_PX;
  const limits = inBand.filter((box) => box.left < edge).map((box) => box.right);
  return limits.length === 0 ? Infinity : Math.floor(edge - (Math.max(...limits) + GAP_PX));
}

/** The left column of the peek when it lines up with the chain panel: the left edge of that panel, and its width held to the width of the peek. */
function alignedColumn(obstacles: Obstacles): { left: number; width: number } | null {
  const chain = obstacles.chain;
  if (!chain) return null;
  return { left: Math.round(chain.left), width: Math.max(MIN_WIDTH_PX, Math.min(WIDTH_PX, Math.round(chain.right - chain.left))) };
}

const SIDES = ["left", "right"] as const;
const bandsIn = (x0: number, x1: number, layer: Box, obstacles: Obstacles, any: boolean) =>
  bandsOf(x0, x1, layer.top + TOP_PX, layer.bottom - BOTTOM_PX, obstacles.keep, any);
const edgeColumn = (side: "left" | "right", layer: Box): [number, number] =>
  side === "left" ? [layer.left + EDGE_LEFT_PX, layer.left + EDGE_LEFT_PX + WIDTH_PX] : [layer.right - EDGE_RIGHT_PX - WIDTH_PX, layer.right - EDGE_RIGHT_PX];

/**
 * The places of the left side lined up with the chain panel (its left edge, and its width held to 220-320 px): one per free band beside
 * it where the board leaves at least the minimum width. Empty when no band has that room: the layer edge takes the panel then.
 */
function alignedPlaces(layer: Box, obstacles: Obstacles, any: boolean): Place[] {
  const column = alignedColumn(obstacles);
  if (!column) return [];
  const places: Place[] = [];
  for (const band of bandsIn(column.left, column.left + column.width, layer, obstacles, any)) {
    // The chain panel may stand near the board: a few px of difference to the board gap do not narrow the peek, a clearly nearer board does.
    const free = freeWidth("left", layer, band, obstacles.board, column.left);
    if (free < MIN_WIDTH_PX) continue;
    const width = free >= column.width - ALIGN_SLACK_PX ? column.width : free;
    places.push({ side: "left", width, left: column.left - layer.left, top: band.top, maxH: band.bottom - band.top });
  }
  return places;
}

/**
 * The places of the panel: both edges (the left one first), one per free band (the highest first). The width is `WIDTH_PX`, or the free
 * room beside the board when that is less (never under the minimum). With no measurable layer it returns nothing: the CSS places it.
 */
export function peekPlaces(layer: Box, obstacles: Obstacles): Place[] {
  if (layer.bottom - layer.top <= 0) return [];
  // A side whose column is cut into short bands (a chain tower and the chain panel) is no place: the other side takes it. Only when
  // no side has a tall band, the tallest bands are the least bad places.
  for (const any of [false, true]) {
    const places: Place[] = [];
    const aligned = alignedPlaces(layer, obstacles, any);
    for (const side of SIDES) {
      if (side === "left" && aligned.length > 0) {
        places.push(...aligned);
        continue;
      }
      const [x0, x1] = edgeColumn(side, layer);
      for (const band of bandsIn(x0, x1, layer, obstacles, any)) {
        const width = Math.max(MIN_WIDTH_PX, Math.min(WIDTH_PX, freeWidth(side, layer, band, obstacles.board)));
        places.push({ side, width, top: band.top, maxH: band.bottom - band.top });
      }
    }
    if (places.length > 0) return places;
  }
  return [];
}
