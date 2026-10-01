import { timeWarp } from "./wipe-math";

/**
 * The numbers and the clock of the Mirror Force piece (port of the demo `sceneMirror`, .fx-demo/js/scenes.js).
 * Pure: the planner (scene-plan.ts) lays the victim times out with it, and the wipe (effects/wipes/mirror.ts)
 * draws with the same functions, so the break of a card and the beam that hits it always agree.
 *
 * Two clocks. DEMO time is the clock of the demo: the barrier is met at `th` (0.6 s), a short time-stop
 * follows (`TW`), and `te` is the world time that runs at a crawl inside the stop. SCENE time is the clock of
 * the piece in the game: the impact is at `hit` seconds. Without an attack in the snapshot `hit` is `th`
 * (the scene shows its own bolt) and both clocks are the same. With an incoming attack `hit` is the time that
 * attack lands: the barrier rises before it, and the part after the impact is the demo, shifted.
 */

export const MIRROR = {
  /** The demo impact (s) and the time the attacker's charge starts to fly. */
  th: 0.6,
  tl: 0.12,
  /** Reflected beams leave `tr - th` after the impact and fly at `spd` units per second. */
  tr: 0.72,
  spd: 820,
  /** A hit card cracks `breakLag` s after the beam arrives, and its pieces are gone `hold` s after that. */
  breakLag: 0.09,
  hold: 1.1,
  /** The wall cracks from `tcr` and its glass drops out from `tsh` (world time). */
  tcr: 1.1,
  tsh: 1.55,
  /** The time-stop: `fd` s of real time at `rate` speed. */
  fd: 0.15,
  rate: 0.04,
  /** The attacker leans toward its owner by `lunge` units. */
  lunge: 52,
  /** The wall stands this far from the middle line toward the caster (demo: 30 at a half gap of 158). */
  wallOff: 30,
  halfGap: 158,
  /** The impact is this far in front of the wall (toward the attacker side). */
  lift: 22,
  /** Landing streaks (world time `landAt`). */
  landAt: 2.0,
  landDur: 0.62,
  stagger: 0.045,
  spread: 0.25,
  /** The shortest piece (s) when the impact is `th`. */
  d: 3.0,
  /** The impact of an incoming attack is kept inside these bounds (s). */
  hitMin: 0.4,
  hitMax: 2.6,
} as const;

export type MirrorPt = { x: number; y: number };

const warp = timeWarp(MIRROR.th, MIRROR.fd, MIRROR.rate);

/** World time (te) from demo real time, and back. */
export const mirrorWorld = (t: number): number => warp.fwd(t);
export const mirrorReal = (te: number): number => warp.inv(te);
/** Real seconds the time-stop adds. */
export const MIRROR_STOP = warp.fd;

/** The impact time of the piece (s): the incoming attack's, or the demo's own. */
export function mirrorHitSec(attackImpactMs: number | null): number {
  if (attackImpactMs == null) return MIRROR.th;
  return Math.min(MIRROR.hitMax, Math.max(MIRROR.hitMin, attackImpactMs / 1000));
}

/**
 * Scene time -> demo real time. After the impact (and, when the impact is late, before it) it is a plain shift.
 * An impact earlier than the demo's compresses the build-up, so the barrier is still whole when the attack lands.
 */
export function mirrorDemoTime(ts: number, hit: number): number {
  if (hit < MIRROR.th && ts < hit) return (ts * MIRROR.th) / hit;
  return Math.max(0, ts - hit + MIRROR.th);
}

/** Demo real time -> scene time (the inverse of `mirrorDemoTime` for t >= 0). */
export function mirrorSceneTime(t: number, hit: number): number {
  if (hit < MIRROR.th && t < MIRROR.th) return (t * hit) / MIRROR.th;
  return t - MIRROR.th + hit;
}

