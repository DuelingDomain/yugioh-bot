import { mulberry32 } from "./ease";

/**
 * How a destroyed card is cut into shards. Pure geometry: the card is the unit square (x right,
 * y DOWN, both 0..1), every piece is a convex polygon that is split into triangles, and the pieces
 * together cover the card exactly once. The 3D layer draws each triangle as a textured mesh; the
 * triangles of one piece move together. The style of the attack that broke the card picks the cut.
 */

export type Vec = [number, number];
export type Tri = [Vec, Vec, Vec];
export type ShardPiece = { tris: Tri[]; cx: number; cy: number; area: number };

export type CutKind = "slash" | "claw" | "beam" | "arcane" | "lightning" | "flame" | "impact" | "shatter";

const SQUARE: Vec[] = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1],
];

function polygonArea(poly: readonly Vec[]): number {
  let sum = 0;
  for (let i = 0; i < poly.length; i += 1) {
    const [x0, y0] = poly[i];
    const [x1, y1] = poly[(i + 1) % poly.length];
    sum += x0 * y1 - x1 * y0;
  }
  return Math.abs(sum) / 2;
}

/** Keeps the part of a convex polygon where `a*x + b*y + c >= 0` (Sutherland-Hodgman). */
export function clipPolygon(poly: readonly Vec[], a: number, b: number, c: number): Vec[] {
  const out: Vec[] = [];
  const side = (p: Vec): number => a * p[0] + b * p[1] + c;
  for (let i = 0; i < poly.length; i += 1) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    const sp = side(p);
    const sq = side(q);
    if (sp >= 0) out.push(p);
    if ((sp >= 0) !== (sq >= 0)) {
      const k = sp / (sp - sq);
      out.push([p[0] + (q[0] - p[0]) * k, p[1] + (q[1] - p[1]) * k]);
    }
  }
  return out;
}

function toPiece(poly: readonly Vec[]): ShardPiece | null {
  const area = polygonArea(poly);
  if (poly.length < 3 || area < 1e-5) return null;
  const tris: Tri[] = [];
  for (let i = 1; i < poly.length - 1; i += 1) tris.push([poly[0], poly[i], poly[i + 1]]);
  let cx = 0;
  let cy = 0;
  for (const [x, y] of poly) {
    cx += x;
    cy += y;
  }
  return { tris, cx: cx / poly.length, cy: cy / poly.length, area };
}

function pieces(polys: readonly Vec[][]): ShardPiece[] {
  return polys.map(toPiece).filter((piece): piece is ShardPiece => piece != null);
}

/** Cuts the square along parallel lines with the normal at `angle`; `offsets` are signed distances from the centre. */
function bandsAlong(angle: number, offsets: readonly number[]): Vec[][] {
  const nx = Math.cos(angle);
  const ny = Math.sin(angle);
  const edges = [-10, ...offsets, 10];
  const out: Vec[][] = [];
  for (let i = 0; i < edges.length - 1; i += 1) {
    let poly: Vec[] = SQUARE.map((p) => [p[0], p[1]] as Vec);
    // signed distance of p from the centre along the normal
    poly = clipPolygon(poly, nx, ny, -(nx * 0.5 + ny * 0.5) - edges[i]);
    poly = clipPolygon(poly, -nx, -ny, nx * 0.5 + ny * 0.5 + edges[i + 1]);
    out.push(poly);
  }
  return out;
}

/** A jittered grid: `cols` x `rows` cells whose inner corners are moved a little. */
function gridCells(cols: number, rows: number, rand: () => number, jitter: number): Vec[][] {
  const corner: Vec[][] = [];
  for (let r = 0; r <= rows; r += 1) {
    const line: Vec[] = [];
    for (let c = 0; c <= cols; c += 1) {
      const inner = r > 0 && r < rows && c > 0 && c < cols;
      const jx = inner ? (rand() - 0.5) * jitter * (1 / cols) : 0;
      const jy = inner ? (rand() - 0.5) * jitter * (1 / rows) : 0;
      line.push([c / cols + jx, r / rows + jy]);
    }
    corner.push(line);
  }
  const out: Vec[][] = [];
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      out.push([corner[r][c], corner[r][c + 1], corner[r + 1][c + 1], corner[r + 1][c]]);
    }
  }
  return out;
}

