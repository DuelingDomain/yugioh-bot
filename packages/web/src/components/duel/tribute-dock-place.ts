/**
 * Where the Tribute dock sits.
 *
 * Tributes are picked on the field, so the instruction ("Tribute 1 monster · 0/1", Summon, Cancel) docks by your
 * hand instead of covering the board:
 *   side    there is room right of your hand: the dock sits there, level with the hand, against the board edge
 *   above   no room beside the hand: the row above the hand, against the right edge
 *   center  no room beside the hand and the hand is centred and wide (the 2v2 Rooftop): the row above, centred
 *   full    a phone: the full width of the board, in the row above the hand
 * Pure geometry: the caller measures the DOM and passes rectangles in one coordinate space.
 */
import type { BarRect } from "./select-bar-place";

export type DockMode = "side" | "above" | "center" | "full";

export interface DockPlace {
  mode: DockMode;
  /** Left edge in board px (side), else null. */
  left: number | null;
  /** Vertical centre in board px (side), else null. */
  top: number | null;
  /** Distance of the dock's bottom edge from the board's bottom edge, px (above, center, full). */
  bottom: number | null;
  /** Width in board px (side), else null: the CSS sizes the dock. */
  width: number | null;
}

/** Narrowest dock that still reads beside a hand. */
export const DOCK_MIN_WIDTH = 280;
export const DOCK_MAX_WIDTH = 380;
/** Board width below which the dock takes the whole width. */
export const DOCK_PHONE_WIDTH = 560;
const DOCK_EDGE = 12;
const DOCK_AIR = 8;

function valid(rect: BarRect | null | undefined): rect is BarRect {
  return rect != null && rect.right > rect.left && rect.bottom > rect.top;
}

export function placeTributeDock({ board, hand }: { board: BarRect; hand: BarRect | null }): DockPlace {
  const width = board.right - board.left;
  const height = board.bottom - board.top;
  const own = valid(hand) ? hand : null;
  const above = own ? Math.max(DOCK_AIR, Math.round(board.bottom - own.top + DOCK_AIR)) : DOCK_EDGE;
  const bottom = Math.min(above, Math.max(DOCK_AIR, height - 60));
  if (width < DOCK_PHONE_WIDTH) return { mode: "full", left: null, top: null, bottom, width: null };
  if (!own) return { mode: "center", left: null, top: null, bottom: DOCK_EDGE, width: null };

  const room = board.right - own.right - 2 * DOCK_EDGE;
  if (room >= DOCK_MIN_WIDTH) {
    const dock = Math.min(room, DOCK_MAX_WIDTH);
    return {
      mode: "side",
      left: Math.round(board.right - DOCK_EDGE - dock - board.left),
      top: Math.round((own.top + own.bottom) / 2 - board.top),
      bottom: null,
      width: Math.round(dock),
    };
  }
  const handMiddle = (own.left + own.right) / 2;
  const boardMiddle = (board.left + board.right) / 2;
  const centred = Math.abs(handMiddle - boardMiddle) <= width * 0.12 && own.right - own.left >= width * 0.55;
  return { mode: centred ? "center" : "above", left: null, top: null, bottom, width: null };
}

export function sameDock(a: DockPlace, b: DockPlace): boolean {
  return a.mode === b.mode && a.left === b.left && a.top === b.top && a.bottom === b.bottom && a.width === b.width;
}
