/**
 * Where the card peek stands: one window for hover and pin (a click only freezes it), always in the same column at the left edge, right of the
 * icon dock, so a player always looks at the same place for the card. The column is kept free of the board by every shell (`--pv-col-w` in
 * grid-hud.module.css; the shells set their left margin from it). The window must not cover the chain tower and chain panel, the Deck Master
 * plates, the icon dock or the controls: it stands in a free band of the column, between them. This file measures those parts on screen and
 * lists the bands to try, best first; `grid-preview.tsx` ranks them with the real size of the panel. All rects are viewport rects.
 */

export interface Box { left: number; top: number; right: number; bottom: number }

/** What the peek stays clear of. `keep` is never covered when a place exists; `board` is the lesser rule (the least bad place may touch it). */
export interface Obstacles {
  board: Box[];
  keep: Box[];
}

/** One place to try: a free band of the left column. The panel stands on the bottom of the band; `maxH` is the room up to its top. */
export interface Place {
  side: "left";
  width: number;
  /** The viewport y of the top of the band. */
  top: number;
  maxH: number;
}

/** The gap kept between the peek and what it stays clear of, and the offsets of the panel from the layer edges (grid-hud.module.css). */
export const GAP_PX = 12;
export const EDGE_LEFT_PX = 72;
/** The top offset of the peek in the layer (under the header pills) and the room left under it. */
export const TOP_PX = 50;
const BOTTOM_PX = 8;
/** The width of the panel: 14% of the window, from 220 to 284 px (`--pv-col-w`, grid-hud.module.css, says the same in CSS). */
export const MIN_WIDTH_PX = 220;
export const MAX_WIDTH_PX = 284;
export const WIDTH_RATIO = 0.14;
/** The panel width for a window (or layer) this wide. */
export const peekWidth = (windowWidth: number): number => Math.round(Math.min(MAX_WIDTH_PX, Math.max(MIN_WIDTH_PX, windowWidth * WIDTH_RATIO)));
/** The right edge of the peek column from the left edge of the window: the shells keep the board right of it (`--hud-left`). */
export const peekColumnRight = (windowWidth: number): number => EDGE_LEFT_PX + peekWidth(windowWidth) + GAP_PX;
/** A free band shorter than this is a short place: it comes after the tall ones (the art and some lines may not fit it). */
const MIN_BAND_PX = 260;
/** The height of a typical panel: the free width is measured beside the board over this span up from the bottom of a band. */
const SPAN_PX = 520;
/** Overlaps thinner than this are no overlap (a tilted zone has a loose bounding box). */
const THIN_PX = 4;

const BOARD_SELECTOR = "[data-zones], [data-lp-seat]";
const KEEP_SELECTOR = [
  '[data-testid="chain-tower"]', "[data-chain-panel]", '[data-testid="hud-dock"]', '[data-testid="hud-master"]', '[data-testid="hud-other"]',
  "[data-team-plate]", "[data-grid-controls]", "[data-view-reset]", "[data-camera-panel]", "[data-hub-slot]", "[data-hub]",
  // The glass pills of the bottom bar (the hint of the phase, the turn controls): the hint reaches into the column at 1280 px.
  '[data-testid="hud-bottom"] nav > div',
].join(", ");
/**
 * A pin also stays clear of the life-point plates: a pin takes clicks, and a plate can be a choose-opponent target. A hover panel takes none and
 * may stand over a plate (its `.main` is a board part, `[data-lp-seat]`): a plate in the column would cut the band short and hide the art.
 */
const PIN_KEEP_SELECTOR = `${KEEP_SELECTOR}, [data-holo]`;

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
 * Measure what the peek stays clear of. `peek`: the panel itself (it never counts). `pinned`: the panel is a pin, which also stays clear of
 * the life-point plates (`PIN_KEEP_SELECTOR`). The clicked card counts like the rest of the board.
 */
