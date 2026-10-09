/** Rect helpers shared by the room planners (pick-bar-room.ts, strip-room.ts). All sizes are board px. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Both lists hold the same rects in the same order. */
export const sameRects = (a: readonly Rect[], b: readonly Rect[]) =>
  a.length === b.length && a.every((r, i) => r.x === b[i].x && r.y === b[i].y && r.width === b[i].width && r.height === b[i].height);

export const hits = (a: Rect, b: Rect) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/** The area two rects share. */
export const overlap = (a: Rect, b: Rect) =>
  Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));

/** A rect with `pad` more on every side. */
export const grow = (r: Rect, pad: number): Rect => ({ x: r.x - pad, y: r.y - pad, width: r.width + 2 * pad, height: r.height + 2 * pad });

/** The places along one axis (the last one, `high`, always), nearest `centre` first. */
export function along(low: number, high: number, size: number, centre: number, step: number): number[] {
  const out: number[] = [];
  for (let v = low; v < high; v += step) out.push(v);
  out.push(Math.max(low, high));
  return out.sort((a, b) => Math.abs(a + size / 2 - centre) - Math.abs(b + size / 2 - centre));
}

/**
 * A sum table of the grid cells (`step` px) that lie wholly inside one of `blocks`: a room that touches such a cell covers the block, found
 * in O(1). It misses a room that only clips a block's edge, so a room it passes is still tested against the blocks themselves.
 */
export function coverTable(box: { width: number; height: number }, blocks: readonly Rect[], step: number): (x: number, y: number, width: number, height: number) => boolean {
  const cols = Math.ceil(box.width / step);
  const rows = Math.ceil(box.height / step);
  const w = cols + 1;
  const sums = new Int32Array(w * (rows + 1));
  for (const block of blocks) {
    const c0 = Math.max(0, Math.ceil(block.x / step));
    const c1 = Math.min(cols, Math.floor((block.x + block.width) / step));
    const r0 = Math.max(0, Math.ceil(block.y / step));
    const r1 = Math.min(rows, Math.floor((block.y + block.height) / step));
    for (let r = r0; r < r1; r += 1) for (let c = c0; c < c1; c += 1) sums[(r + 1) * w + c + 1] = 1;
  }
  for (let r = 1; r <= rows; r += 1) {
    for (let c = 1; c <= cols; c += 1) {
      const at = r * w + c;
      sums[at] += sums[at - 1] + sums[at - w] - sums[at - w - 1];
    }
  }
  return (x, y, width, height) => {
    const c0 = Math.max(0, Math.floor(x / step));
    const c1 = Math.min(cols, Math.ceil((x + width) / step));
    const r0 = Math.max(0, Math.floor(y / step));
    const r1 = Math.min(rows, Math.ceil((y + height) / step));
    return sums[r1 * w + c1] - sums[r0 * w + c1] - sums[r1 * w + c0] + sums[r0 * w + c0] > 0;
  };
}

/** A raised hand card grows about this much of the hand's height above the hand, and this much of it to each side. */
const HAND_RISE = 1.15;
const HAND_SIDE = 0.4;

/** The hand with the room a raised card takes: a band above it and a margin at its sides. The planners keep off all of it. */
export function handReach(hand: Rect): Rect {
  const rise = hand.height * HAND_RISE;
  const side = hand.height * HAND_SIDE;
  return { x: hand.x - side, y: hand.y - rise, width: hand.width + 2 * side, height: hand.height + rise };
}
