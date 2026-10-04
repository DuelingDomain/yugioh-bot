/**
 * Where the Tribute dock sits.
 *
 * Tributes are picked on the field, so the instruction ("Tribute 1 monster · 0/1", Summon, Cancel) docks by your
 * hand instead of covering the board:
 *   side    there is room right of your hand: the dock sits there, its bottom level with the hand, against the board
 *           edge, narrowed to stop short of any seat plate (a plate shows the turn clock, so it stays uncovered)
 *   above   no room beside the hand: the row above the hand, against the right edge
 *   center  the 2v2 Rooftop (`centered`), or no room beside a centred, wide hand: the row above, centred
 *   full    a phone: the full width of the board, in the row above the hand; just under the hand when a plate is in
 *           that row
 * The rows above the hand are checked against the plates too. If none is clear, the right-edge dock is lifted over them.
 * Pure geometry: the caller measures the DOM and passes rectangles in one coordinate space.
 */
import type { BarRect } from "./select-bar-place";

export type DockMode = "side" | "above" | "center" | "full";

export interface DockPlace {
  mode: DockMode;
  /** Left edge in board px (side), else null. */
  left: number | null;
  /** Unused by the current modes; kept null. */
  top: number | null;
  /** Distance of the dock's bottom edge from the board's bottom edge, px. */
  bottom: number | null;
  /** Width in board px (side), else null: the CSS sizes the dock. */
  width: number | null;
}

/** Narrowest dock that still reads beside a hand. */
export const DOCK_MIN_WIDTH = 260;
export const DOCK_MAX_WIDTH = 380;
/** Board width below which the dock takes the whole width. */
export const DOCK_PHONE_WIDTH = 560;
const DOCK_EDGE = 12;
const DOCK_AIR = 8;
/** What the dock measures when its size comes from its content (the above and centre rows). */
const DOCK_EST_WIDTH = 320;
const DOCK_EST_HEIGHT = 96;
/** The full-width phone dock is one row: the title, the counter and the buttons. */
const DOCK_FULL_HEIGHT = 64;
const PLATE_GAP = 6;

function valid(rect: BarRect | null | undefined): rect is BarRect {
  return rect != null && rect.right > rect.left && rect.bottom > rect.top;
}

function overlapsX(a: BarRect, left: number, right: number): boolean {
  return a.left < right && a.right > left;
}

function overlapsY(a: BarRect, top: number, bottom: number): boolean {
  return a.top < bottom && a.bottom > top;
}

/**
 * `plates` are the seat and life-point plates in the same coordinate space as `board` and `hand`.
 */
export function placeTributeDock({
  board,
  hand,
  centered = false,
  plates = [],
}: {
  board: BarRect;
  hand: BarRect | null;
  centered?: boolean;
  plates?: readonly BarRect[];
}): DockPlace {
  const width = board.right - board.left;
  const height = board.bottom - board.top;
  const own = valid(hand) ? hand : null;
  const above = own ? Math.max(DOCK_AIR, Math.round(board.bottom - own.top + DOCK_AIR)) : DOCK_EDGE;
  const bottom = Math.min(above, Math.max(DOCK_AIR, height - 60));
  const solid = plates.filter(valid);
  /** The plates a dock of this footprint would cover. Its bottom edge is `bottomPx` above the board's bottom edge. */
  const blockers = (left: number, right: number, bottomPx: number, heightPx = DOCK_EST_HEIGHT): BarRect[] => {
    const dockBottom = board.bottom - bottomPx;
    return solid.filter(
      (plate) => overlapsX(plate, left - PLATE_GAP, right + PLATE_GAP) && overlapsY(plate, dockBottom - heightPx - PLATE_GAP, dockBottom + PLATE_GAP),
    );
  };
  /** The bottom edge that lifts a dock of this footprint just over the plates it would cover. */
  const liftOver = (left: number, right: number, heightPx = DOCK_EST_HEIGHT): number =>
    Math.min(
      blockers(left, right, bottom, heightPx).reduce((most, plate) => Math.max(most, Math.round(board.bottom - plate.top + DOCK_AIR)), bottom),
      Math.max(DOCK_AIR, height - 60),
    );
  if (width < DOCK_PHONE_WIDTH) {
    // The row above the hand, else the strip just under it, else lifted over the plates in the way.
    if (blockers(board.left, board.right, bottom, DOCK_FULL_HEIGHT).length === 0) return { mode: "full", left: null, top: null, bottom, width: null };
    if (own) {
      const below = Math.round(board.bottom - own.bottom - DOCK_AIR - DOCK_FULL_HEIGHT);
      if (below >= DOCK_AIR && blockers(board.left, board.right, below, DOCK_FULL_HEIGHT).length === 0) return { mode: "full", left: null, top: null, bottom: below, width: null };
    }
    return { mode: "full", left: null, top: null, bottom: liftOver(board.left, board.right, DOCK_FULL_HEIGHT), width: null };
  }
  if (!own) return { mode: "center", left: null, top: null, bottom: DOCK_EDGE, width: null };

  const rowFootprint = (mode: "above" | "center"): [number, number] => {
    const left = mode === "above" ? board.right - DOCK_EDGE - DOCK_EST_WIDTH : (board.left + board.right) / 2 - DOCK_EST_WIDTH / 2;
    return [left, left + DOCK_EST_WIDTH];
  };

  // The 2v2 Rooftop keeps the dock over the middle of the row above the hand, where the seat plates leave room.
  if (!centered) {
    const sideBottom = Math.max(DOCK_AIR, Math.round(board.bottom - own.bottom));
    let lo = own.right + DOCK_EDGE;
    let hi = board.right - DOCK_EDGE;
    if (hi - lo >= DOCK_MIN_WIDTH) {
      // A plate in the way takes the room on its side of the strip beside the hand.
      for (const plate of blockers(lo, hi, sideBottom)) {
        if ((plate.left + plate.right) / 2 > (lo + hi) / 2) hi = Math.min(hi, plate.left - PLATE_GAP);
        else lo = Math.max(lo, plate.right + PLATE_GAP);
      }
      const room = hi - lo;
      if (room >= DOCK_MIN_WIDTH) {
        const dock = Math.min(room, DOCK_MAX_WIDTH);
        // Bottom edges level with the hand's, so a dock that wraps to a second row grows upward, off the board's edge.
        return { mode: "side", left: Math.round(hi - dock - board.left), top: null, bottom: sideBottom, width: Math.round(dock) };
      }
    }
  }

  const handMiddle = (own.left + own.right) / 2;
  const boardMiddle = (board.left + board.right) / 2;
  const handCentred = Math.abs(handMiddle - boardMiddle) <= width * 0.12 && own.right - own.left >= width * 0.55;
  const order: Array<"above" | "center"> = centered || handCentred ? ["center", "above"] : ["above", "center"];
  for (const mode of order) {
    const [left, right] = rowFootprint(mode);
    if (blockers(left, right, bottom).length === 0) return { mode, left: null, top: null, bottom, width: null };
  }

  // Nothing is clear: lift the right-edge dock over the plates in its way.
  const [left, right] = rowFootprint("above");
  return { mode: "above", left: null, top: null, bottom: liftOver(left, right), width: null };
}

export function sameDock(a: DockPlace, b: DockPlace): boolean {
  return a.mode === b.mode && a.left === b.left && a.top === b.top && a.bottom === b.bottom && a.width === b.width;
}