export function measureObstacles(peek?: Element | null, pinned = false): Obstacles {
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
  return { board: boxes(BOARD_SELECTOR, false), keep: [...boxes(pinned ? PIN_KEEP_SELECTOR : KEEP_SELECTOR, true), ...cornerBoxes()] };
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

/** A free band shorter than this is no place at all (not even the least bad one): it is dropped when other bands exist. */
const MIN_SHORT_BAND_PX = 60;

/**
 * The free vertical bands of a column (x0 to x1) between `top` and `bottom`: each part that stays clear cuts the column. The tall bands come
 * first (top down). The short ones follow, tallest first: they are the places of last resort, and a pin takes one to stay clear of the card
 * that was clicked. With no tall band, the short ones are the only places.
 */
export function bandsOf(x0: number, x1: number, top: number, bottom: number, keep: readonly Box[]): Band[] {
  const blockers = keep.filter((box) => box.right > x0 && box.left < x1 && box.bottom > top && box.top < bottom).sort((a, b) => a.top - b.top);
  const bands: Band[] = [];
  let cursor = top;
  for (const box of blockers) {
    if (box.top - GAP_PX > cursor) bands.push({ top: cursor, bottom: box.top - GAP_PX });
    cursor = Math.max(cursor, box.bottom + GAP_PX);
  }
  if (bottom > cursor) bands.push({ top: cursor, bottom });
  const height = (band: Band) => band.bottom - band.top;
  const tall = bands.filter((band) => height(band) >= MIN_BAND_PX);
  const short = bands.filter((band) => height(band) < MIN_BAND_PX && height(band) >= MIN_SHORT_BAND_PX).sort((a, b) => height(b) - height(a));
  if (tall.length + short.length > 0) return [...tall, ...short];
  // Nothing of a useful height: the tallest one is the least bad.
  return bands.length === 0 ? [{ top, bottom }] : [bands.reduce((best, band) => (height(band) > height(best) ? band : best))];
}

/** The room from the panel edge to the nearest board part inside the band. `Infinity` with no board there. */
export function freeWidth(layer: Box, band: Band, board: readonly Box[]): number {
  // Only the board next to where the panel stands counts: a panel is about this tall, and it stands on the bottom of the band.
  const inBand = board.filter((box) => box.bottom > Math.max(band.top, band.bottom - SPAN_PX) && box.top < band.bottom);
  const edge = layer.left + EDGE_LEFT_PX;
  const limits = inBand.filter((box) => box.right > edge).map((box) => box.left);
  return limits.length === 0 ? Infinity : Math.floor(Math.min(...limits) - GAP_PX - edge);
}

/**
 * The places of the panel: one per free band of the left column (the highest first). The width is `peekWidth` of the layer, or the free
 * room beside the board when that is less (never under the minimum). With no measurable layer it returns nothing: the CSS places it.
 * A column cut into short bands (a chain tower, the chain panel, a Deck Master plate) is still the column: the short bands follow the tall ones
 * (a pin can take one to stay clear of the clicked card), they are the only places when no band is tall, and the panel never goes to the other side.
 */
export function peekPlaces(layer: Box, obstacles: Obstacles): Place[] {
  if (layer.bottom - layer.top <= 0) return [];
  const full = peekWidth(layer.right - layer.left);
  const x0 = layer.left + EDGE_LEFT_PX;
  // The bands are cut at the minimum width: a part that stands further right (a life-point plate, the hub) only narrows the panel there.
  const near = [...obstacles.board, ...obstacles.keep];
  const places: Place[] = [];
  for (const band of bandsOf(x0, x0 + MIN_WIDTH_PX, layer.top + TOP_PX, layer.bottom - BOTTOM_PX, obstacles.keep)) {
    const width = Math.max(MIN_WIDTH_PX, Math.min(full, freeWidth(layer, band, near)));
    places.push({ side: "left", width, top: band.top, maxH: band.bottom - band.top });
  }
  return places;
}
