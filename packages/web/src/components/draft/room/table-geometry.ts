/** Pure table layout: ported from the mock's measure(), slots(), zone() and theme stack point. */
import { anchorPoint, type Pt } from "./room-model";

export interface Geometry {
  phone: boolean;
  cols: number;
  pad: number;
  gap: number;
  rows: number;
  tw: number;
  th: number;
  cw: number;
  ch: number;
  top: number;
  tilt: number;
  /** Uses the flat table layout with vertical scrolling. */
  tall: boolean;
  /** Expanded desktop theme packs keep their pool below the card zone. */
  themeBelow: boolean;
}

export interface Slot {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function measureTable(opts: {
  width: number;
  height: number;
  phone: boolean;
  theme: boolean;
  diskH: number;
  /** Largest configured or dealt pack; omitted sizes retain the base row budget. */
  packSize?: number;
}): Geometry {
  const { width, height, phone, theme, diskH } = opts;
  const packSize = opts.packSize ?? 0;
  const narrow = !phone && width < 820;
  const baseCols = phone ? 4 : narrow ? 5 : 8;
  let cols = baseCols;
  const pad = phone ? 14 : 30;
  const gap = phone ? 8 : 10;
  const baseRows = theme ? 2 : phone ? 4 : narrow ? 3 : 2;
  let rows = Math.max(baseRows, Math.ceil(packSize / cols));
  const themeBelow = theme && !phone && rows > baseRows;
  const poolBelow = theme && (phone || themeBelow);
  const top = phone ? 34 : 72;
  const extra = phone ? 54 : 74;
  const floor = phone ? 60 : 64;
  const widthCap = phone ? Math.min(width - 24, 560) : Math.min(980, width - 220);
  let tw = widthCap;
  let cw = (tw - pad * 2 - gap * (cols - 1)) / cols;
  const fit = (height - (phone ? diskH + 40 : 150)) / (phone ? 0.93 : 0.8);
  // Budget for the pool below phone and expanded desktop theme packs.
  const widthForHeight = (rowCount: number) =>
    ((fit - top - extra - (rowCount - 1) * gap - (poolBelow ? 22 : 0)) / (rowCount + (poolBelow ? 0.8 : 0))) *
    (59 / 86);
  let cwH = widthForHeight(rows);
  if (cwH < cw || (rows > baseRows && cw < floor)) {
    cw = Math.max(floor, Math.min(cw, cwH));
    tw = cw * cols + gap * (cols - 1) + pad * 2;
  }
  // Keep the flat mode after widening so perspective cannot shrink the minimum card width.
  const tall = cw > cwH || (rows > baseRows && cw <= floor);
  if (tall && !phone && packSize > baseRows * baseCols) {
    // Once the floor binds, use every column that fits within the original width cap.
    cols = Math.max(1, Math.floor((widthCap - pad * 2 + gap) / (floor + gap)));
    rows = Math.max(baseRows, Math.ceil(packSize / cols));
    cwH = widthForHeight(rows);
    cw = Math.max(floor, Math.min((widthCap - pad * 2 - gap * (cols - 1)) / cols, cwH));
    tw = cw * cols + gap * (cols - 1) + pad * 2;
  }
  const ch = (cw * 86) / 59;
  const poolRow = poolBelow ? ch * 0.8 + 22 : 0;
  const th = top + rows * ch + (rows - 1) * gap + extra + poolRow;
  // A flat table has no depth to compress the visible card widths through perspective.
  const tilt = tall ? 0 : phone ? 26 : 40;
  return { phone, cols, pad, gap, rows, tw, th, cw, ch, top, tilt, tall, themeBelow };
}

export function themeStackPoint(g: Geometry): Slot {
  if (g.phone || g.themeBelow) return { x: g.tw * 0.5 - g.cw * 0.4, y: g.th - g.ch * 0.8 - 40, w: g.cw * 0.8, h: g.ch * 0.8 };
  const zoneH = g.rows * g.ch + (g.rows - 1) * g.gap;
  return { x: g.pad + 6, y: g.top + (zoneH - g.ch) / 2 + 12, w: g.cw, h: g.ch };
}

export function packSlots(g: Geometry, n: number, theme: boolean): Slot[] {
  let big = n <= 4 ? (g.phone ? 1.3 : 1.5) : 1;
  let lane = 0;
  let avail = g.tw;
  if (theme && !g.phone && !g.themeBelow) {
    const st = themeStackPoint(g);
    lane = st.x + st.w + 24;
    avail = g.tw - lane - g.pad;
    big = Math.min(big, avail / Math.max(1, n * g.cw + (n - 1) * g.gap));
  }
  if (big > 1) {
    // an enlarged small pack stays one row, but never wider than the mat's inner width
    const inner = avail - (lane ? 0 : g.pad * 2);
    big = Math.max(1, Math.min(big, inner / Math.max(1, n * g.cw + (n - 1) * g.gap)));
  }
  const cw = g.cw * big;
  const ch = g.ch * big;
  const gap = g.gap * big;
  const cols = Math.max(1, big > 1 ? n : Math.min(n, g.cols));
  const rows = Math.max(1, Math.ceil(n / cols));
  const zoneH = g.rows * g.ch + (g.rows - 1) * g.gap;
  const blockH = rows * ch + (rows - 1) * gap;
  const y0 = Math.max(g.top, g.top + (zoneH - blockH) / 2);
  const out: Slot[] = [];
  for (let i = 0; i < n; i++) {
    const r = Math.floor(i / cols);
    const c = i % cols;
    const inRow = r === rows - 1 ? n - r * cols : cols;
    const rowW = inRow * cw + (inRow - 1) * gap;
    const x0 = lane ? lane + (avail - rowW) / 2 : (g.tw - rowW) / 2;
    out.push({ x: x0 + c * (cw + gap), y: y0 + r * (ch + gap), w: cw, h: ch });
  }
  return out;
}

export function anchorFor(g: Geometry, i: number, n: number): Pt {
  return anchorPoint(i, n, g.tw, g.th);
}

/** How far a slot's centre is from an anchor: the offset a card travels when it flies there. */
export function anchorDelta(target: Pt, s: Slot): Pt {
  return { x: target.x - (s.x + s.w / 2), y: target.y - (s.y + s.h / 2) };
}

/** Columns used by arrow-key movement. */
export function keyCols(count: number, g: Geometry): number {
  return count <= 4 ? Math.max(1, count) : g.cols;
}
