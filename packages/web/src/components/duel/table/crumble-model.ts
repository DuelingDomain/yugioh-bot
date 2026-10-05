import type { DuelCard, DuelSeatView } from "@yugidraft/shared/duels";
import { cardArtUrl, isFacedown } from "../constants";

/**
 * The pieces of the elimination crumble, pure. A seat board is 653 by 380 px at a card unit of 112 (a Master Rule 3
 * board is wider). The mat is cut into jittered triangles, every card into six, and a little dust is thrown over it.
 * The numbers (counts, delays, travel) are those of the approved demo; a seeded generator keeps them stable per seat.
 */

export const BOARD_H = 380;
const BOARD_W = 653;
/** Width of a Master Rule 3 board (7.35 card units of 112). */
const BOARD_W_MR3 = 823;
export const CARD_BACK = "/duel/card-back-main-hd.webp";

export function boardWidth(masterRule: number | undefined): number {
  return masterRule === 3 ? BOARD_W_MR3 : BOARD_W;
}

export interface CrumbleCard {
  x: number;
  y: number;
  w: number;
  h: number;
  src: string;
  back: boolean;
}

/** Column and row centres of the zones on a board, in board px. */
export const COL = [52, 151, 241, 326, 411, 501, 600];
export const ROW = [65, 190, 315];

/**
 * The cards on a board as flat rectangles, in board px: monster and spell zones, the extra monster zones, the field
 * zone, both piles (backs), the top of the graveyard and the hand. A hand shows its faces only when `faceUpHand`.
 */
export function crumbleCards(view: Pick<DuelSeatView, "monsters" | "spells" | "hand" | "graveyard" | "deckCount" | "extraCount">, options: { faceUpHand: boolean; width: number }): CrumbleCard[] {
  const stretch = options.width / BOARD_W;
  const out: CrumbleCard[] = [];
  const face = (card: DuelCard | null | undefined): { src: string; back: boolean } =>
    !card || card.code == null || isFacedown(card.position) ? { src: CARD_BACK, back: true } : { src: cardArtUrl(card.code), back: false };
  const at = (col: number, row: number, card: { src: string; back: boolean }, w = 76.8, h = 112, y = ROW[row]) =>
    out.push({ x: COL[col] * stretch - w / 2, y: y - h / 2, w, h, ...card });
  for (let i = 0; i < 5; i += 1) {
    if (view.monsters[i]) at(i + 1, 1, face(view.monsters[i]));
    if (view.spells[i]) at(i + 1, 2, face(view.spells[i]));
  }
  if (view.monsters[5]) at(2, 0, face(view.monsters[5]));
  if (view.monsters[6]) at(4, 0, face(view.monsters[6]));
  if (view.spells[5]) at(0, 1, face(view.spells[5]));
  if (view.extraCount > 0) at(0, 2, face(null));
  if (view.deckCount > 0) at(6, 2, face(null));
  const top = view.graveyard[view.graveyard.length - 1];
  if (top) at(6, 1, face(top));
  const count = view.hand.length;
  view.hand.forEach((card, index) => {
    if (options.faceUpHand) {
      const x = 326.5 * stretch + (index - (count - 1) / 2) * 62;
      out.push({ x: x - 29, y: 394, w: 58, h: 85, ...face(card) });
    } else {
      const x = 326.5 * stretch + (index - (count - 1) / 2) * 50;
      out.push({ x: x - 23, y: 372, w: 46, h: 67, ...face(null) });
    }
  });
  return out;
}

/** A small seeded generator, so a crumble looks the same on every render of the same seat. */
export function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** How one piece falls: when, for how long, and where it ends (board px, board-local axes). */
export interface Fall {
  delay: number;
  dur: number;
  z0: number;
  /** Small shift and turn at the first beat (offset 0.14). */
  pop: { x: number; y: number; z: number; rx: number; ry: number; rz: number };
  to: { x: number; y: number; z: number; rx: number; ry: number; rz: number };
}

export interface CrumbleTile {
  left: number;
  top: number;
  w: number;
  h: number;
  clip: string;
  fall: Fall;
}

export interface CrumbleShard {
  left: number;
  top: number;
  w: number;
  h: number;
  origin: string;
  clip: string;
  src: string;
  back: boolean;
  fall: Fall;
}

export interface CrumbleSpec {
  width: number;
  height: number;
  tiles: CrumbleTile[];
  cracks: Array<{ d: string; delay: number }>;
  shards: CrumbleShard[];
  dust: Array<{ x: number; y: number; delay: number; dur: number; to: { x: number; y: number; z: number } }>;
}

const XE = [0, 104.2, 198.6, 283.8, 369, 454.2, 548.6, 653];
const YE = [0, 130, 250, 380];
const PAIRS: ReadonlyArray<readonly [number, number]> = [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 0]];
type Point = readonly [number, number];

/**
 * Everything the crumble draws and how it moves. `rotateDeg` and `scale` are those of the seat: gravity is down on the
 * screen, so in board axes it is `(sin, cos)` of the turn, and travel is divided by the scale.
 */
