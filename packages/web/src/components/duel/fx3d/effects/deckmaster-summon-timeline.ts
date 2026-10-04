import { easeOutCubic, ramp } from "../ease";
import type { FxRect } from "../types";

/**
 * Timing of the Deck Master summon hologram (effect "summon:deckmaster", 3D mode only). Pure: no
 * three.js, no DOM, so it can be unit-tested. The look comes from the owner-approved demo
 * (.fx-demo/dm-hologram); this file keeps its beats as data and as small functions of time.
 *
 * All times are ms from the start of the effect unless the name says seconds.
 */
export const DM_PHASES = {
  /** The dock picture flies to the zone, with two trail ghosts behind it. */
  fly: [0, 340],
  /** Three gold rings form on the table, 70 ms apart (each grows over 360 ms). */
  rings: [140, 640],
  /** The purple cone lifts. */
  cone: [200, 550],
  /** The art builds bottom-up as a scanline hologram and rises. */
  build: [300, 700],
  /** The hologram floats at its peak; glitch blip 700-740. */
  hold: [700, 780],
  /** The hologram sinks onto the card's art window (blip 800-830). */
  settle: [780, 900],
  /** Rings and cone fade out; the hologram crossfades into the page card 900-1100. */
  out: [880, 1150],
} as const;

export const DM_TOTAL_MS = 1150;
/** Reduced motion: one gold ring and a purple glow, then the card. */
export const DM_REDUCED_MS = 320;
/** The page card is shown from here (its own 220 ms fade ends before the effect does). */
export const DM_SETTLE_MS = 900;
export const DM_REDUCED_SETTLE_MS = 100;
/** The V1 Deck Master summon slot: no effect may be longer than this. */
export const DM_SLOT_MAX_MS = 1200;
/** Fade of the page card after the settle beat. */
export const DM_CARD_FADE_MS = 220;
/** The three rings: radius as a fraction of the zone's short side. */
export const DM_RING_RADII = [0.5, 0.63, 0.78] as const;

/** What the bridge sends with the request (all rects in the canvas host's pixel space, y down). */
export type FxDeckMaster = {
  /** The dock (or chip) picture the Deck Master flies from. */
  from: FxRect;
  /** The page card standing in the zone; the hologram lands on its art window. Defaults to `request.rect`. */
  card?: FxRect;
  /** Table tilt in degrees (the CSS `--tilt` of `.sv-plane`; 0 when flat). */
  tiltDeg: number;
  /** prefers-reduced-motion: ring and glow only. */
  reduced?: boolean;
  /** Called once when the page card may be shown (the settle beat, or the end of the effect). */
  onSettle?: () => void;
};

export function dmDurationMs(reduced: boolean): number {
  return reduced ? DM_REDUCED_MS : DM_TOTAL_MS;
}

export function dmSettleMs(reduced: boolean): number {
  return reduced ? DM_REDUCED_SETTLE_MS : DM_SETTLE_MS;
}

/** Table tilt in radians from degrees; bad input and negative angles give 0. Capped at 45 degrees. */
export function tiltRadOf(deg: number | null | undefined): number {
  if (typeof deg !== "number" || !Number.isFinite(deg) || deg <= 0) return 0;
  return (Math.min(45, deg) * Math.PI) / 180;
}

/** Reads a CSS custom property value such as "15deg" or "8" as degrees. */
export function tiltDegOfCss(value: string | null | undefined): number {
  const n = Number.parseFloat(value ?? "");
  return Number.isFinite(n) && n > 0 ? n : 0;
}

const seg = (t: number, a: number, b: number): number => ramp(t, a, b);
const eExpo = (k: number): number => (k >= 1 ? 1 : 1 - Math.pow(2, -10 * k));
const eInOut = (k: number): number => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
const ms = (v: number): number => v / 1000;

export type DmFlier = { p: number; alpha: number };
export type DmRing = { scale: number; alpha: number; rot: number };
export type DmBeats = {
  /** Trail ghost 2, ghost 1, then the lead picture (draw order). */
  fliers: readonly [DmFlier, DmFlier, DmFlier];
  rings: readonly [DmRing, DmRing, DmRing];
  disc: number;
  cone: { grow: number; alpha: number };
  holo: { rise: number; sink: number; scale: number; reveal: number; alpha: number; glitch: number };
  settled: boolean;
};

const FLIER_ALPHA = [0.14, 0.28, 1] as const;

/** Every animated value at `t` seconds. */
export function dmBeats(t: number): DmBeats {
  const flier = (k: number): DmFlier => {
    const p = easeOutCubic(seg(t - 0.03 * k, ms(DM_PHASES.fly[0]), ms(DM_PHASES.fly[1])));
    const out = 1 - seg(t, 0.25, 0.36);
    const alpha = FLIER_ALPHA[2 - k]! * out * (t > 0.03 * k ? 1 : 0);
    return { p, alpha };
  };
  const ring = (i: number): DmRing => {
    const a0 = ms(DM_PHASES.rings[0]) + i * 0.07;
    const out = 1 - seg(t, i === 0 ? 0.98 : 0.9, i === 0 ? 1.15 : 1.05);
    return { scale: 0.3 + 0.7 * eExpo(seg(t, a0, a0 + 0.36)), alpha: (i === 1 ? 0.6 : 0.95) * seg(t, a0, a0 + 0.12) * out, rot: t * 1.3 };
  };
  const rise = eExpo(seg(t, ms(DM_PHASES.build[0]), 0.72));
  return {
    fliers: [flier(2), flier(1), flier(0)],
    rings: [ring(0), ring(1), ring(2)],
    disc: 0.3 * seg(t, 0.14, 0.4) * (1 - seg(t, 0.9, 1.12)),
    cone: { grow: easeOutCubic(seg(t, ms(DM_PHASES.cone[0]), ms(DM_PHASES.cone[1]))), alpha: 0.9 * seg(t, 0.2, 0.38) * (1 - seg(t, 0.88, 1.06)) },
    holo: {
      rise,
      sink: eInOut(seg(t, ms(DM_PHASES.settle[0]), ms(DM_PHASES.settle[1]))),
      scale: 0.55 + 0.45 * rise,
      reveal: easeOutCubic(seg(t, ms(DM_PHASES.build[0]), ms(DM_PHASES.build[1]))),
      alpha: seg(t, 0.3, 0.4) * (1 - seg(t, 0.9, 1.1)),
      glitch: (t > 0.7 && t < 0.74) || (t > 0.8 && t < 0.83) ? 1 : 0,
    },
    settled: t >= ms(DM_SETTLE_MS),
  };
}

export type DmReducedBeats = { ring: number; scale: number; glow: number; settled: boolean };

/** Reduced motion: a ring and a glow fade in and out; the card is shown at 100 ms. */
export function dmReducedBeats(t: number): DmReducedBeats {
  const k = seg(t, 0, 0.1) * (1 - seg(t, 0.1, ms(DM_REDUCED_MS)));
  return { ring: 0.95 * k, scale: 0.8 + 0.2 * easeOutCubic(seg(t, 0, 0.22)), glow: 0.3 * k, settled: t >= ms(DM_REDUCED_SETTLE_MS) };
}
