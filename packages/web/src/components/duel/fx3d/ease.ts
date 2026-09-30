/** Small easing helpers shared by the effect timelines. Pure. */

export const clamp01 = (value: number): number => (value < 0 ? 0 : value > 1 ? 1 : value);

/** 0 before `a`, 1 after `b`, linear in between. */
export const ramp = (t: number, a: number, b: number): number => (b === a ? (t >= b ? 1 : 0) : clamp01((t - a) / (b - a)));

export const lerp = (a: number, b: number, k: number): number => a + (b - a) * k;

export const easeOutCubic = (k: number): number => 1 - Math.pow(1 - clamp01(k), 3);
export const easeInCubic = (k: number): number => Math.pow(clamp01(k), 3);
export const easeInOutCubic = (k: number): number => {
  const c = clamp01(k);
  return c < 0.5 ? 4 * c * c * c : 1 - Math.pow(-2 * c + 2, 3) / 2;
};
export const smoothstep = (a: number, b: number, t: number): number => {
  const k = ramp(t, a, b);
  return k * k * (3 - 2 * k);
};

/** 0 -> 1 -> 0 pulse: rises over [a, peak], falls over [peak, b]. */
export const pulse = (t: number, a: number, peak: number, b: number): number => ramp(t, a, peak) * (1 - ramp(t, peak, b));

/** A small seeded random generator (same as the one summon-fx uses), so effects replay the same. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