export function buildCrumble(cards: readonly CrumbleCard[], pose: { rotateDeg: number; scale: number }, width: number, seed: number): CrumbleSpec {
  const rnd = mulberry(seed);
  const th = (pose.rotateDeg * Math.PI) / 180;
  const g = [Math.sin(th), Math.cos(th)];
  const lat = [Math.cos(th), -Math.sin(th)];
  const k = 1 / pose.scale;
  const stretch = width / BOARD_W;
  const impact = [width / 2 + (rnd() - 0.5) * 120, 190 + (rnd() - 0.5) * 70];
  const maxD = Math.hypot(330, 190);
  const mid = width / 2;

  const fall = (cx: number, cy: number, z0: number, extra: number): Fall => {
    const d = Math.hypot(cx - impact[0], cy - impact[1]) / maxD;
    const delay = 120 + d * 160 + rnd() * 40 + extra;
    const dur = 560 + rnd() * 130;
    const dist = (300 + rnd() * 340) * k;
    const sideways = (rnd() - 0.5) * 320 * k;
    const outward = (cx - mid) * 0.5 * (0.4 + rnd() * 0.6);
    const fx = g[0] * dist + lat[0] * sideways + lat[0] * outward * 0.2;
    const fy = g[1] * dist + lat[1] * sideways + lat[1] * outward * 0.2;
    const dz = -160 + rnd() * 420;
    const to = { x: fx, y: fy, z: z0 + dz, rx: (rnd() - 0.5) * 340, ry: (rnd() - 0.5) * 340, rz: (rnd() - 0.5) * 260 };
    const pop = 8 + rnd() * 14;
    return {
      delay,
      dur,
      z0,
      pop: { x: -g[0] * 3, y: -g[1] * 3, z: z0 + pop, rx: (rnd() - 0.5) * 10, ry: (rnd() - 0.5) * 10, rz: (rnd() - 0.5) * 6 },
      to,
    };
  };

  // Mat tiles: a jittered grid, every cell cut into two triangles.
  const xs = XE.map((x) => x * stretch);
  const grid: Point[][] = YE.map((y, j) => xs.map((x, i) => [
    x + (i === 0 || i === xs.length - 1 ? 0 : (rnd() - 0.5) * 34),
    y + (j === 0 || j === YE.length - 1 ? 0 : (rnd() - 0.5) * 34),
  ] as Point));
  const tris: Point[][] = [];
  for (let j = 0; j < YE.length - 1; j += 1) {
    for (let i = 0; i < xs.length - 1; i += 1) {
      const a = grid[j][i], b = grid[j][i + 1], c = grid[j + 1][i + 1], d = grid[j + 1][i];
      if (rnd() < 0.5) tris.push([a, b, c], [a, c, d]);
      else tris.push([a, b, d], [b, c, d]);
    }
  }
  const edges = new Map<string, readonly [Point, Point]>();
  for (const tri of tris) {
    for (const [p, q] of [[0, 1], [1, 2], [2, 0]] as const) {
      const a = tri[p], b = tri[q];
      const onEdge = (a[0] === 0 && b[0] === 0) || (a[0] === width && b[0] === width) || (a[1] === 0 && b[1] === 0) || (a[1] === BOARD_H && b[1] === BOARD_H);
      if (onEdge) continue;
      const key = [a, b].map((v) => v.map((n) => n.toFixed(1)).join(",")).sort().join("|");
      edges.set(key, [a, b]);
    }
  }
  const tiles: CrumbleTile[] = tris.map((tri) => {
    const px = tri.map((p) => p[0]);
    const py = tri.map((p) => p[1]);
    const left = Math.min(...px), top = Math.min(...py);
    const w = Math.max(...px) - left, h = Math.max(...py) - top;
    return {
      left,
      top,
      w,
      h,
      clip: `polygon(${tri.map((p) => `${(p[0] - left).toFixed(1)}px ${(p[1] - top).toFixed(1)}px`).join(",")})`,
      fall: fall(left + w / 2, top + h / 2, 0, 0),
    };
  });
  const cracks = [...edges.values()].map(([a, b]) => ({
    d: `M${a[0].toFixed(1)} ${a[1].toFixed(1)}L${b[0].toFixed(1)} ${b[1].toFixed(1)}`,
    delay: (Math.hypot((a[0] + b[0]) / 2 - impact[0], (a[1] + b[1]) / 2 - impact[1]) / maxD) * 130,
  }));

  // Card shards: every card is cut into six triangles around a point near its centre.
  const shards: CrumbleShard[] = [];
  for (const card of cards) {
    const cx = card.x + card.w / 2, cy = card.y + card.h / 2;
    const m = [rnd() * 0.4 + 0.3, rnd() * 0.4 + 0.3];
    const ring: Point[] = [[0, 0], [card.w / 2, 0], [card.w, 0], [card.w, card.h], [card.w / 2, card.h], [0, card.h]];
    for (const [p, q] of PAIRS) {
      const pts: Point[] = [[card.w * m[0], card.h * m[1]], ring[p], ring[q]];
      const mx = (pts[0][0] + pts[1][0] + pts[2][0]) / 3, my = (pts[0][1] + pts[1][1] + pts[2][1]) / 3;
      shards.push({
        left: card.x,
        top: card.y,
        w: card.w,
        h: card.h,
        origin: `${mx}px ${my}px`,
        clip: `polygon(${pts.map((pt) => `${pt[0].toFixed(1)}px ${pt[1].toFixed(1)}px`).join(",")})`,
        src: card.src,
        back: card.back,
        fall: fall(cx, cy, 8, 30),
      });
    }
  }

  const dust = Array.from({ length: 26 }, () => {
    const x = 20 + rnd() * (width - 40), y = 20 + rnd() * 340;
    const dist = (120 + rnd() * 240) * k, side = (rnd() - 0.5) * 200 * k, z = 20 + rnd() * 120;
    const dur = 520 + rnd() * 300, delay = 140 + rnd() * 320;
    return { x, y, delay, dur, to: { x: g[0] * dist + lat[0] * side, y: g[1] * dist + lat[1] * side, z } };
  });
  return { width, height: BOARD_H, tiles, cracks, shards, dust };
}