/** Scene time of a world time (te): the time of a card break, a shake or a landing. */
export const mirrorAt = (te: number, hit: number): number => mirrorSceneTime(warp.inv(te), hit);

export type MirrorGeoInput = {
  /** Victims (world units). */
  wx: readonly number[];
  wy: readonly number[];
  /** The attacker's centre (world units), when it is known. */
  attacker: MirrorPt | null;
  ownerSide: "you" | "opp";
  /** World y of the monster row of each side (centre), when the board has it. */
  rowYou: number | null;
  rowOpp: number | null;
  /** An attack is incoming: the attacker stays where it stands (the page moved it, the piece does not). */
  incoming: boolean;
};

export type MirrorGeo = {
  /** Caster side (-1 bottom, +1 top; y goes up) and attacker side. */
  cs: 1 | -1;
  os: 1 | -1;
  /** World y of the middle of the wall and of the point the attack hits. */
  cyM: number;
  yI: number;
  /** World y of the line between both monster rows. */
  mid: number;
  /** Index of the victim that attacked (-1 without victims). */
  attacker: number;
  /** The impact point. */
  I: MirrorPt;
  /** Where each victim stands when its beam arrives (the attacker has leaned toward its owner). */
  at: MirrorPt[];
  /** World time the beam reaches each victim. */
  tb: number[];
  tbMin: number;
  tbMax: number;
};

/** The geometry both the plan and the wipe use. Fallbacks keep the demo layout when the board gives no rows. */
export function mirrorGeo(o: MirrorGeoInput): MirrorGeo {
  const n = o.wx.length;
  const cs: 1 | -1 = o.ownerSide === "you" ? -1 : 1;
  const os: 1 | -1 = cs === 1 ? -1 : 1;
  let mid = 0;
  let gap: number = MIRROR.halfGap;
  if (o.rowYou != null && o.rowOpp != null) {
    mid = (o.rowYou + o.rowOpp) / 2;
    gap = Math.max(40, Math.abs(o.rowOpp - o.rowYou) / 2);
  } else if (o.rowYou != null || o.rowOpp != null) {
    // One row only: the other is a demo half gap away on the far side.
    const row = (o.rowYou ?? o.rowOpp) as number;
    const side = o.rowYou != null ? -1 : 1;
    mid = row - side * MIRROR.halfGap;
  } else if (n > 0) {
    // No rows: the victims stand in the attacker's row, which is a half gap from the middle.
    mid = o.wy.reduce((sum, y) => sum + y, 0) / n + cs * MIRROR.halfGap;
  }
  const off = o.rowYou != null && o.rowOpp != null ? Math.min(60, Math.max(14, (MIRROR.wallOff / MIRROR.halfGap) * gap)) : MIRROR.wallOff;
  const cyM = mid + cs * off;
  const yI = cyM + os * MIRROR.lift;

  let attacker = -1;
  let best = Infinity;
  for (let i = 0; i < n; i += 1) {
    const score = o.attacker ? Math.hypot(o.wx[i] - o.attacker.x, o.wy[i] - o.attacker.y) : Math.abs(o.wx[i]);
    if (score < best - 1e-6) {
      best = score;
      attacker = i;
    }
  }
  const ax = attacker >= 0 ? o.wx[attacker] : 0;
  const I = { x: ax, y: yI };
  const lean = o.incoming ? 0 : MIRROR.lunge;
  const at: MirrorPt[] = o.wx.map((x, i) => ({ x, y: o.wy[i] + (i === attacker ? cs * lean : 0) }));
  const tb = at.map((p) => MIRROR.tr + Math.hypot(p.x - I.x, p.y - I.y) / MIRROR.spd);
  const tbMin = n ? Math.min(...tb) : MIRROR.tr + 0.2;
  const tbMax = n ? Math.max(...tb) : MIRROR.tr + 0.2;
  return { cs, os, cyM, yI, mid, attacker, I, at, tb, tbMin, tbMax };
}
