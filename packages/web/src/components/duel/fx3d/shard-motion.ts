import { clamp01, mulberry32, smoothstep } from "./ease";
import type { CutKind, ShardPiece } from "./shard-layout";

/**
 * How the pieces of a broken card fly. Pure: `shardMotion` picks the launch of one piece and
 * `shardAt` gives its offset, turn, fade and size at a time after the break. World units are CSS
 * pixels with y UP (the same as the 3D scene), so gravity is negative.
 */

export type MotionMode = "burst" | "suck" | "sink";

export type ShardMotion = {
  mode: MotionMode;
  /** Launch speed, px/s, y up. */
  vx: number;
  vy: number;
  /** Turn, rad/s. */
  spin: number;
  /** px/s^2 on y (negative falls; a positive value floats up). */
  gravity: number;
  /** The piece waits this long after the break before it moves (a wave passing, a slower tear). */
  delay: number;
  /** Seconds until it has faded out. */
  life: number;
  /** For "suck": the offset from the piece to the point it is pulled into, px, y up. */
  pullX: number;
  pullY: number;
  /** How much of the launch heat (edge glow) the piece starts with, 0..1. */
  heat: number;
};

export type ShardState = { dx: number; dy: number; rot: number; alpha: number; scale: number; heat: number };

export type MotionInput = {
  kind: CutKind;
  /** Card size, px. */
  w: number;
  h: number;
  /** The blow's direction, unit, y DOWN (screen space). */
  dir: { x: number; y: number };
  mode?: MotionMode;
  /** "suck": the point the pieces fall into, relative to the card centre, px, y down. */
  pull?: { x: number; y: number };
  seed: number;
};

/** Launch speeds by cut kind: [outward px/s, along-blow px/s, gravity px/s^2, life s, spin]. */
const FEEL: Record<CutKind, { out: number; along: number; gravity: number; life: number; spin: number; lift: number }> = {
  slash: { out: 120, along: 190, gravity: -1500, life: 0.85, spin: 2.6, lift: 120 },
  claw: { out: 110, along: 170, gravity: -1400, life: 0.85, spin: 3.2, lift: 90 },
  beam: { out: 150, along: 260, gravity: -520, life: 0.9, spin: 4.5, lift: 60 },
  arcane: { out: 70, along: 60, gravity: 260, life: 1.0, spin: 2.2, lift: 40 },
  lightning: { out: 320, along: 220, gravity: -1300, life: 0.85, spin: 6, lift: 140 },
  flame: { out: 90, along: 80, gravity: -900, life: 0.95, spin: 3, lift: 70 },
  impact: { out: 200, along: 300, gravity: -1900, life: 0.8, spin: 3.4, lift: 210 },
  shatter: { out: 260, along: 160, gravity: -1500, life: 0.85, spin: 5, lift: 150 },
};

export function shardMotion(piece: ShardPiece, input: MotionInput, index: number): ShardMotion {
  const rand = mulberry32(input.seed * 7919 + index * 104729 + 3);
  const feel = FEEL[input.kind];
  const mode = input.mode ?? "burst";
  // Offset of the piece from the card centre, px, y up.
  const ox = (piece.cx - 0.5) * input.w;
  const oy = -(piece.cy - 0.5) * input.h;
  const olen = Math.hypot(ox, oy) || 1;
  if (mode === "suck") {
    const px = (input.pull?.x ?? 0) - ox;
    const py = -(input.pull?.y ?? 0) - oy;
    return { mode, vx: 0, vy: 0, spin: (rand() < 0.5 ? -1 : 1) * (5 + rand() * 4), gravity: 0, delay: rand() * 0.06, life: 0.55 + rand() * 0.1, pullX: px, pullY: py, heat: 0.4 };
  }
  if (mode === "sink") {
    return { mode, vx: (rand() - 0.5) * 30, vy: 0, spin: (rand() - 0.5) * 1.2, gravity: 0, delay: rand() * 0.05, life: 0.6, pullX: 0, pullY: -input.h * 0.9, heat: 0 };
  }
  const outward = feel.out * (0.55 + rand() * 0.9);
  const along = feel.along * (0.5 + rand() * 0.9);
  const vx = (ox / olen) * outward + input.dir.x * along + (rand() - 0.5) * 40;
  // dir.y points down the screen, so it flips for the y-up scene
  const vy = (oy / olen) * outward - input.dir.y * along + feel.lift * (0.4 + rand() * 0.9);
  const heavy = piece.area > 0.16 ? 0.75 : 1;
  return {
    mode,
    vx: vx * heavy,
    vy: vy * heavy,
    spin: (rand() < 0.5 ? -1 : 1) * feel.spin * (0.4 + rand() * 0.9) * (piece.area > 0.16 ? 0.5 : 1),
    gravity: feel.gravity * (0.85 + rand() * 0.3),
    delay: rand() * 0.035,
    life: feel.life * (0.85 + rand() * 0.25),
    pullX: 0,
    pullY: 0,
    heat: input.kind === "flame" || input.kind === "beam" || input.kind === "lightning" ? 1 : 0.6,
  };
}

/** The state of a piece `t` seconds after the break. Before its delay it sits in place, whole. */
export function shardAt(m: ShardMotion, t: number): ShardState {
  const s = Math.max(0, t - m.delay);
  const k = clamp01(s / m.life);
  const alpha = 1 - smoothstep(0.55, 1, k);
  const heat = m.heat * (1 - smoothstep(0, 0.6, k));
  if (m.mode === "suck") {
    // Spiral in: an ease-in pull with a swirl that tightens as the piece closes.
    const e = k * k * (3 - 2 * k);
    const swirl = (1 - e) * 1.4;
    const x = m.pullX * e;
    const y = m.pullY * e;
    return { dx: x * Math.cos(swirl * e) - y * Math.sin(swirl * e), dy: x * Math.sin(swirl * e) + y * Math.cos(swirl * e), rot: m.spin * s, alpha: 1 - smoothstep(0.7, 1, k), scale: 1 - 0.85 * e, heat };
  }
  if (m.mode === "sink") {
    const e = k * k;
    return { dx: m.vx * s, dy: m.pullY * e, rot: m.spin * s, alpha: 1 - smoothstep(0.6, 1, k), scale: 1 - 0.7 * e, heat: 0 };
  }
  return { dx: m.vx * s, dy: m.vy * s + 0.5 * m.gravity * s * s, rot: m.spin * s, alpha, scale: 1 - 0.22 * k, heat };
}