/** Where a ray from (cx, cy) at `angle` leaves the unit square. */
function rimPoint(cx: number, cy: number, angle: number): Vec {
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  const tx = dx === 0 ? Infinity : dx > 0 ? (1 - cx) / dx : -cx / dx;
  const ty = dy === 0 ? Infinity : dy > 0 ? (1 - cy) / dy : -cy / dy;
  const t = Math.min(tx, ty);
  return [cx + dx * t, cy + dy * t];
}

/** `count` wedges around (cx, cy); the corners of the card are added to the wedge that holds them. */
function wedges(count: number, cx: number, cy: number, rand: () => number): Vec[][] {
  const angles: number[] = [];
  for (let i = 0; i < count; i += 1) angles.push(((i + (rand() - 0.5) * 0.6) / count) * Math.PI * 2);
  angles.sort((a, b) => a - b);
  const cornerAngle = (p: Vec): number => Math.atan2(p[1] - cy, p[0] - cx);
  const out: Vec[][] = [];
  for (let i = 0; i < count; i += 1) {
    const a0 = angles[i];
    const a1 = angles[(i + 1) % count] + (i === count - 1 ? Math.PI * 2 : 0);
    const held: Array<{ p: Vec; a: number }> = [];
    for (const corner of SQUARE) {
      let a = cornerAngle(corner);
      while (a < a0) a += Math.PI * 2;
      if (a > a0 && a < a1) held.push({ p: corner, a });
    }
    held.sort((p, q) => p.a - q.a);
    out.push([[cx, cy], rimPoint(cx, cy, a0), ...held.map((entry) => entry.p), rimPoint(cx, cy, a1)]);
  }
  return out;
}

/**
 * The pieces a card breaks into. `detail` (0.5 to 1) thins the grid cuts for cheaper scenes.
 *   slash      two halves along a diagonal
 *   claw       three tears
 *   beam       a fine grid: the card comes apart in tiles
 *   arcane     a medium grid
 *   flame      a coarse grid: crumbling
 *   lightning  a burst of wedges from near the centre
 *   impact     a few big wedges
 *   shatter    ten wedges (a plain break)
 */
export function layoutShards(kind: CutKind, seed: number, detail = 1): ShardPiece[] {
  const rand = mulberry32(seed * 2654435761 + 17);
  const grid = (cols: number, rows: number, jitter: number): ShardPiece[] =>
    pieces(gridCells(Math.max(2, Math.round(cols * detail)), Math.max(2, Math.round(rows * detail)), rand, jitter));
  switch (kind) {
    case "slash": {
      const angle = (rand() < 0.5 ? 1 : -1) * (0.55 + rand() * 0.5) + Math.PI / 2;
      return pieces(bandsAlong(angle, [(rand() - 0.5) * 0.12]));
    }
    case "claw": {
      const angle = Math.PI / 2 + 0.5 + rand() * 0.3;
      return pieces(bandsAlong(angle, [-0.2 + (rand() - 0.5) * 0.06, 0.2 + (rand() - 0.5) * 0.06]));
    }
    case "beam":
      return grid(5, 4, 0.5);
    case "arcane":
      return grid(4, 4, 0.6);
    case "flame":
      return grid(4, 3, 0.7);
    case "lightning":
      return pieces(wedges(Math.max(6, Math.round(9 * detail)), 0.5 + (rand() - 0.5) * 0.24, 0.5 + (rand() - 0.5) * 0.24, rand));
    case "impact":
      return pieces(wedges(Math.max(4, Math.round(6 * detail)), 0.5 + (rand() - 0.5) * 0.2, 0.55 + (rand() - 0.5) * 0.2, rand));
    default:
      return pieces(wedges(Math.max(6, Math.round(10 * detail)), 0.5 + (rand() - 0.5) * 0.2, 0.5 + (rand() - 0.5) * 0.2, rand));
  }
}

export function totalArea(list: readonly ShardPiece[]): number {
  return list.reduce((sum, piece) => sum + piece.area, 0);
}

export function triangleCount(list: readonly ShardPiece[]): number {
  return list.reduce((sum, piece) => sum + piece.tris.length, 0);
}
