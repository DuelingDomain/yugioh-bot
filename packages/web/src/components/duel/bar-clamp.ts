/** The corners of an element on screen, as `getBoundingClientRect` gives them. */
export interface ClampRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface BarShift {
  dx: number;
  dy: number;
}

/** Keep this much (px) between the bar and the edge of the board. */
export const BAR_EDGE = 8;

/**
 * How far to move a bar so that it lies fully inside the board, `edge` from each side. `rect` is the bar as it is drawn now and
 * `shift` the move already applied to it, so the answer does not depend on how many times it runs. A bar larger than the board in
 * one direction starts at the near edge, so its text and buttons are the part in view.
 */
export function clampBarShift(rect: ClampRect, shift: BarShift, board: ClampRect, edge: number = BAR_EDGE): BarShift {
  const axis = (low: number, high: number, current: number, boardLow: number, boardHigh: number) => {
    const start = low - current;
    const end = high - current;
    const min = boardLow + edge;
    const max = boardHigh - edge;
    if (end - start > max - min) return Math.round(min - start);
    if (start < min) return Math.round(min - start);
    if (end > max) return Math.round(max - end);
    return 0;
  };
  return { dx: axis(rect.left, rect.right, shift.dx, board.left, board.right), dy: axis(rect.top, rect.bottom, shift.dy, board.top, board.bottom) };
}

export const sameShift = (a: BarShift, b: BarShift) => a.dx === b.dx && a.dy === b.dy;
