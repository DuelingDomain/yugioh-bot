/**
 * Pure math the wipe scenes share with the demo (.fx-demo/js/core.js). No three.js here, so the
 * planner (scene-plan.ts) and the unit tests can use it. The wipe scenes get it again through
 * effects/wipes/common.ts.
 */

/** The demo world: 1120 x 800 units, a card is 96 x 140, y goes UP. */
export const DEMO_W = 1120;
export const DEMO_H = 800;
export const DEMO_CW = 96;
export const DEMO_CH = 140;

/** Same hash as the demo: a number in [0, 1) from any number. */
export const hash1 = (n: number): number => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};

/**
 * Time freeze (Dark Hole): the world clock runs at `rate` inside [tf, tf + fd].
 * `fwd` maps real time to world time. `inv` maps world time (te) back to real time.
 */
export function timeWarp(tf: number, fd: number, rate: number): { fd: number; extra: number; fwd: (t: number) => number; inv: (te: number) => number } {
  return {
    fd,
    extra: fd * (1 - rate),
    fwd: (t) => (t < tf ? t : t < tf + fd ? tf + (t - tf) * rate : t - fd * (1 - rate)),
    inv: (te) => (te < tf ? te : te + fd * (1 - rate)),
  };
}
