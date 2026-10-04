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
  /** Pixels the table and the picks tray rise together so the group sits centred in the stage. */
  lift: number;
}

/** Perspective of `.scene` on desktop, and where it looks from (a fraction of the stage height). */
export const SCENE_PERSPECTIVE = 1500;
export const SCENE_ORIGIN_Y = 0.12;
/** Space between the stage floor and the bottom of the table box (the tray sits under it). */
export const TABLE_FLOOR = 26;
/** Height of a far seat's label stack (badge, name, state) above its anchor. */
export const SEAT_LABELS = 90;
/** The tray's own gap above the stage floor, before any lift. */
export const TRAY_GAP = 14;
/** The status pill lives at the top of the stage; the group never rises into it. */
export const TOP_CLEAR = 56;
/** Desktop tables may grow past the old 980px cap on stages taller than this, up to +30%. */
export const GROW_FROM = 900;
export const GROW_SPAN = 800;
export const GROW_MAX = 0.3;

/**
 * Where the top of the group (the far seat labels) lands, in stage pixels from the stage top, before any lift.
 * The table turns about its bottom edge and the scene projects it with the CSS perspective.
 */
export function groupTop(opts: { height: number; th: number; tilt: number; diskH: number }): number {
  const { height, th, tilt, diskH } = opts;
  const a = (tilt * Math.PI) / 180;
  const bottom = height - (diskH + TABLE_FLOOR);
  const oy = height * SCENE_ORIGIN_Y;
  // The far anchor sits 14px beyond the far edge, rotated about the bottom edge then projected.
  const reach = th + 14;
  const rise = reach * Math.cos(a);
  const away = reach * Math.sin(a);
  const y = oy + (bottom - rise - oy) * (SCENE_PERSPECTIVE / (SCENE_PERSPECTIVE + away));
  return y - SEAT_LABELS;
}

/** The lift that evens the empty space above the seat labels and below the tray. Never negative. */
export function tableLift(opts: { height: number; th: number; tilt: number; diskH: number }): number {
  const top = groupTop(opts);
  const even = (top - TRAY_GAP) / 2;
  return Math.max(0, Math.round(Math.min(even, top - TOP_CLEAR)));
}

export interface Slot {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Column counts a cube pack may be dealt across on a desktop table. */
const COLUMN_CHOICES = [5, 6, 7, 8];

/**
 * The column count that gives the widest cards, trying the mock's 5 to 8 across.
 * Ties go to more columns (a shorter table). Returns null when no choice reaches the card floor,
 * which leaves the table on its old layout.
 */
export function bestColumns(o: {
  packSize: number;
  baseRows: number;
  widthCap: number;
  pad: number;
  gap: number;
  top: number;
  extra: number;
  fit: number;
  floor: number;
}): number | null {
  let best: { cols: number; cw: number } | null = null;
  for (const cols of COLUMN_CHOICES) {
    const rows = Math.max(o.baseRows, Math.ceil(o.packSize / cols));
    const byWidth = (o.widthCap - o.pad * 2 - o.gap * (cols - 1)) / cols;
    const byHeight = ((o.fit - o.top - o.extra - (rows - 1) * o.gap) / rows) * (59 / 86);
    const cw = Math.min(byWidth, byHeight);
    if (cw < o.floor) continue;
    if (!best || cw > best.cw + 0.5 || (Math.abs(cw - best.cw) <= 0.5 && cols > best.cols)) best = { cols, cw };
  }
  return best ? best.cols : null;
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
  const pad = phone ? 14 : 30;
  const gap = phone ? 8 : 10;
  const baseRows = theme ? 2 : phone ? 4 : narrow ? 3 : 2;
  const top = phone ? 34 : 72;
  const extra = phone ? 54 : 74;
  const floor = phone ? 60 : 64;
  // A tall desktop stage lets the table grow into the spare height; narrow stages keep their width.
  const grow = phone || narrow ? 0 : Math.min(GROW_MAX, Math.max(0, (height - GROW_FROM) / GROW_SPAN));
  const widthCap = phone ? Math.min(width - 24, 560) : Math.min(980 * (1 + grow), width - 220);
  const fit = (height - (phone ? diskH + 40 : 150)) / (phone ? 0.93 : 0.8);
  // A cube pack that fits two rows of eight on a roomy desktop stage takes the widest layout that needs no
  // scrolling. Bigger packs keep the old layout and its flat scrolling fallback.
  let cols =
    !phone && !theme && !narrow && packSize > 0 && packSize <= baseRows * baseCols
      ? (bestColumns({ packSize, baseRows, widthCap, pad, gap, top, extra, fit, floor }) ?? baseCols)
      : baseCols;
  let rows = Math.max(baseRows, Math.ceil(packSize / cols));
  const themeBelow = theme && !phone && rows > baseRows;
  const poolBelow = theme && (phone || themeBelow);
  let tw = widthCap;
  let cw = (tw - pad * 2 - gap * (cols - 1)) / cols;
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
  // The flat scrolling table fills its stage and the phone layout is pinned to its strip: neither lifts.
  const lift = phone || tall ? 0 : tableLift({ height, th, tilt, diskH });
  return { phone, cols, pad, gap, rows, tw, th, cw, ch, top, tilt, tall, themeBelow, lift };
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
