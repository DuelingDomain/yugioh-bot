/**
 * Where the on-board "select cards" instruction bar sits.
 *
 * The bar goes in the middle band of the board (the Extra Monster Zone row, between the two fields),
 * horizontally centred. The two Extra Monster Zones flank the centre column, so the bar is sized to the
 * free gap between them and never covers a zone. When that gap is too narrow for the bar AND an Extra
 * Monster Zone is a legal pick, the bar falls back to the top edge under the opponent's hand.
 * Pure geometry: the caller measures the DOM and passes rectangles in the same coordinate space.
 */

export interface BarRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface BarZone extends BarRect {
  /** The zone can be picked in the current prompt. */
  legal: boolean;
}

export interface BarPlaceInput {
  board: BarRect;
  /** Extra Monster Zone slots (empty when the format has none). */
  emz: readonly BarZone[];
  /** Both hands. */
  hands: readonly BarRect[];
}

export interface BarPlace {
  mode: "mid" | "top";
  /** Centre line of the bar (mid) or its top edge (top), in board px. Null: not measurable, use 50%. */
  top: number | null;
  /** Horizontal centre in board px. Null: use 50%. */
  left: number | null;
  /** Room the bar must fit in, px. Null: no limit beyond its own max width. */
  fit: number | null;
  /** Too narrow for one line: title, status and buttons stack. */
  stack: boolean;
}

/** Free width needed for the one-line bar (title, status and buttons side by side). */
export const BAR_ROW_FIT = 420;
/** Narrowest stacked bar that still reads. */
export const BAR_STACK_MIN = 150;
/** Air kept between the bar and a zone beside it. */
const BAR_EDGE = 8;
const TOP_EDGE = 8;

function valid(rect: BarRect): boolean {
  return rect.right > rect.left && rect.bottom > rect.top;
}

export function placeSelectBar({ board, emz, hands }: BarPlaceInput): BarPlace {
  const height = board.bottom - board.top;
  const zones = emz.filter(valid);
  const handRects = hands.filter(valid);

  let top: number | null = null;
  let left: number | null = null;
  let gap: number | null = null;

  if (zones.length >= 2) {
    const sorted = [...zones].sort((a, b) => a.left - b.left);
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    top = (Math.min(...zones.map((zone) => zone.top)) + Math.max(...zones.map((zone) => zone.bottom))) / 2 - board.top;
    left = (first.right + last.left) / 2 - board.left;
    gap = Math.max(0, last.left - first.right - 2 * BAR_EDGE);
  } else {
    // No Extra Monster Zones: the middle of the board sits halfway between the two hands.
    const middle = board.top + height / 2;
    const above = handRects.filter((hand) => (hand.top + hand.bottom) / 2 < middle);
    const below = handRects.filter((hand) => (hand.top + hand.bottom) / 2 >= middle);
    if (above.length > 0 && below.length > 0) {
      const y = (Math.max(...above.map((hand) => hand.bottom)) + Math.min(...below.map((hand) => hand.top))) / 2 - board.top;
      if (y >= height * 0.3 && y <= height * 0.7) top = y;
    }
    if (top == null && height > 0) top = height / 2;
  }

  // Too tight beside a pickable Extra Monster Zone: keep that zone clear and use the old top spot.
  if (gap != null && gap < BAR_STACK_MIN && zones.some((zone) => zone.legal)) {
    let edge = TOP_EDGE;
    for (const hand of handRects) {
      if ((hand.top + hand.bottom) / 2 < board.top + height / 2) {
        edge = Math.max(edge, Math.min(hand.bottom - board.top + 6, height * 0.3));
      }
    }
    return { mode: "top", top: Math.round(edge), left: null, fit: null, stack: false };
  }

  const stack = gap != null && gap < BAR_ROW_FIT;
  return {
    mode: "mid",
    top: top == null ? null : Math.round(top),
    left: left == null ? null : Math.round(left),
    fit: gap == null ? null : Math.round(stack ? Math.max(gap, BAR_STACK_MIN) : gap),
    stack,
  };
}

export function samePlace(a: BarPlace, b: BarPlace): boolean {
  return a.mode === b.mode && a.top === b.top && a.left === b.left && a.fit === b.fit && a.stack === b.stack;
}
