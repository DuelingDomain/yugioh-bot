/**
 * Where the on-board "select cards" instruction bar sits.
 *
 * The bar is centred on the middle band of the board (the Extra Monster Zone row, between the two fields).
 * It is never squeezed: it needs BAR_MIN_WIDTH. When the free gap between the two Extra Monster Zones holds
 * that, the bar sits in the gap and is limited to it, so it covers no zone. When the gap is narrower:
 *   an Extra Monster Zone is a legal pick  the bar keeps that zone clear and goes to the top edge under
 *                                          the opponent's hand
 *   no Extra Monster Zone is a legal pick  the bar stays on the centre line at its normal width, over the
 *                                          zones (it has a solid panel and lets clicks through)
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
  /** Score plates the top spot keeps clear of (the Rooftop's far team plate). Optional: other boards pass none. */
  plates?: readonly BarRect[];
}

export interface BarPlace {
  mode: "mid" | "top";
  /** Centre line of the bar (mid) or its top edge (top), in board px. Null: not measurable, use 50%. */
  top: number | null;
  /** Horizontal centre in board px. Null: use 50%. */
  left: number | null;
  /** Room the bar must fit in, px. Null: no limit beyond its own max width. */
  fit: number | null;
  /** Too narrow for one row: the buttons go under the text. */
  stack: boolean;
}

/** Free width needed for the one-row bar (text and buttons side by side). Narrower: the buttons go under the text. */
export const BAR_ROW_FIT = 400;
/** Narrowest bar that still reads; a smaller gap is not used. Matches min-width in prompt-center.module.css. */
export const BAR_MIN_WIDTH = 240;
/** Widest bar. Matches max-width in prompt-center.module.css. */
export const BAR_MAX_WIDTH = 420;
/** Air kept between the bar and a zone beside it. */
const BAR_EDGE = 8;
const TOP_EDGE = 8;

function valid(rect: BarRect): boolean {
  return rect.right > rect.left && rect.bottom > rect.top;
}

export function placeSelectBar({ board, emz, hands, plates = [] }: BarPlaceInput): BarPlace {
  const height = board.bottom - board.top;
  const zones = emz.filter(valid);
  const handRects = hands.filter(valid);

  let top: number | null = null;
  let left: number | null = null;
  let gap: number | null = null;

  if (zones.length >= 2) {
    const sorted = [...zones].sort((a, b) => a.left - b.left);
    // The widest free span between two neighbours: with the Rooftop's four shared cells (two each side of the helipad)
    // that is the middle gap, not the whole band.
    let first = sorted[0];
    let last = sorted[1];
    for (let index = 2; index < sorted.length; index += 1) {
      if (sorted[index].left - sorted[index - 1].right > last.left - first.right) {
        first = sorted[index - 1];
        last = sorted[index];
      }
    }
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

  // Too narrow for the bar beside a pickable Extra Monster Zone: keep that zone clear and use the top spot.
  const narrow = gap != null && gap < BAR_MIN_WIDTH;
  if (narrow && zones.some((zone) => zone.legal)) {
    let edge = TOP_EDGE;
    for (const hand of handRects) {
      if ((hand.top + hand.bottom) / 2 < board.top + height / 2) {
        edge = Math.max(edge, Math.min(hand.bottom - board.top + 6, height * 0.3));
      }
    }
    // A plate in the upper half (the far team's LP) is kept clear the same way.
    for (const plate of plates.filter(valid)) {
      if ((plate.top + plate.bottom) / 2 < board.top + height / 2) {
        edge = Math.max(edge, Math.min(plate.bottom - board.top + 6, height * 0.3));
      }
    }
    return { mode: "top", top: Math.round(edge), left: null, fit: null, stack: false };
  }

  // A narrow gap with nothing to pick in it: stay centred at full width over the zones, not squeezed.
  const fit = gap == null || narrow ? null : Math.min(gap, BAR_MAX_WIDTH);
  return {
    mode: "mid",
    top: top == null ? null : Math.round(top),
    left: left == null ? null : Math.round(left),
    fit: fit == null ? null : Math.round(fit),
    stack: fit != null && fit < BAR_ROW_FIT,
  };
}

export function samePlace(a: BarPlace, b: BarPlace): boolean {
  return a.mode === b.mode && a.top === b.top && a.left === b.left && a.fit === b.fit && a.stack === b.stack;
}
