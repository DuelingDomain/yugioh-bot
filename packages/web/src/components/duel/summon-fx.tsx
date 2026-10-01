"use client";

/**
 * Board effects for summons, sets, activations and destruction.
 *
 * Heavy summons (Level/Rank 7+, Link 3+ or a Tribute Summon) get the full treatment: a holographic
 * projection of the card rises above its zone, drops onto it with weight, rings, rays and dust
 * burst in the colour of its summon type, the field shakes a little (strength set by the shake
 * preference) and a few cracks spread over the board before they fade. Fusion, Synchro, Xyz, Link,
 * Ritual and Pendulum Summons below that weight each have an animation of their own (vortex,
 * tuning rings, galaxy and overlay orbs, circuit grid, blue flames, pendulum arc), all under 1.6 s
 * and never blocking input. A plain Normal or Special Summon keeps its quick develop pop, sets
 * settle face-down, activations flip and light up, and destroyed cards break into shards that
 * drift to the Graveyard.
 *
 * Card movement itself (hand to zone, zone to Graveyard, draws) is MoveFx's job. When a "move"
 * event carries the card to the zone (see move-plan.ts), this layer does not animate the same
 * travel twice: a light summon or a set is only the landing of that flight (no pop of its own), a
 * heavy summon and an activation start when the flight lands, an activated card keeps its ring but
 * not its flip (the flight already brought it face-up), and a destroyed card cracks in place and
 * hands over to the flight to the Graveyard instead of scattering shards. Without a paired move
 * (older servers, missing anchors) every effect plays as before.
 *
 * Everything is a Web Animation on an overlay that never takes pointer input, so the board stays
 * usable. The real card is only hidden (never removed) while its projection lands on top of it.
 *
 * When the WebGL layer is ready (see fx3d/), the big summons (heavy and typed) are drawn by it
 * instead: Summon3dFx below only hides the real card, keeps the item alive, fires the sound cues and
 * asks the canvas to play the effect; the slam (shake, cracks, aura) still comes from ImpactFx. The
 * layer is chosen when the effect is planned, never mid-way, and the DOM effects stay the fallback
 * for reduced motion, missing WebGL, context loss and the moments before the canvas has loaded.
 */
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import type { DuelCardInfo, DuelEvent } from "@yugidraft/shared/duels";
import { cardArtUrl, LOCATION_GRAVE, LOCATION_PZONE, TYPE_LINK, TYPE_XYZ } from "./constants";
import {
  auraTintOf,
  collectFreshEvents,
  DUEL_FX_CUE_EVENT,
  findZoneElement,
  isHeavySummon,
  maxEventId,
  slamCrackCount,
  slamStrengthOf,
  summonCoveredByFlip,
  summonStyleOf,
  type DuelFxCue,
  type DuelFxCueDetail,
  type SummonStyle,
} from "./event-queue";
import { battleBreakIs3d, battleDestroyAt, HELD_CRACK_MS } from "./battle-hold";
import { chainEffectAt } from "./chain-beats";
import { hiddenHoldMs } from "./big-summon";
import { getSharedFx3d, setSharedFx3d } from "./fx3d/shared";
import { parseRgbTriplet } from "./fx3d/coords";
import { pickSummonRoute, summon3dKeyOf, summonEffectId } from "./fx3d/routing";
import { SUMMON3D_TIMELINE, shakeScaleOf, summon3dHitMs, summon3dLockMs, type Summon3dKey } from "./fx3d/timeline";
import type { Fx3dApi, FxRequest, FxTint } from "./fx3d/types";
import { useFx3d } from "./fx3d/use-fx3d";
import { holdPromptReveal } from "./prompt-reveal";
import { MOVE_TIMING, pairedMovePlan, planMoves, type MovePlan } from "./move-plan";
import type { DuelShakePreference } from "./preferences";
import styles from "./summon-fx.module.css";
import { safeAnimate } from "./safe-animate";

export type SummonFxProps = {
  /** engine.events (a rolling window; ids only grow). Play only events newer than the first render. */
  events: DuelEvent[];
  /** Changes when the room changes; reset the cursor on change. */
  duelKey: string;
  reducedMotion: boolean;
  shake: DuelShakePreference;
};

/** Milliseconds from the start of a heavy summon. Everything else is derived from these. */
export const HEAVY_TIMELINE = {
  rise: 320,
  hoverEnd: 520,
  impact: 640,
  handOver: 710,
  shake: 320,
  crackDraw: 150,
  crackFadeFrom: 900,
  /** Rays of light from the impact are gone by here. */
  raysEnd: 1080,
  total: 1300,
} as const;

/**
 * Peak vertical field shake in px for a Level 8 monster on a 1100px-wide board (horizontal is 0.45x).
 * Kept small on purpose: the weight is in the slam, the rings and the light, not in the shake.
 */
export const SHAKE_AMPLITUDE_PX: Record<DuelShakePreference, number> = {
  off: 0,
  low: 1.5,
  medium: 3.5,
  high: 7,
};

/**
 * The typed effects are authored on this timeline (ms from the start of the summon: when the real
 * card takes over, and when the effect is gone). Every duration and delay inside them plays at
 * TYPED_SCALE of these numbers (see Track.pace), which brings them to a human pace.
 */
const TYPED_AUTHORED: Record<SummonStyle, { handOver: number; total: number }> = {
  fusion: { handOver: 780, total: 1300 },
  synchro: { handOver: 800, total: 1350 },
  xyz: { handOver: 900, total: 1400 },
  link: { handOver: 720, total: 1250 },
  ritual: { handOver: 820, total: 1350 },
  pendulum: { handOver: 1080, total: 1500 },
};
export const TYPED_SCALE = 0.75;

/** The same timeline as it plays: when the real card takes over, and when the effect is gone. */
export const TYPED_TIMELINE = Object.fromEntries(
  (Object.keys(TYPED_AUTHORED) as SummonStyle[]).map((style) => [
    style,
    { handOver: Math.round(TYPED_AUTHORED[style].handOver * TYPED_SCALE), total: Math.round(TYPED_AUTHORED[style].total * TYPED_SCALE) },
  ]),
) as Record<SummonStyle, { handOver: number; total: number }>;

/** Light colours per summon type as "r g b" triplets: main light, secondary, accent. */
export type FxTone = "gold" | SummonStyle;
export const TONE_RGB: Record<FxTone, [string, string, string]> = {
  gold: ["244 226 180", "155 126 255", "130 200 255"],
  fusion: ["198 168 255", "255 150 70", "155 126 255"],
  synchro: ["240 244 255", "200 212 235", "255 255 255"],
  xyz: ["244 214 144", "120 90 200", "40 24 80"],
  link: ["120 190 255", "70 140 255", "150 240 255"],
  ritual: ["150 200 255", "70 120 255", "210 235 255"],
  pendulum: ["120 230 220", "244 214 144", "200 255 250"],
};

const TONE_LABEL: Record<SummonStyle, string> = {
  fusion: "Fusion",
  synchro: "Synchro",
  xyz: "Xyz",
  link: "Link",
  ritual: "Ritual",
  pendulum: "Pendulum",
};

function applyTone(el: HTMLElement | SVGElement | null, tone: FxTone): void {
  if (!el) return;
  const [a, b, c] = TONE_RGB[tone];
  el.style.setProperty("--fx-a", a);
  el.style.setProperty("--fx-b", b);
  el.style.setProperty("--fx-c", c);
}

const CARD_ASPECT = 0.686;
/** Gap between queued board effects (a chain link, a second summon), so each one reads on its own. */
const STAGGER_MS = 220;
const MAX_STAGGER_STEPS = 5;
/** A second slam waits this long after the first starts; the first one's aftermath overlaps it a little. */
const HEAVY_LOCK_MS = 1150;
const MAX_ITEMS = 10;
/** The WebGL summon holds the real card this much past its hand-over, in case the timer is late. */
const HAND_OVER_MARGIN_MS = 400;
const GY_LOCATION = LOCATION_GRAVE;

type FxKind = "heavy" | "typed" | "light" | "set" | "activate" | "destroy" | "impact";

/** Slam strengths are 0.6 to 1.6; the drop's squash scales with them inside this range. */
const SLAM_LOOK_MIN = 0.6;
const SLAM_LOOK_MAX = 1.6;
/** After the impact the field effects (cracks, aura, rings) last at most this long. */
const IMPACT_LIFE_MAX = 700;
const IMPACT_LIFE_MIN = 560;
/** The whole slam (drop, impact and aftermath) stays under about this many ms from the start of the summon. */
const SLAM_TOTAL_MS = 1300;

type FxItem = {
  key: string;
  kind: FxKind;
  /** Fusion/Synchro/Xyz/Link/Ritual/Pendulum: colours a heavy summon and picks the typed effect. */
  style: SummonStyle | null;
  event: DuelEvent;
  card: DuelCardInfo | null;
  delayMs: number;
  reduced: boolean;
  shake: DuelShakePreference;
  /** The card flight this effect follows (MoveFx draws it), if the server sent one. */
  plan: MovePlan | null;
  /** How hard the summon lands, 0.6 to 1.6 (0 when it does not slam). See slamStrengthOf. */
  strength: number;
  /** impact: how long the field effects last after the moment of impact. */
  life: number;
  /** destroy: ms the card cracks in place before it breaks; set when a battle holds the destroy. */
  breakMs?: number;
  /** The 3D layer draws the break of this card (shards and flash), so the DOM only holds the ghost. */
  claim3d?: boolean;
  /** Set when the WebGL layer draws this heavy or typed summon. */
  three?: { key: Summon3dKey; api: Fx3dApi } | null;
};

/**
 * Milliseconds from the start of a slamming summon to its moment of impact: the drop of a heavy
 * hologram, or the moment a typed summon's real card takes over.
 */
export function slamHitMs(kind: FxKind, style: SummonStyle | null, threeKey?: Summon3dKey | null): number {
  if (threeKey) return summon3dHitMs(threeKey);
  if (kind === "heavy") return HEAVY_TIMELINE.impact;
  return style ? TYPED_TIMELINE[style].handOver - 60 : 0;
}

/** How long the field effects of an impact last: as long as they can within the ~1.6 s total. */
export function impactLifeMs(hitMs: number): number {
  return clamp(SLAM_TOTAL_MS - hitMs, IMPACT_LIFE_MIN, IMPACT_LIFE_MAX);
}

/** Share of the neighbours' jolt that reaches a zone `dist` card widths from the impact (0 = none). */
export function joltFalloff(dist: number): number {
  const f = 1 / (1 + (dist / 1.2) * (dist / 1.2) * 1.1);
  return f < 0.06 ? 0 : f;
}

type Geo = {
  left: number;
  top: number;
  w: number;
  h: number;
  cx: number;
  cy: number;
  radius: number;
  overlayW: number;
  overlayH: number;
  side: "you" | "opp";
  defense: boolean;
};

/* ---------- small helpers ---------- */

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function measure(overlay: HTMLElement, zone: HTMLElement): Geo | null {
  const o = overlay.getBoundingClientRect();
  const z = zone.getBoundingClientRect();
  if (z.width < 4 || z.height < 4 || o.width < 4) return null;
  const h = z.height;
  const w = Math.min(z.width, h * CARD_ASPECT);
  const cx = z.left - o.left + z.width / 2;
  const cy = z.top - o.top + z.height / 2;
  return {
    left: cx - w / 2,
    top: cy - h / 2,
    w,
    h,
    cx,
    cy,
    radius: Math.max(2, w * 0.05),
    overlayW: o.width,
    overlayH: o.height,
    side: zone.dataset.side === "opp" ? "opp" : "you",
    defense: zone.dataset.defense === "true",
  };
}

function placeAnchor(anchor: HTMLElement, geo: Geo): void {
  anchor.style.left = `${geo.left}px`;
  anchor.style.top = `${geo.top}px`;
  anchor.style.width = `${geo.w}px`;
  anchor.style.height = `${geo.h}px`;
  anchor.style.setProperty("--fx-w", `${geo.w}px`);
  anchor.style.setProperty("--fx-h", `${geo.h}px`);
  anchor.style.setProperty("--fx-r", `${geo.radius}px`);
  // The opponent's cards face the other way: the copies drawn here turn with them (see summon-fx.module.css).
  anchor.dataset.side = geo.side;
}

/** The turn a card copy needs to match the real card: 180 degrees for the opponent, plus 90 in Defense Position. */
function copyTurn(geo: Geo): number {
  return (geo.side === "opp" ? 180 : 0) + (geo.defense ? 90 : 0);
}

function artOf(zone: HTMLElement): HTMLElement | null {
  return zone.querySelector<HTMLElement>("[data-card-art]");
}

/** The frame that holds the card art and its stat plate, so the whole card can be hidden at once. */
function cardBodyOf(zone: HTMLElement): HTMLElement | null {
  const art = artOf(zone);
  if (!art) return null;
  const body = art.parentElement?.parentElement;
  return body && body !== zone && zone.contains(body) ? body : art;
}

function emitCue(cue: DuelFxCue, strength = 1): void {
  if (typeof window === "undefined") return;
  const detail: DuelFxCueDetail = { cue, strength };
  window.dispatchEvent(new CustomEvent<DuelFxCueDetail>(DUEL_FX_CUE_EVENT, { detail }));
}

/** Collects animations and timers for one effect so cleanup is one call. */
export class Track {
  readonly anims: Animation[] = [];
  private readonly timers: number[] = [];
  private readonly cleanups: Array<() => void> = [];
  private origin = 0;
  private scale = 1;

  /**
   * From here on every duration, and every delay past `origin`, is multiplied by `scale`. The effect
   * is authored at one speed and played at another; the start (`origin`) does not move.
   */
  pace(origin: number, scale: number): void {
    this.origin = origin;
    this.scale = scale;
  }

  private at(ms: number): number {
    return ms >= this.origin ? this.origin + (ms - this.origin) * this.scale : ms;
  }

  play(el: Element | null | undefined, frames: Keyframe[], options: KeyframeAnimationOptions): Animation | null {
    if (!el || typeof el.animate !== "function") return null;
    const paced =
      this.scale === 1
        ? options
        : {
            ...options,
            delay: this.at(Number(options.delay ?? 0)),
            duration: typeof options.duration === "number" ? options.duration * this.scale : options.duration,
          };
    const anim = safeAnimate(el, frames, { fill: "both", ...paced });
    if (anim) this.anims.push(anim);
    return anim;
  }

  after(ms: number, fn: () => void): void {
    this.timers.push(window.setTimeout(fn, Math.max(0, this.at(ms))));
  }

  /** Runs `fn` when the track is disposed (an effect that lives outside the DOM stops with it). */
  onDispose(fn: () => void): void {
    this.cleanups.push(fn);
  }

  /** Resolves when every animation on the track has finished (a cancel counts as finished). */
  settled(): Promise<unknown> {
    return Promise.allSettled(this.anims.map((anim) => anim.finished));
  }

  dispose(): void {
    for (const timer of this.timers) window.clearTimeout(timer);
    for (const cleanup of this.cleanups) cleanup();
    for (const anim of this.anims) {
      try {
        anim.cancel();
      } catch {
        // already gone
      }
    }
  }
}

/**
 * Keeps the real card (art and stat plate) invisible from now for `ms`, then lets it back on its own.
 * That end is also the safety net: the hold is capped (see hiddenHoldMs), and cancelling the returned
 * animation, or disposing the track, shows the card at once.
 */
function holdHidden(track: Track, zone: HTMLElement, ms: number): Animation | null {
  const body = cardBodyOf(zone);
  return track.play(body, [{ opacity: 0 }, { opacity: 0 }], { duration: hiddenHoldMs(ms, 0), fill: "backwards" });
}

function shakeFrames(amp: number, seed: number): Keyframe[] {
  const steps = 14;
  const dir = seed % 2 === 0 ? 1 : -1;
  const frames: Keyframe[] = [];
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const decay = (1 - t) * (1 - t);
    const y = amp * decay * Math.sin(t * Math.PI * 2 * 2.5);
    const x = dir * amp * 0.45 * decay * Math.sin(t * Math.PI * 2 * 3.3);
    const r = dir * amp * 0.03 * decay * Math.sin(t * Math.PI * 2 * 2.1);
    frames.push({
      offset: t,
      transform: `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, 0) rotate(${r.toFixed(3)}deg)`,
    });
  }
  return frames;
}

function heavyWeight(card: DuelCardInfo | null, tribute: boolean): number {
  const level = card?.level ?? 0;
  if (level < 7) return tribute ? 0.8 : 1;
  return clamp(0.8 + (level - 7) * 0.1, 0.8, 1.25);
}

type CrackPath = { d: string; delay: number; span: number };

/** Fissures spreading from the zone across the board. Deterministic per event so a replay looks the same. */
function buildCracks(geo: Geo, count: number, seed: number, reach = 1): CrackPath[] {
  const rand = mulberry32(seed * 2654435761);
  const out: CrackPath[] = [];
  const base = rand() * Math.PI * 2;
  const start = geo.h * 0.42;
  for (let k = 0; k < count; k += 1) {
    const angle = base + (k / count) * Math.PI * 2 + (rand() - 0.5) * 0.7;
    const length = geo.h * (1.5 + rand() * 1.5) * reach;
    const segs = 5 + Math.floor(rand() * 2);
    let x = geo.cx + Math.cos(angle) * start;
    let y = geo.cy + Math.sin(angle) * start;
    let d = `M${x.toFixed(1)} ${y.toFixed(1)}`;
    const points: Array<[number, number, number]> = [];
    let a = angle;
    for (let s = 0; s < segs; s += 1) {
      a += (rand() - 0.5) * 0.7;
      const step = (length / segs) * (0.8 + rand() * 0.4);
      x += Math.cos(a) * step;
      y += Math.sin(a) * step;
      d += ` L${x.toFixed(1)} ${y.toFixed(1)}`;
      points.push([x, y, a]);
    }
    out.push({ d, delay: k * 12, span: 150 + rand() * 60 });
    const branchAt = points[1 + Math.floor(rand() * 2)];
    if (branchAt) {
      const side = rand() > 0.5 ? 1 : -1;
      let bx = branchAt[0];
      let by = branchAt[1];
      let ba = branchAt[2] + side * (0.55 + rand() * 0.4);
      let bd = `M${bx.toFixed(1)} ${by.toFixed(1)}`;
      for (let s = 0; s < 2; s += 1) {
        ba += (rand() - 0.5) * 0.5;
        const step = length * 0.16 * (0.8 + rand() * 0.5);
        bx += Math.cos(ba) * step;
        by += Math.sin(ba) * step;
        bd += ` L${bx.toFixed(1)} ${by.toFixed(1)}`;
      }
      out.push({ d: bd, delay: k * 12 + 60, span: 110 });
    }
  }
  return out;
}

/** Quads of a jittered 3x3 grid, a few split in two: the pieces a destroyed card breaks into. */
const SHARD_GRID: Array<Array<[number, number]>> = [
  [[0, 0], [34, 0], [67, 0], [100, 0]],
  [[0, 31], [38, 36], [63, 29], [100, 35]],
  [[0, 67], [30, 70], [69, 66], [100, 64]],
  [[0, 100], [35, 100], [66, 100], [100, 100]],
];

type Shard = { clip: string; cx: number; cy: number };

const SHARDS: Shard[] = (() => {
  const shards: Shard[] = [];
  for (let r = 0; r < 3; r += 1) {
    for (let c = 0; c < 3; c += 1) {
      const p = [SHARD_GRID[r][c], SHARD_GRID[r][c + 1], SHARD_GRID[r + 1][c + 1], SHARD_GRID[r + 1][c]];
      const split = (r + c) % 3 === 1;
      const polys = split ? [[p[0], p[1], p[2]], [p[0], p[2], p[3]]] : [p];
      for (const poly of polys) {
        const cx = poly.reduce((sum, pt) => sum + pt[0], 0) / poly.length;
        const cy = poly.reduce((sum, pt) => sum + pt[1], 0) / poly.length;
        shards.push({ clip: `polygon(${poly.map((pt) => `${pt[0]}% ${pt[1]}%`).join(", ")})`, cx, cy });
      }
    }
  }
  return shards;
})();

function levelLabel(card: DuelCardInfo | null, tribute: boolean, style: SummonStyle | null): string {
  if (tribute) return "Tribute Summon";
  if (!card) return "";
  const scale = (card.type & TYPE_LINK) !== 0 ? "Link" : (card.type & TYPE_XYZ) !== 0 ? "Rank" : "Level";
  const level = `${scale} ${card.level}`;
  return style ? `${TONE_LABEL[style]} · ${level}` : level;
}

/* ---------- effect components ---------- */

type EffectProps = {
  item: FxItem;
  overlay: HTMLElement;
  done: () => void;
};

/** Runs `setup` once after the DOM is committed and before paint, and tears down on unmount. */
function useEffectSetup(
  overlay: HTMLElement,
  item: FxItem,
  done: () => void,
  setup: (ctx: { track: Track; zone: HTMLElement; geo: Geo }) => void,
): void {
  const setupRef = useRef(setup);
  setupRef.current = setup;
  const doneRef = useRef(done);
  doneRef.current = done;
  useLayoutEffect(() => {
    const zone = findZoneElement(item.event.zone);
    const geo = zone ? measure(overlay, zone) : null;
    if (!zone || !geo) {
      doneRef.current();
      return undefined;
    }
    const track = new Track();
    let alive = true;
    setupRef.current({ track, zone, geo });
    void track.settled().then(() => {
      if (alive) doneRef.current();
    });
    return () => {
      alive = false;
      track.dispose();
    };
    // The item is immutable for its whole life: set up once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

function useAnchor() {
  return useRef<HTMLDivElement>(null);
}

/** A soft ring of light on the card outline. */
function pulseRing(track: Track, el: HTMLElement | null, delay: number, opts: { grow: number; duration: number; peak: number }): void {
  track.play(
    el,
    [
      { opacity: 0, transform: "scale(0.92)" },
      { opacity: opts.peak, transform: "scale(1)", offset: 0.28 },
      { opacity: 0, transform: `scale(${opts.grow})` },
    ],
    { duration: opts.duration, delay, easing: "cubic-bezier(0.2, 0.7, 0.2, 1)" },
  );
}

/** Reduced motion: no travel, just a short glow on the zone. */
function GlowFx({ item, overlay, done, tone }: EffectProps & { tone: "gold" | "violet" | "red" | "typed" }) {
  const anchor = useAnchor();
  const glow = useRef<HTMLSpanElement>(null);
  useEffectSetup(overlay, item, done, ({ track, geo }) => {
    if (anchor.current) placeAnchor(anchor.current, geo);
    if (tone === "typed") applyTone(anchor.current, item.style ?? "gold");
    track.play(glow.current, [{ opacity: 0 }, { opacity: 0.95, offset: 0.25 }, { opacity: 0 }], {
      duration: 320,
      delay: item.delayMs,
      easing: "ease-out",
    });
  });
  return (
    <div ref={anchor} className={styles.anchor}>
      <span ref={glow} className={styles.glow} data-tone={tone} />
    </div>
  );
}

/** Level 6 and below: the card develops in place with a small lift and a thin ring. About 450 ms, the landing of a normal summon. */
function LightFx({ item, overlay, done }: EffectProps) {
  const anchor = useAnchor();
  const ring = useRef<HTMLSpanElement>(null);
  useEffectSetup(overlay, item, done, ({ track, zone, geo }) => {
    if (anchor.current) placeAnchor(anchor.current, geo);
    const art = artOf(zone);
    const lift = geo.side === "opp" ? 1 : -1;
    track.play(
      art,
      [
        { filter: "brightness(0.2) saturate(0.2)", opacity: 0.4, translate: `0 ${lift * -6}%`, scale: "0.9" },
        { filter: "brightness(1.45) saturate(1.1)", opacity: 1, translate: "0 0", scale: "1.035", offset: 0.55 },
        { filter: "brightness(1) saturate(1)", opacity: 1, translate: "0 0", scale: "1" },
      ],
      { duration: 450, delay: item.delayMs, easing: "cubic-bezier(0.22, 0.8, 0.3, 1)" },
    );
    pulseRing(track, ring.current, item.delayMs, { grow: 1.22, duration: 480, peak: 0.7 });
  });
  return (
    <div ref={anchor} className={styles.anchor}>
      <span ref={ring} className={styles.ring} data-tone="gold" />
    </div>
  );
}

/** Set: the card slides in face-down from its owner's side and settles with a small overshoot. */
function SetFx({ item, overlay, done }: EffectProps) {
  const anchor = useAnchor();
  const shadow = useRef<HTMLSpanElement>(null);
  useEffectSetup(overlay, item, done, ({ track, zone, geo }) => {
    if (anchor.current) placeAnchor(anchor.current, geo);
    const from = geo.side === "opp" ? -34 : 34;
    track.play(
      artOf(zone),
      [
        { opacity: 0, translate: `0 ${from}%`, scale: "1.12" },
        { opacity: 1, translate: "0 -3%", scale: "0.985", offset: 0.62 },
        { opacity: 1, translate: "0 0", scale: "1" },
      ],
      { duration: 450, delay: item.delayMs, easing: "cubic-bezier(0.2, 0.75, 0.3, 1)" },
    );
    track.play(shadow.current, [{ opacity: 0, transform: "scale(1.25)" }, { opacity: 0.55, offset: 0.6 }, { opacity: 0, transform: "scale(1)" }], {
      duration: 500,
      delay: item.delayMs,
      easing: "ease-out",
    });
  });
  return (
    <div ref={anchor} className={styles.anchor}>
      <span ref={shadow} className={styles.softShadow} />
    </div>
  );
}

/** Activate: the card flips face-up and brightens; a chain link gets a gold edge, others a violet one. */
function ActivateFx({ item, overlay, done }: EffectProps) {
  const anchor = useAnchor();
  const edge = useRef<HTMLSpanElement>(null);
  const ghost = useRef<HTMLDivElement>(null);
  const chain = item.event.chainIndex != null;
  useEffectSetup(overlay, item, done, ({ track, zone, geo }) => {
    if (anchor.current) placeAnchor(anchor.current, geo);
    const art = artOf(zone);
    const flat = !geo.defense;
    const frames: Keyframe[] = [
      { filter: "brightness(0.55)", transform: flat ? "perspective(520px) rotateY(84deg)" : "none", opacity: 0.6 },
      { filter: "brightness(1.6)", transform: flat ? "perspective(520px) rotateY(-6deg)" : "none", opacity: 1, offset: 0.55 },
      { filter: "brightness(1)", transform: flat ? "perspective(520px) rotateY(0deg)" : "none", opacity: 1 },
    ];
    if (item.plan) {
      // The flight already brought the card face-up onto the zone: only the ring marks the activation.
    } else if (art) {
      track.play(art, frames, { duration: 560, delay: item.delayMs, easing: "cubic-bezier(0.25, 0.8, 0.3, 1)" });
    } else if (ghost.current) {
      // The card already left the zone (it resolved): flip a copy in place so the activation still reads.
      track.play(ghost.current, [{ opacity: 0, transform: "perspective(520px) rotateY(84deg)" }, { opacity: 1, transform: "perspective(520px) rotateY(0deg)", offset: 0.4 }, { opacity: 1, offset: 0.75 }, { opacity: 0 }], {
        duration: 800,
        delay: item.delayMs,
        easing: "cubic-bezier(0.25, 0.8, 0.3, 1)",
      });
    }
    pulseRing(track, edge.current, item.delayMs + 80, { grow: 1.16, duration: 700, peak: 1 });
  });
  return (
    <div ref={anchor} className={styles.anchor}>
      <span ref={edge} className={styles.ring} data-tone={chain ? "gold" : "violet"} data-strong="true" />
      {item.card && !item.plan ? (
        <div ref={ghost} className={styles.flipGhost}>
          <img className={styles.ghostArt} src={cardArtUrl(item.card.code, "small")} alt="" draggable={false} />
        </div>
      ) : null}
    </div>
  );
}

/** Destroy: hairline cracks flash red across the card, it bursts into shards that drift to the Graveyard. */
function DestroyFx({ item, overlay, done }: EffectProps) {
  const anchor = useAnchor();
  const whole = useRef<HTMLDivElement>(null);
  const shards = useRef<Array<HTMLSpanElement | null>>([]);
  const crackSvg = useRef<SVGSVGElement>(null);
  const flash = useRef<HTMLSpanElement>(null);
  const card = item.card;
  const seed = item.event.id;
  const handoff = item.plan != null;
  const claimed = item.claim3d === true;
  useEffectSetup(overlay, item, done, ({ track, geo }) => {
    if (anchor.current) placeAnchor(anchor.current, geo);
    const d = item.delayMs;
    const breakAt = item.breakMs ?? (item.event.cause === "battle" ? MOVE_TIMING.destroyBreakBattleMs : MOVE_TIMING.destroyBreakMs);
    // With a flight to the Graveyard the card ends here and MoveFx picks it up at the break. A break
    // the canvas claimed keeps the full length: if the canvas dies first, the DOM shards play instead.
    const burst = handoff ? (claimed ? 300 : 60) : 560;
    const total = breakAt + burst;
    track.after(d + breakAt, () => emitCue("shatter", 1));

    const gy = findZoneElement({
      controller: item.event.zone?.controller ?? 0,
      location: GY_LOCATION,
      sequence: 0,
    });
    const gyGeo = gy ? measure(overlay, gy) : null;
    const dxGy = gyGeo ? gyGeo.cx - geo.cx : 0;
    const dyGy = gyGeo ? gyGeo.cy - geo.cy : geo.side === "opp" ? -geo.h : geo.h;

    // The card stands as it was until the break, with a red rim and the fissures appearing.
    track.play(
      whole.current,
      [
        { opacity: 1, filter: "brightness(1)", transform: "translate(0, 0)" },
        { opacity: 1, filter: "brightness(1)", offset: Math.max(0, breakAt - 130) / total },
        { opacity: 1, filter: "brightness(1.7) saturate(1.2)", transform: "translate(-1.5px, 0)", offset: Math.max(0, breakAt - 70) / total },
        { opacity: 1, filter: "brightness(1.2)", transform: "translate(1.5px, 0)", offset: Math.max(0, breakAt - 20) / total },
        { opacity: 0, offset: Math.min(0.999, breakAt / total) },
        { opacity: 0 },
      ],
      { duration: total, delay: d, easing: "linear" },
    );
    track.play(
      crackSvg.current,
      [{ opacity: 0 }, { opacity: 0, offset: Math.max(0, breakAt - 190) / total }, { opacity: 1, offset: Math.max(0, breakAt - 90) / total }, { opacity: 1, offset: Math.min(0.999, breakAt / total) }, { opacity: 0 }],
      { duration: total, delay: d, easing: "linear" },
    );
    const playFlash = (delay: number) =>
      track.play(flash.current, [{ opacity: 0 }, { opacity: 0.8, offset: 0.35 }, { opacity: 0 }], {
        duration: 280,
        delay,
        easing: "ease-out",
      });

    const rand = mulberry32(seed * 40503 + 7);
    const playShards = (delay: number, skip: number) => shards.current.forEach((el, index) => {
      const shard = SHARDS[index];
      if (!el || !shard || handoff) return;
      const ox = (shard.cx - 50) / 50;
      const oy = (shard.cy - 50) / 50;
      const burstX = ox * geo.w * (0.32 + rand() * 0.22);
      const burstY = oy * geo.h * (0.2 + rand() * 0.14) - geo.h * 0.05;
      const spin = (rand() - 0.5) * 70 + ox * 24;
      const lag = rand() * 70;
      const flyX = dxGy * (0.7 + rand() * 0.25) + burstX * 0.3;
      const flyY = dyGy * (0.7 + rand() * 0.25) + burstY * 0.3;
      const anim = track.play(
        el,
        [
          { opacity: 0, transform: "translate(0, 0) rotate(0deg) scale(1)", offset: 0 },
          { opacity: 0, transform: "translate(0, 0) rotate(0deg) scale(1)", offset: Math.max(0, breakAt - 1) / (breakAt + burst + lag) },
          { opacity: 1, transform: "translate(0, 0) rotate(0deg) scale(1)", offset: breakAt / (breakAt + burst + lag), easing: "cubic-bezier(0.1, 0.7, 0.3, 1)" },
          { opacity: 1, transform: `translate(${burstX}px, ${burstY}px) rotate(${spin * 0.6}deg) scale(1.02)`, offset: (breakAt + 150) / (breakAt + burst + lag), easing: "cubic-bezier(0.5, 0, 0.75, 0.4)" },
          { opacity: 0, transform: `translate(${flyX}px, ${flyY}px) rotate(${spin * 1.6}deg) scale(0.3)` },
        ],
        { duration: breakAt + burst + lag, delay, easing: "linear" },
      );
      if (anim && skip > 0) anim.currentTime = skip;
    });
    if (!claimed) {
      playFlash(d + breakAt - 20);
      playShards(d, 0);
      return;
    }
    // Failsafe: the canvas claimed this break, but it can be lost or unmounted before the break.
    // Then the card must still visibly break here instead of only fading out.
    track.after(d + breakAt - 20, () => {
      if (getSharedFx3d()) return;
      playFlash(0);
      playShards(0, breakAt - 20);
    });
  });

  const cracks = (() => {
    // Fissures drawn straight onto the card face (0..100 box), red-lit.
    const rand = mulberry32(seed * 977 + 3);
    const lines: string[] = [];
    for (let i = 0; i < 4; i += 1) {
      let x = 50 + (rand() - 0.5) * 30;
      let y = 50 + (rand() - 0.5) * 30;
      let path = `M${x.toFixed(1)} ${y.toFixed(1)}`;
      const dir = (i / 4) * Math.PI * 2 + rand() * 0.8;
      let a = dir;
      for (let s = 0; s < 4; s += 1) {
        a += (rand() - 0.5) * 0.9;
        x += Math.cos(a) * 15;
        y += Math.sin(a) * 15;
        path += ` L${x.toFixed(1)} ${y.toFixed(1)}`;
      }
      lines.push(path);
    }
    return lines;
  })();

  return (
    <div ref={anchor} className={styles.anchor}>
      <div ref={whole} className={styles.destroyWhole}>
        {card ? <img className={styles.ghostArt} src={cardArtUrl(card.code, "small")} alt="" draggable={false} /> : null}
        <span className={styles.destroyRim} />
        <svg ref={crackSvg} className={styles.cardCracks} viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          {cracks.map((path, index) => (
            <path key={index} d={path} />
          ))}
        </svg>
      </div>
      {(handoff ? [] : SHARDS).map((shard, index) => (
        <span
          key={index}
          ref={(el) => {
            shards.current[index] = el;
          }}
          className={styles.shard}
          style={{ clipPath: shard.clip, transformOrigin: `${shard.cx}% ${shard.cy}%` } as CSSProperties}
        >
          <i className={styles.shardArt} style={{ backgroundImage: card ? `url(${cardArtUrl(card.code, "small")})` : undefined }} />
        </span>
      ))}
      <span ref={flash} className={styles.breakFlash} />
    </div>
  );
}

const DUST_COUNT = 10;

/** Heavy summon: holographic projection, slam, impact rings and dust, field shake, fading cracks. */
function HeavyFx({ item, overlay, done }: EffectProps) {
  const anchor = useAnchor();
  const stage = useRef<HTMLDivElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const art = useRef<HTMLImageElement>(null);
  const foil = useRef<HTMLElement>(null);
  const scan = useRef<HTMLElement>(null);
  const edge = useRef<HTMLElement>(null);
  const plate = useRef<HTMLSpanElement>(null);
  const beam = useRef<HTMLSpanElement>(null);
  const pad = useRef<HTMLSpanElement>(null);
  const shadow = useRef<HTMLSpanElement>(null);
  const ring = useRef<HTMLSpanElement>(null);
  const ring2 = useRef<HTMLSpanElement>(null);
  const burst = useRef<HTMLSpanElement>(null);
  const rays = useRef<HTMLSpanElement>(null);
  const dust = useRef<Array<HTMLSpanElement | null>>([]);
  const tribute = item.event.summonKind === "tribute";
  const cardInfo = item.card;
  const tone: FxTone = item.style ?? "gold";
  const T = HEAVY_TIMELINE;

  useEffectSetup(overlay, item, done, ({ track, zone, geo }) => {
    const d = item.delayMs;
    const weight = heavyWeight(cardInfo, tribute);
    if (anchor.current) placeAnchor(anchor.current, geo);
    applyTone(anchor.current, tone);
    if (stage.current) stage.current.style.perspective = `${Math.round(geo.w * 5)}px`;

    // Which way the projection rises: up when there is room, otherwise toward the middle of the board.
    const need = geo.h * 0.62 + geo.h * 0.25;
    const spaceUp = geo.top - 6;
    const spaceDown = geo.overlayH - (geo.top + geo.h) - 6;
    const up = spaceUp >= need * 0.7 || spaceUp >= spaceDown;
    const room = up ? spaceUp : spaceDown;
    const lift = clamp(Math.min(geo.h * 0.62, room - geo.h * 0.23), geo.h * 0.14, geo.h * 0.62);
    const dir = up ? -1 : 1;
    const rise = dir * lift;
    if (card.current) card.current.style.transformOrigin = up ? "50% 92%" : "50% 8%";
    if (plate.current) {
      // Caption on the open side of the card, away from its neighbours.
      plate.current.style.top = up ? "auto" : `calc(100% + ${geo.w * 0.06}px)`;
      plate.current.style.bottom = up ? `calc(100% + ${geo.w * 0.06}px)` : "auto";
    }
    if (beam.current) {
      beam.current.style.height = `${lift + geo.h * 0.2}px`;
      beam.current.style[up ? "bottom" : "top"] = `${geo.h * 0.1}px`;
      beam.current.style.transformOrigin = up ? "50% 100%" : "50% 0%";
      beam.current.style.clipPath = up
        ? "polygon(24% 0, 76% 0, 100% 100%, 0 100%)"
        : "polygon(0 0, 100% 0, 76% 100%, 24% 100%)";
      beam.current.style.background = up
        ? "linear-gradient(to top, rgb(var(--fx-c) / 0.3), rgb(var(--fx-b) / 0.05) 78%, transparent)"
        : "linear-gradient(to bottom, rgb(var(--fx-c) / 0.3), rgb(var(--fx-b) / 0.05) 78%, transparent)";
    }

    // The real card waits underneath until the projection has landed.
    holdHidden(track, zone, d + T.handOver);

    const tilt = up ? 1 : -1;
    const at = (ms: number) => ms / T.handOver;
    const slamEase = "cubic-bezier(0.62, 0, 0.95, 0.4)";
    const riseEase = "cubic-bezier(0.16, 1, 0.3, 1)";
    // The drop: it hangs big above the zone, falls hard, stops dead (a squash that scales with the
    // strength of the slam), springs back a hair and rests.
    const s = clamp(item.strength || 1, SLAM_LOOK_MIN, SLAM_LOOK_MAX);
    const hang = 1.2 + 0.08 * s;
    const squashX = 1 + 0.05 * s;
    const squashY = 1 - 0.065 * s;
    track.play(
      card.current,
      [
        { opacity: 0, transform: `translate3d(0, 0, 0) rotateX(${tilt * 34}deg) scale(0.74)`, offset: 0, easing: riseEase },
        { opacity: 1, transform: `translate3d(0, ${rise}px, 0) rotateX(${tilt * 14}deg) scale(${hang - 0.01})`, offset: at(T.rise) },
        { opacity: 1, transform: `translate3d(0, ${rise * 1.04}px, 0) rotateX(${tilt * 10}deg) scale(${hang})`, offset: at(T.hoverEnd), easing: slamEase },
        { opacity: 1, transform: `translate3d(0, 0, 0) rotateX(0deg) scale(${squashX}, ${squashY})`, offset: at(T.impact), easing: "cubic-bezier(0.2, 0.9, 0.3, 1)" },
        { opacity: 1, transform: `translate3d(0, 0, 0) rotateX(0deg) scale(${1 - 0.012 * s}, ${1 + 0.018 * s})`, offset: at(T.impact + 70), easing: "ease-out" },
        { opacity: 1, transform: "translate3d(0, 0, 0) rotateX(0deg) scale(1)", offset: 1 },
      ],
      { duration: T.handOver, delay: d, fill: "backwards", easing: "linear" },
    );
    if (geo.defense) {
      // A monster summoned in Defense Position turns as it lands (from the owner's upright turn).
      const base = geo.side === "opp" ? 180 : 0;
      track.play(art.current, [{ rotate: `${base}deg`, offset: 0 }, { rotate: `${base}deg`, offset: at(T.hoverEnd) }, { rotate: `${base + 90}deg`, offset: at(T.impact) }, { rotate: `${base + 90}deg` }], {
        duration: T.handOver,
        delay: d,
        fill: "backwards",
        easing: "linear",
      });
    }
    // Hologram layers: strongest while it hovers, gone by the time it lands.
    const holoLayer = (el: Element | null, peak: number) =>
      track.play(
        el,
        [
          { opacity: 0, offset: 0 },
          { opacity: peak, offset: at(T.rise * 0.6) },
          { opacity: peak * 0.8, offset: at(T.hoverEnd) },
          { opacity: 0, offset: at(T.impact - 30) },
          { opacity: 0, offset: 1 },
        ],
        { duration: T.handOver, delay: d, fill: "backwards", easing: "linear" },
      );
    holoLayer(foil.current, 0.62);
    holoLayer(scan.current, 0.9);
    holoLayer(edge.current, 1);
    track.play(foil.current, [{ backgroundPosition: "115% 0" }, { backgroundPosition: "-15% 0" }], {
      duration: T.impact,
      delay: d,
      fill: "backwards",
      easing: "cubic-bezier(0.3, 0.1, 0.3, 1)",
    });
    track.play(scan.current, [{ backgroundPosition: "0 0" }, { backgroundPosition: "0 18px" }], {
      duration: T.impact,
      delay: d,
      fill: "backwards",
      easing: "linear",
    });
    // A faint flicker while it hovers.
    track.play(
      art.current,
      [
        { opacity: 1, offset: 0 },
        { opacity: 1, offset: at(T.rise) },
        { opacity: 0.84, offset: at(T.rise + 40) },
        { opacity: 1, offset: at(T.rise + 62) },
        { opacity: 0.92, offset: at(T.rise + 120) },
        { opacity: 1, offset: at(T.rise + 138) },
        { opacity: 0.86, offset: at(T.hoverEnd - 40) },
        { opacity: 1, offset: at(T.hoverEnd - 24) },
        { opacity: 1, offset: 1 },
      ],
      { duration: T.handOver, delay: d, fill: "backwards", easing: "linear" },
    );
    track.play(plate.current, [{ opacity: 0, offset: 0 }, { opacity: 0, offset: at(T.rise * 0.5) }, { opacity: 1, offset: at(T.rise) }, { opacity: 1, offset: at(T.hoverEnd - 60) }, { opacity: 0, offset: at(T.hoverEnd + 40) }, { opacity: 0 }], {
      duration: T.handOver,
      delay: d,
      fill: "backwards",
      easing: "linear",
    });
    track.play(beam.current, [{ opacity: 0, transform: "scaleY(0.2)", offset: 0, easing: riseEase }, { opacity: 1, transform: "scaleY(1)", offset: at(T.rise) }, { opacity: 0.9, offset: at(T.hoverEnd) }, { opacity: 0, offset: at(T.impact - 20) }, { opacity: 0 }], {
      duration: T.handOver,
      delay: d,
      fill: "backwards",
      easing: "linear",
    });
    track.play(pad.current, [{ opacity: 0, offset: 0 }, { opacity: 1, offset: at(T.rise * 0.7) }, { opacity: 0.85, offset: at(T.hoverEnd) }, { opacity: 0, offset: at(T.impact) }, { opacity: 0 }], {
      duration: T.handOver,
      delay: d,
      fill: "backwards",
      easing: "linear",
    });
    track.play(
      shadow.current,
      [
        { opacity: 0, transform: "scale(0.7)", offset: 0 },
        { opacity: 0.3, transform: "scale(1.15)", offset: at(T.rise), easing: "linear" },
        { opacity: 0.32, transform: "scale(1.2)", offset: at(T.hoverEnd), easing: slamEase },
        { opacity: 0.7, transform: "scale(0.96)", offset: at(T.impact), easing: "ease-out" },
        { opacity: 0, transform: "scale(1)", offset: 1 },
      ],
      { duration: T.handOver, delay: d, fill: "backwards", easing: "linear" },
    );

    // Impact.
    const hit = d + T.impact;
    track.after(d, () => emitCue("holo", weight));
    track.after(hit, () => emitCue("slam", weight));
    const grow = 2.3 + weight * 0.5;
    track.play(ring.current, [{ opacity: 0.9, transform: "scale(0.5)" }, { opacity: 0, transform: `scale(${grow})` }], {
      duration: 420,
      delay: hit,
      fill: "forwards",
      easing: "cubic-bezier(0.1, 0.7, 0.2, 1)",
    });
    track.play(ring2.current, [{ opacity: 0.5, transform: "scale(0.4)" }, { opacity: 0, transform: `scale(${grow * 1.35})` }], {
      duration: 560,
      delay: hit + 70,
      fill: "forwards",
      easing: "cubic-bezier(0.1, 0.7, 0.2, 1)",
    });
    track.play(burst.current, [{ opacity: 0.85, transform: "scale(0.6)" }, { opacity: 0, transform: "scale(1.35)" }], {
      duration: 300,
      delay: hit,
      fill: "forwards",
      easing: "ease-out",
    });
    // Light radiating from the impact in the type's colour, gone within about half a second.
    track.play(
      rays.current,
      [
        { opacity: 0, transform: "rotate(0deg) scale(0.3)", easing: "cubic-bezier(0.1, 0.8, 0.2, 1)" },
        { opacity: 0.95, transform: "rotate(4deg) scale(0.9)", offset: 0.18 },
        { opacity: 0, transform: "rotate(9deg) scale(1.5)" },
      ],
      { duration: T.raysEnd - T.impact, delay: hit, fill: "forwards", easing: "cubic-bezier(0.2, 0.6, 0.3, 1)" },
    );
    const rand = mulberry32(item.event.id * 7919 + 11);
    dust.current.forEach((el) => {
      if (!el) return;
      const angle = rand() * Math.PI * 2;
      const dist = geo.w * (0.55 + rand() * 0.75);
      const dx = Math.cos(angle) * dist * 1.25;
      const dy = Math.sin(angle) * dist * 0.55 - geo.h * 0.05;
      const life = 380 + rand() * 240;
      track.play(
        el,
        [
          { opacity: 0.75, transform: "translate(0, 0) scale(1)" },
          { opacity: 0, transform: `translate(${dx}px, ${dy}px) scale(${0.25 + rand() * 0.3})` },
        ],
        { duration: life, delay: hit, fill: "forwards", easing: "cubic-bezier(0.1, 0.6, 0.3, 1)" },
      );
    });

    // The shake, the jolt of the neighbours, the cracks and the aura belong to ImpactFx, which SummonFx
    // starts at the moment of impact. This item lives until its rings and dust are gone.
    track.play(anchor.current, [{ opacity: 1 }, { opacity: 1 }], { duration: T.raysEnd, delay: d });
  });

  return (
    <>
      <div ref={anchor} className={styles.anchor} data-fx="heavy">
        <span ref={pad} className={styles.pad} />
        <span ref={beam} className={styles.beam} />
        <span ref={shadow} className={styles.shadow} />
        <span ref={rays} className={styles.rays} />
        <span ref={burst} className={styles.burst} />
        <div ref={stage} className={styles.stage}>
          <div ref={card} className={styles.holoCard}>
            {cardInfo ? (
              <img ref={art} className={styles.holoArt} src={cardArtUrl(cardInfo.code, "small")} alt="" draggable={false} />
            ) : null}
            <i ref={foil} className={styles.holoFoil} />
            <i ref={scan} className={styles.holoScan} />
            <i ref={edge} className={styles.holoEdge} />
            <span ref={plate} className={styles.plate}>
              <b>{cardInfo?.name}</b>
              <em>{levelLabel(cardInfo, tribute, item.style)}</em>
            </span>
          </div>
        </div>
        <span ref={ring} className={styles.impactRing} />
        <span ref={ring2} className={styles.impactRing} data-thin="true" />
        {Array.from({ length: DUST_COUNT }, (_, index) => (
          <span
            key={index}
            ref={(el) => {
              dust.current[index] = el;
            }}
            className={styles.dust}
          />
        ))}
      </div>
    </>
  );
}

/* ---------- slam: shake, jolt, cracks and aura ---------- */

const IMPACT_DUST = 8;

/** Neighbouring zone frames the slam can shake: everything on the board except hands and the landing zone. */
function joltTargets(zone: HTMLElement): HTMLElement[] {
  const field = document.querySelector<HTMLElement>("[data-duel-field]");
  if (!field) return [];
  return Array.from(field.querySelectorAll<HTMLElement>("[data-zones]")).filter(
    (el) => el !== zone && !el.contains(zone) && !zone.contains(el) && el.closest("[data-hand-seat]") == null,
  );
}

function joltFrames(dx: number, dy: number, rot: number): Keyframe[] {
  const at = (k: number, r: number): Keyframe => ({
    translate: `${(dx * k).toFixed(2)}px ${(dy * k).toFixed(2)}px`,
    rotate: `${(rot * r).toFixed(3)}deg`,
  });
  return [
    { ...at(0, 0), offset: 0 },
    { ...at(1, 1), offset: 0.16, easing: "ease-out" },
    { ...at(-0.45, -0.5), offset: 0.4, easing: "ease-in-out" },
    { ...at(0.2, 0.22), offset: 0.66, easing: "ease-in-out" },
    { ...at(0, 0), offset: 1 },
  ];
}

/**
 * The weight of a strong landing, starting at the moment of impact (this item's delay): the whole
 * board shakes, every other zone frame gets a jolt that falls off with distance (adjacent zones the
 * most), cracks spread over the field (more and longer as the monster gets stronger), a flat
 * shockwave ring runs out over the field and an aura in the card's attribute colour pulses and
 * fades. All transforms and opacity on an overlay: no layout shifts, at any board scale.
 */
function ImpactFx({ item, overlay, done }: EffectProps) {
  const anchor = useAnchor();
  const aura = useRef<HTMLSpanElement>(null);
  const halo = useRef<HTMLSpanElement>(null);
  const shock = useRef<HTMLSpanElement>(null);
  const shock2 = useRef<HTMLSpanElement>(null);
  const dust = useRef<Array<HTMLSpanElement | null>>([]);
  const cracksSvg = useRef<SVGSVGElement>(null);
  const crackPaths = useRef<Array<SVGPathElement | null>>([]);
  const [cracks, setCracks] = useState<CrackPath[]>([]);
  const strength = clamp(item.strength, SLAM_LOOK_MIN, SLAM_LOOK_MAX);
  const life = item.life;
  const tone: FxTone = item.style ?? "gold";

  useEffectSetup(overlay, item, done, ({ track, zone, geo }) => {
    const d = item.delayMs;
    if (anchor.current) placeAnchor(anchor.current, geo);
    applyTone(anchor.current, tone);
    applyTone(cracksSvg.current, tone);
    const [au, au2] = auraTintOf(item.card?.attribute);
    for (const el of [anchor.current, cracksSvg.current]) {
      el?.style.setProperty("--au", au);
      el?.style.setProperty("--au2", au2);
    }
    cracksSvg.current?.style.setProperty("--cw", String(clamp(geo.w / 70, 0.7, 1.8)));
    const mul = SHAKE_AMPLITUDE_PX[item.shake] / SHAKE_AMPLITUDE_PX.medium;

    // Aura: a wide glow and a halo hugging the card, pulsing twice before they fade.
    const pulse = (peak: number): Keyframe[] => [
      { opacity: 0, transform: "scale(0.55)", offset: 0 },
      { opacity: peak, transform: "scale(1.06)", offset: 0.1, easing: "ease-out" },
      { opacity: peak * 0.5, transform: "scale(0.96)", offset: 0.3, easing: "ease-in-out" },
      { opacity: peak * 0.85, transform: "scale(1.1)", offset: 0.5, easing: "ease-in-out" },
      { opacity: peak * 0.3, transform: "scale(1.04)", offset: 0.76 },
      { opacity: 0, transform: "scale(1.28)", offset: 1 },
    ];
    track.play(aura.current, pulse(0.55 + 0.3 * strength), { duration: life, delay: d, easing: "linear" });
    track.play(halo.current, pulse(0.7 + 0.2 * strength), { duration: life, delay: d, easing: "linear" });

    // Shockwave: a flat ring running out over the field, and a fainter one behind it.
    const grow = 3 + strength * 1.7;
    track.play(
      shock.current,
      [{ opacity: 0.95, transform: "scale(0.5, 0.2)" }, { opacity: 0, transform: `scale(${grow}, ${grow * 0.42})` }],
      { duration: 480, delay: d, easing: "cubic-bezier(0.1, 0.7, 0.2, 1)" },
    );
    track.play(
      shock2.current,
      [{ opacity: 0.55, transform: "scale(0.4, 0.16)" }, { opacity: 0, transform: `scale(${grow * 1.25}, ${grow * 0.52})` }],
      { duration: 600, delay: d + 90, easing: "cubic-bezier(0.1, 0.7, 0.2, 1)" },
    );
    const rand = mulberry32(item.event.id * 7919 + 29);
    if (item.style) {
      // Typed summons have no dust of their own: a low cloud thrown out along the ground.
      dust.current.forEach((el) => {
        if (!el) return;
        const angle = rand() * Math.PI * 2;
        const dist = geo.w * (0.6 + rand() * 0.9) * (0.8 + strength * 0.25);
        track.play(
          el,
          [
            { opacity: 0.75, transform: "translate(0, 0) scale(1)" },
            { opacity: 0, transform: `translate(${Math.cos(angle) * dist * 1.25}px, ${Math.sin(angle) * dist * 0.5}px) scale(${0.25 + rand() * 0.3})` },
          ],
          { duration: 380 + rand() * 240, delay: d, easing: "cubic-bezier(0.1, 0.6, 0.3, 1)" },
        );
      });
    }

    // The board shakes, the neighbours jolt.
    const field = document.querySelector<HTMLElement>("[data-duel-field]");
    const boardScale = clamp(geo.overlayW / 1100, 0.7, 1.4);
    const amp = SHAKE_AMPLITUDE_PX[item.shake] * strength * 1.15 * boardScale;
    if (amp > 0 && field) {
      track.play(field, shakeFrames(amp, item.event.id), { duration: 400, delay: d, fill: "none", easing: "linear" });
    }
    if (mul > 0) {
      const o = overlay.getBoundingClientRect();
      for (const el of joltTargets(zone)) {
        const r = el.getBoundingClientRect();
        if (r.width < 4) continue;
        const dx = r.left - o.left + r.width / 2 - geo.cx;
        const dy = r.top - o.top + r.height / 2 - geo.cy;
        const dist = Math.hypot(dx, dy);
        const f = joltFalloff(dist / geo.w);
        if (f === 0) continue;
        const push = geo.w * 0.09 * strength * f * mul;
        const ux = dist > 0 ? dx / dist : 0;
        const uy = dist > 0 ? dy / dist : 1;
        // Pushed away from the impact, tilted away too, and a little down (into the board).
        track.play(el, joltFrames(ux * push, uy * push + push * 0.35, (ux >= 0 ? 1 : -1) * 2.4 * strength * f * mul), {
          duration: 440,
          delay: d,
          fill: "none",
          easing: "linear",
        });
      }
    }

    // Keeps the item alive until the cracks have faded.
    track.play(anchor.current, [{ opacity: 1 }, { opacity: 1 }], { duration: life, delay: d });
    setCracks(buildCracks(geo, slamCrackCount(strength), item.event.id, 0.8 + strength * 0.45));
  });

  // The crack strokes exist only after setCracks: draw them in a second pass.
  const cracksKey = cracks.length;
  useLayoutEffect(() => {
    if (cracks.length === 0) return undefined;
    const track = new Track();
    const hit = item.delayMs;
    crackPaths.current.forEach((el, index) => {
      const crack = cracks[Math.floor(index / 3)];
      if (!el || !crack) return;
      const layer = index % 3;
      track.play(
        el,
        [{ strokeDashoffset: 1, opacity: layer === 2 ? 0.9 : 1 }, { strokeDashoffset: 0, opacity: layer === 2 ? 0.9 : 1 }],
        { duration: crack.span, delay: hit + crack.delay, fill: "both", easing: "cubic-bezier(0.1, 0.8, 0.2, 1)" },
      );
    });
    track.play(
      cracksSvg.current,
      [
        { opacity: 0, offset: 0 },
        { opacity: 1, offset: 0.01 },
        { opacity: 1, offset: 0.62 },
        { opacity: 0, offset: 1 },
      ],
      { duration: life, delay: hit, fill: "both", easing: "linear" },
    );
    return () => track.dispose();
    // Runs once when the crack geometry arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cracksKey]);

  return (
    <>
      <svg ref={cracksSvg} className={styles.cracks} viewBox={`0 0 ${overlay.clientWidth} ${overlay.clientHeight}`} aria-hidden="true">
        {cracks.map((crack, index) => (
          <g key={index}>
            <path
              ref={(el) => {
                crackPaths.current[index * 3] = el;
              }}
              d={crack.d}
              pathLength={1}
              className={styles.crackShade}
            />
            <path
              ref={(el) => {
                crackPaths.current[index * 3 + 1] = el;
              }}
              d={crack.d}
              pathLength={1}
              className={styles.crackCore}
            />
            <path
              ref={(el) => {
                crackPaths.current[index * 3 + 2] = el;
              }}
              d={crack.d}
              pathLength={1}
              className={styles.crackGlint}
            />
          </g>
        ))}
      </svg>
      <div ref={anchor} className={styles.anchor} data-fx="impact">
        <span ref={aura} className={styles.aura} />
        <span ref={halo} className={styles.auraHalo} />
        <span ref={shock} className={styles.shockRing} />
        <span ref={shock2} className={styles.shockRing} data-thin="true" />
        {item.style
          ? Array.from({ length: IMPACT_DUST }, (_, index) => (
              <span
                key={index}
                ref={(el) => {
                  dust.current[index] = el;
                }}
                className={styles.dust}
              />
            ))
          : null}
      </div>
    </>
  );
}

/* ---------- typed summons: Fusion, Synchro, Xyz, Link, Ritual, Pendulum ---------- */

type TypedCtx = {
  track: Track;
  zone: HTMLElement;
  geo: Geo;
  /** Start of the effect, ms from now (the flight has landed by then). */
  d: number;
  handOver: number;
  total: number;
  /** A copy of the card that stands in for the real one until `handOver`. */
  copy: HTMLDivElement | null;
  copyArt: HTMLImageElement | null;
};

type TypedRefs = {
  anchor: React.RefObject<HTMLDivElement | null>;
  copy: React.RefObject<HTMLDivElement | null>;
  /** The card body inside the copy: turned sideways for a Defense Position monster. */
  copyBody: React.RefObject<HTMLDivElement | null>;
  copyArt: React.RefObject<HTMLImageElement | null>;
};

/**
 * Shared frame for every typed summon: the anchor on the zone, the type's colours, the real card
 * hidden until the effect hands over, a card copy that starts exactly where the flight left it, the
 * sound cue, and a keep-alive so the item lives until the last light has faded.
 */
function useTypedSetup(
  props: EffectProps,
  style: SummonStyle,
  refs: TypedRefs,
  setup: (ctx: TypedCtx) => void,
): void {
  const { item, overlay, done } = props;
  useEffectSetup(overlay, item, done, ({ track, zone, geo }) => {
    const d = item.delayMs;
    const { handOver, total } = TYPED_AUTHORED[style];
    if (refs.anchor.current) placeAnchor(refs.anchor.current, geo);
    applyTone(refs.anchor.current, style);
    if (refs.copyBody.current && copyTurn(geo) !== 0) refs.copyBody.current.style.rotate = `${copyTurn(geo)}deg`;
    holdHidden(track, zone, d + handOver * TYPED_SCALE);
    // Everything below is written on the authored timeline and plays at TYPED_SCALE of it.
    track.pace(d, TYPED_SCALE);
    // The copy stands until the real card is back, then goes in a blink so nothing shows twice for long.
    track.play(refs.copy.current, [{ opacity: 1, offset: 0 }, { opacity: 1, offset: handOver / total }, { opacity: 0, offset: Math.min(0.999, (handOver + 90) / total) }, { opacity: 0 }], {
      duration: total,
      delay: d,
      fill: "backwards",
      easing: "linear",
    });
    track.after(d, () => emitCue(style, 1));
    track.play(refs.anchor.current, [{ opacity: 1 }, { opacity: 1 }], { duration: total, delay: d });
    setup({ track, zone, geo, d, handOver, total, copy: refs.copy.current, copyArt: refs.copyArt.current });
  });
}

function useTypedRefs(): TypedRefs {
  return { anchor: useAnchor(), copy: useRef<HTMLDivElement>(null), copyBody: useRef<HTMLDivElement>(null), copyArt: useRef<HTMLImageElement>(null) };
}

function CardCopy({ card, refs, tint }: { card: DuelCardInfo | null; refs: TypedRefs; tint?: React.RefObject<HTMLSpanElement | null> }) {
  return (
    <div ref={refs.copy} className={styles.copy}>
      <div ref={refs.copyBody} className={styles.copyBody}>
        {card ? <img ref={refs.copyArt} className={styles.ghostArt} src={cardArtUrl(card.code, "small")} alt="" draggable={false} /> : null}
        {tint ? <span ref={tint} className={styles.copyTint} /> : null}
      </div>
    </div>
  );
}

/** A soft flash of the type's light over the zone. */
function flash(track: Track, el: Element | null, at: number, opts: { peak?: number; grow?: number; duration?: number } = {}): void {
  track.play(
    el,
    [
      { opacity: 0, transform: "scale(0.5)" },
      { opacity: opts.peak ?? 0.9, transform: "scale(0.9)", offset: 0.15 },
      { opacity: 0, transform: `scale(${opts.grow ?? 1.6})` },
    ],
    { duration: opts.duration ?? 420, delay: at, fill: "forwards", easing: "cubic-bezier(0.1, 0.7, 0.2, 1)" },
  );
}

/** Fusion: two vortices, violet and orange, spin in from either side and merge into the card. */
function FusionFx(props: EffectProps) {
  const refs = useTypedRefs();
  const vortexA = useRef<HTMLSpanElement>(null);
  const vortexB = useRef<HTMLSpanElement>(null);
  const burst = useRef<HTMLSpanElement>(null);
  const halo = useRef<HTMLSpanElement>(null);
  useTypedSetup(props, "fusion", refs, ({ track, geo, d, handOver, copy }) => {
    const side = geo.side === "opp" ? -1 : 1;
    const far = geo.w * 0.95;
    const spin = (el: HTMLElement | null, dir: number) =>
      track.play(
        el,
        [
          { opacity: 0, transform: `translate(${dir * far * 1.1}px, ${side * geo.h * 0.12}px) rotate(0deg) scale(0.4)`, easing: "cubic-bezier(0.2, 0.7, 0.3, 1)" },
          { opacity: 0.95, transform: `translate(${dir * far * 0.7}px, ${side * geo.h * 0.06}px) rotate(${dir * 200}deg) scale(1)`, offset: 0.22, easing: "cubic-bezier(0.5, 0, 0.7, 0.4)" },
          { opacity: 1, transform: `translate(0px, 0px) rotate(${dir * 620}deg) scale(0.85)`, offset: 0.62, easing: "ease-out" },
          { opacity: 0, transform: `translate(0px, 0px) rotate(${dir * 760}deg) scale(0.25)` },
        ],
        { duration: 760, delay: d, fill: "forwards", easing: "linear" },
      );
    spin(vortexA.current, -1);
    spin(vortexB.current, 1);
    // The landed card is drawn into the swirl, goes dark, and re-forms in a violet-orange flash.
    track.play(
      copy,
      [
        { filter: "brightness(1) saturate(1)", scale: "1", offset: 0 },
        { filter: "brightness(0.25) saturate(0.4)", scale: "0.9", offset: 0.4, easing: "ease-in-out" },
        { filter: "brightness(0.15) saturate(0.2)", scale: "0.86", offset: 0.62, easing: "cubic-bezier(0.1, 0.8, 0.2, 1)" },
        { filter: "brightness(2.4) saturate(1.5)", scale: "1.08", offset: 0.8, easing: "ease-out" },
        { filter: "brightness(1) saturate(1)", scale: "1", offset: 1 },
      ],
      { duration: handOver, delay: d, fill: "backwards", easing: "linear" },
    );
    flash(track, burst.current, d + 470, { peak: 1, grow: 1.7, duration: 460 });
    track.play(halo.current, [{ opacity: 0.9, transform: "scale(0.6)" }, { opacity: 0, transform: "scale(2.1)" }], {
      duration: 640,
      delay: d + 500,
      fill: "forwards",
      easing: "cubic-bezier(0.1, 0.7, 0.2, 1)",
    });
  });
  return (
    <div ref={refs.anchor} className={styles.anchor} data-fx="fusion">
      <span ref={halo} className={styles.impactRing} />
      <span ref={vortexA} className={styles.vortex} data-hue="a" />
      <span ref={vortexB} className={styles.vortex} data-hue="b" />
      <CardCopy card={props.item.card} refs={refs} />
      <span ref={burst} className={styles.burst} />
    </div>
  );
}

const TUNE_RINGS = 4;

/** Synchro: tuning rings with star points drop and stack into a column of white light, then a white burst. */
function SynchroFx(props: EffectProps) {
  const refs = useTypedRefs();
  const column = useRef<HTMLSpanElement>(null);
  const rings = useRef<Array<HTMLSpanElement | null>>([]);
  const burst = useRef<HTMLSpanElement>(null);
  useTypedSetup(props, "synchro", refs, ({ track, geo, d, handOver, copy }) => {
    const side = geo.side === "opp" ? -1 : 1;
    track.play(
      column.current,
      [
        { opacity: 0, transform: "scaleX(0.15)" },
        { opacity: 0.85, transform: "scaleX(1)", offset: 0.3 },
        { opacity: 1, transform: "scaleX(1.05)", offset: 0.62 },
        { opacity: 0, transform: "scaleX(1.7)" },
      ],
      { duration: 880, delay: d, fill: "forwards", easing: "cubic-bezier(0.2, 0.7, 0.3, 1)" },
    );
    rings.current.forEach((el, index) => {
      if (!el) return;
      const from = -side * geo.h * 1.15;
      const rest = side * geo.h * (0.36 - index * 0.24);
      track.play(
        el,
        [
          { opacity: 0, transform: `translateY(${from}px) scale(1.25)`, easing: "cubic-bezier(0.3, 0, 0.6, 1)" },
          { opacity: 1, transform: `translateY(${rest}px) scale(1)`, offset: 0.34, easing: "ease-in-out" },
          { opacity: 1, transform: `translateY(${rest}px) scale(1)`, offset: 0.6, easing: "cubic-bezier(0.5, 0, 0.8, 0.4)" },
          { opacity: 0, transform: `translateY(${from * 1.4}px) scale(0.6)` },
        ],
        { duration: 900, delay: d + index * 70, fill: "forwards", easing: "linear" },
      );
    });
    // The card whitens inside the column and resolves back to colour at the burst.
    track.play(
      copy,
      [
        { filter: "brightness(1) contrast(1)", offset: 0 },
        { filter: "brightness(2.6) contrast(0.5)", offset: 0.45, easing: "linear" },
        { filter: "brightness(3.2) contrast(0.3)", offset: 0.72, easing: "ease-out" },
        { filter: "brightness(1) contrast(1)", offset: 1 },
      ],
      { duration: handOver, delay: d, fill: "backwards", easing: "linear" },
    );
    flash(track, burst.current, d + 560, { peak: 1, grow: 2.2, duration: 520 });
  });
  return (
    <div ref={refs.anchor} className={styles.anchor} data-fx="synchro">
      <span ref={column} className={styles.column} />
      {Array.from({ length: TUNE_RINGS }, (_, index) => (
        <span
          key={index}
          ref={(el) => {
            rings.current[index] = el;
          }}
          className={styles.tuneRing}
        >
          <i /><i /><i /><i />
        </span>
      ))}
      <CardCopy card={props.item.card} refs={refs} />
      <span ref={burst} className={styles.burst} data-white="true" />
    </div>
  );
}

const XYZ_ORBS = 3;

/** Xyz: a dark galaxy opens under the card, gold overlay units orbit and gather, and the monster rises. */
function XyzFx(props: EffectProps) {
  const refs = useTypedRefs();
  const galaxy = useRef<HTMLSpanElement>(null);
  const orbits = useRef<Array<HTMLSpanElement | null>>([]);
  const orbs = useRef<Array<HTMLSpanElement | null>>([]);
  const burst = useRef<HTMLSpanElement>(null);
  useTypedSetup(props, "xyz", refs, ({ track, geo, d, handOver, copy }) => {
    const side = geo.side === "opp" ? -1 : 1;
    track.play(
      galaxy.current,
      [
        { opacity: 0, transform: "rotate(0deg) scale(0.3)", easing: "cubic-bezier(0.2, 0.7, 0.3, 1)" },
        { opacity: 0.95, transform: "rotate(120deg) scale(1)", offset: 0.2, easing: "linear" },
        { opacity: 0.9, transform: "rotate(330deg) scale(1.04)", offset: 0.62, easing: "ease-in" },
        { opacity: 0, transform: "rotate(450deg) scale(1.35)" },
      ],
      { duration: 1180, delay: d, fill: "forwards", easing: "linear" },
    );
    const radius = geo.w * 0.95;
    orbits.current.forEach((el, index) => {
      const base = (index / XYZ_ORBS) * 360;
      track.play(el, [{ transform: `rotate(${base}deg)` }, { transform: `rotate(${base + 560}deg)` }], {
        duration: 820,
        delay: d,
        fill: "forwards",
        easing: "cubic-bezier(0.4, 0, 0.6, 1)",
      });
      track.play(
        orbs.current[index],
        [
          { opacity: 0, transform: `translate(${radius * 1.1}px, 0) scale(0.4)`, easing: "ease-out" },
          { opacity: 1, transform: `translate(${radius}px, 0) scale(1)`, offset: 0.18, easing: "linear" },
          { opacity: 1, transform: `translate(${radius * 0.9}px, 0) scale(1)`, offset: 0.62, easing: "cubic-bezier(0.6, 0, 0.9, 0.5)" },
          { opacity: 1, transform: "translate(0px, 0) scale(0.5)", offset: 0.9, easing: "ease-out" },
          { opacity: 0, transform: "translate(0px, 0) scale(0.2)" },
        ],
        { duration: 860, delay: d + index * 40, fill: "forwards", easing: "linear" },
      );
    });
    // The card sinks dark into the galaxy, then rises up and out of it in a gold flash.
    const sink = side * geo.h * 0.16;
    track.play(
      copy,
      [
        { filter: "brightness(1)", transform: "translateY(0) scale(1)", offset: 0 },
        { filter: "brightness(0.3) saturate(0.5)", transform: `translateY(${sink}px) scale(0.84)`, offset: 0.42, easing: "ease-in-out" },
        { filter: "brightness(0.4) saturate(0.5)", transform: `translateY(${sink * 1.1}px) scale(0.82)`, offset: 0.7, easing: "cubic-bezier(0.1, 0.8, 0.2, 1)" },
        { filter: "brightness(1.8) saturate(1.2)", transform: `translateY(${-side * geo.h * 0.06}px) scale(1.06)`, offset: 0.88, easing: "ease-out" },
        { filter: "brightness(1)", transform: "translateY(0) scale(1)", offset: 1 },
      ],
      { duration: handOver, delay: d, fill: "backwards", easing: "linear" },
    );
    flash(track, burst.current, d + 720, { peak: 0.95, grow: 1.8, duration: 480 });
  });
  return (
    <div ref={refs.anchor} className={styles.anchor} data-fx="xyz">
      <span ref={galaxy} className={styles.galaxy} />
      <CardCopy card={props.item.card} refs={refs} />
      {Array.from({ length: XYZ_ORBS }, (_, index) => (
        <span
          key={index}
          ref={(el) => {
            orbits.current[index] = el;
          }}
          className={styles.orbit}
        >
          <i
            ref={(el) => {
              orbs.current[index] = el;
            }}
            className={styles.orb}
          />
        </span>
      ))}
      <span ref={burst} className={styles.burst} />
    </div>
  );
}

const LINK_ARROWS = 8;

/** Link: a blue circuit grid, the eight link arrows lighting around the zone, and a data-line sweep that fills the card in. */
function LinkFx(props: EffectProps) {
  const refs = useTypedRefs();
  const grid = useRef<HTMLSpanElement>(null);
  const sweep = useRef<HTMLSpanElement>(null);
  const fill = useRef<HTMLDivElement>(null);
  const arrows = useRef<Array<HTMLSpanElement | null>>([]);
  const burst = useRef<HTMLSpanElement>(null);
  const tint = useRef<HTMLSpanElement>(null);
  useTypedSetup(props, "link", refs, ({ track, geo, d, handOver, copy, copyArt }) => {
    track.play(grid.current, [{ opacity: 0 }, { opacity: 0.9, offset: 0.18 }, { opacity: 0.8, offset: 0.62 }, { opacity: 0 }], {
      duration: 1000,
      delay: d,
      fill: "forwards",
      easing: "linear",
    });
    const rx = geo.w * 0.66;
    const ry = geo.h * 0.62;
    arrows.current.forEach((el, index) => {
      if (!el) return;
      const angle = (index / LINK_ARROWS) * 360;
      const rad = (angle * Math.PI) / 180;
      el.style.left = `${geo.w / 2 + Math.sin(rad) * rx}px`;
      el.style.top = `${geo.h / 2 - Math.cos(rad) * ry}px`;
      el.style.transform = `translate(-50%, -50%) rotate(${angle}deg)`;
      track.play(
        el,
        [
          { opacity: 0, scale: "0.5" },
          { opacity: 1, scale: "1.25", offset: 0.12, easing: "ease-out" },
          { opacity: 1, scale: "1", offset: 0.6 },
          { opacity: 0, scale: "1" },
        ],
        { duration: 820, delay: d + 100 + index * 42, fill: "forwards", easing: "linear" },
      );
    });
    // The data line runs down the card; above it the true art is filled in, below it a blue wireframe waits.
    const sweepStart = 260;
    const sweepEnd = 600;
    track.play(
      sweep.current,
      [
        { opacity: 0, transform: `translateY(${-geo.h * 0.55}px)`, offset: 0 },
        { opacity: 1, transform: `translateY(${-geo.h * 0.5}px)`, offset: 0.08 },
        { opacity: 1, transform: `translateY(${geo.h * 0.5}px)`, offset: 0.92 },
        { opacity: 0, transform: `translateY(${geo.h * 0.55}px)`, offset: 1 },
      ],
      { duration: sweepEnd - sweepStart, delay: d + sweepStart, fill: "forwards", easing: "cubic-bezier(0.4, 0, 0.6, 1)" },
    );
    track.play(fill.current, [{ clipPath: "inset(0 0 100% 0)" }, { clipPath: "inset(0 0 0% 0)" }], {
      duration: sweepEnd - sweepStart,
      delay: d + sweepStart,
      fill: "both",
      easing: "cubic-bezier(0.4, 0, 0.6, 1)",
    });
    // The fill keeps its own turn to the Defense Position only: its wipe (a clip) must run down the screen for both sides.
    if (fill.current && geo.defense) fill.current.style.rotate = "90deg";
    track.play(copyArt, [{ filter: "brightness(1) saturate(1)" }, { filter: "brightness(0.35) saturate(0.4) sepia(1) hue-rotate(170deg)", offset: 0.35 }, { filter: "brightness(0.35) saturate(0.4) sepia(1) hue-rotate(170deg)" }], {
      duration: sweepStart,
      delay: d,
      fill: "forwards",
      easing: "ease-in-out",
    });
    track.play(tint.current, [{ opacity: 0 }, { opacity: 0.7, offset: 0.4 }, { opacity: 0.7 }], { duration: sweepStart, delay: d, fill: "forwards", easing: "ease-in-out" });
    track.play(copy, [{ filter: "brightness(1)", offset: 0 }, { filter: "brightness(1)", offset: (sweepEnd - 20) / handOver }, { filter: "brightness(1.9)", offset: (sweepEnd + 40) / handOver }, { filter: "brightness(1)", offset: 1 }], {
      duration: handOver,
      delay: d,
      fill: "backwards",
      easing: "linear",
    });
    flash(track, burst.current, d + sweepEnd, { peak: 0.75, grow: 1.5, duration: 380 });
  });
  const card = props.item.card;
  return (
    <div ref={refs.anchor} className={styles.anchor} data-fx="link">
      <span ref={grid} className={styles.linkGrid} />
      <CardCopy card={card} refs={refs} tint={tint} />
      <div ref={fill} className={styles.linkFill}>
        {card ? <img className={styles.ghostArt} src={cardArtUrl(card.code, "small")} alt="" draggable={false} /> : null}
      </div>
      <span ref={sweep} className={styles.linkSweep} />
      {Array.from({ length: LINK_ARROWS }, (_, index) => (
        <span
          key={index}
          ref={(el) => {
            arrows.current[index] = el;
          }}
          className={styles.linkArrow}
        />
      ))}
      <span ref={burst} className={styles.burst} />
    </div>
  );
}

const FLAMES = 7;

/** Ritual: a pillar of blue light with blue flames licking up around the card, which rises out of them. */
function RitualFx(props: EffectProps) {
  const refs = useTypedRefs();
  const pillar = useRef<HTMLSpanElement>(null);
  const flames = useRef<Array<HTMLSpanElement | null>>([]);
  const tint = useRef<HTMLSpanElement>(null);
  const burst = useRef<HTMLSpanElement>(null);
  useTypedSetup(props, "ritual", refs, ({ track, geo, d, handOver, copy }) => {
    const side = geo.side === "opp" ? -1 : 1;
    if (pillar.current) pillar.current.style.transformOrigin = side > 0 ? "50% 100%" : "50% 0%";
    track.play(
      pillar.current,
      [
        { opacity: 0, transform: "scaleY(0.1) scaleX(0.6)", easing: "cubic-bezier(0.2, 0.7, 0.3, 1)" },
        { opacity: 1, transform: "scaleY(1) scaleX(1)", offset: 0.24, easing: "linear" },
        { opacity: 0.9, transform: "scaleY(1) scaleX(1)", offset: 0.66, easing: "ease-in" },
        { opacity: 0, transform: "scaleY(1.1) scaleX(1.6)" },
      ],
      { duration: 980, delay: d, fill: "forwards", easing: "linear" },
    );
    const rand = mulberry32(props.item.event.id * 131 + 5);
    flames.current.forEach((el, index) => {
      if (!el) return;
      const x = ((index + 0.5) / FLAMES - 0.5) * geo.w * 1.5;
      el.style.left = `${geo.w / 2 + x}px`;
      el.style.top = side > 0 ? "70%" : "10%";
      const rise = side * -geo.h * (0.7 + rand() * 0.5);
      const life = 520 + rand() * 260;
      for (const wave of [0, 1]) {
        track.play(
          el,
          [
            { opacity: 0, transform: "translate(-50%, 0) scale(0.5)", easing: "ease-out" },
            { opacity: 0.9, transform: `translate(-50%, ${rise * 0.35}px) scale(1.2)`, offset: 0.3, easing: "ease-in" },
            { opacity: 0, transform: `translate(-50%, ${rise}px) scale(0.4)` },
          ],
          { duration: life, delay: d + 80 + wave * 360 + index * 34, fill: "forwards", easing: "linear", composite: wave === 0 ? "replace" : "add" },
        );
      }
    });
    // The card sits low and blue in the flames, then rises out of them into its own colours.
    const low = side * geo.h * 0.14;
    track.play(
      copy,
      [
        { filter: "brightness(1) saturate(1)", transform: "translateY(0) scale(1)", offset: 0 },
        { filter: "brightness(0.55) saturate(0.6)", transform: `translateY(${low}px) scale(0.94)`, offset: 0.4, easing: "ease-in-out" },
        { filter: "brightness(0.6) saturate(0.6)", transform: `translateY(${low}px) scale(0.94)`, offset: 0.62, easing: "cubic-bezier(0.1, 0.8, 0.2, 1)" },
        { filter: "brightness(1.9) saturate(1.1)", transform: `translateY(${-side * geo.h * 0.04}px) scale(1.05)`, offset: 0.84, easing: "ease-out" },
        { filter: "brightness(1) saturate(1)", transform: "translateY(0) scale(1)", offset: 1 },
      ],
      { duration: handOver, delay: d, fill: "backwards", easing: "linear" },
    );
    track.play(tint.current, [{ opacity: 0 }, { opacity: 0.65, offset: 0.4 }, { opacity: 0.65, offset: 0.68 }, { opacity: 0 }], {
      duration: handOver,
      delay: d,
      fill: "forwards",
      easing: "linear",
    });
    flash(track, burst.current, d + 640, { peak: 0.9, grow: 1.6, duration: 460 });
  });
  return (
    <div ref={refs.anchor} className={styles.anchor} data-fx="ritual">
      <span ref={pillar} className={styles.pillar} />
      {Array.from({ length: FLAMES }, (_, index) => (
        <span
          key={index}
          ref={(el) => {
            flames.current[index] = el;
          }}
          className={styles.flame}
        />
      ))}
      <CardCopy card={props.item.card} refs={refs} tint={tint} />
      <span ref={burst} className={styles.burst} />
    </div>
  );
}

/** Points along a quadratic curve from `p0` over `ctrl` to `p2`. */
function quad(p0: [number, number], ctrl: [number, number], p2: [number, number], t: number): [number, number] {
  const m = 1 - t;
  return [m * m * p0[0] + 2 * m * t * ctrl[0] + t * t * p2[0], m * m * p0[1] + 2 * m * t * ctrl[1] + t * t * p2[1]];
}

/** Pendulum: an arc of light swings between the two Pendulum Zones, then a beam drops the monster onto its zone. */
function PendulumFx(props: EffectProps) {
  const refs = useTypedRefs();
  const svg = useRef<SVGSVGElement>(null);
  const arcGlow = useRef<SVGPathElement>(null);
  const arcLine = useRef<SVGPathElement>(null);
  const beam = useRef<SVGLineElement>(null);
  const orb = useRef<SVGCircleElement>(null);
  const burst = useRef<HTMLSpanElement>(null);
  const [arc, setArc] = useState<{ d: string; beam: [number, number, number, number] } | null>(null);
  const geoRef = useRef<{ p0: [number, number]; ctrl: [number, number]; p2: [number, number]; d: number } | null>(null);
  const { overlay, item } = props;
  useTypedSetup(props, "pendulum", refs, ({ track, geo, d, handOver, copy }) => {
    const controller = item.event.zone?.controller ?? 0;
    const pz = [0, 1].map((sequence) => {
      const el = findZoneElement({ controller, location: LOCATION_PZONE, sequence });
      return el ? measure(overlay, el) : null;
    });
    const left = pz[0];
    const right = pz[1];
    const fallback = !left || !right;
    const p0: [number, number] = fallback ? [geo.cx - geo.w * 1.8, geo.cy] : [left.cx, left.cy];
    const p2: [number, number] = fallback ? [geo.cx + geo.w * 1.8, geo.cy] : [right.cx, right.cy];
    // The swing arcs over the monster row, away from the Pendulum Zones.
    const towardBoard = fallback ? (geo.side === "opp" ? 1 : -1) : Math.sign(geo.cy - (p0[1] + p2[1]) / 2) || -1;
    const apexY = geo.cy + towardBoard * geo.h * 0.62;
    const ctrl: [number, number] = [(p0[0] + p2[0]) / 2, 2 * apexY - (p0[1] + p2[1]) / 2];
    geoRef.current = { p0, ctrl, p2, d };
    const top = quad(p0, ctrl, p2, 0.5);
    setArc({ d: `M${p0[0].toFixed(1)} ${p0[1].toFixed(1)} Q${ctrl[0].toFixed(1)} ${ctrl[1].toFixed(1)} ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`, beam: [top[0], top[1], geo.cx, geo.cy] });

    // The card waits in the dark on its zone; the beam lights it up when the pendulum drops.
    track.play(
      copy,
      [
        { filter: "brightness(1)", transform: "scale(1)", offset: 0 },
        { filter: "brightness(0.35) saturate(0.5)", transform: "scale(0.92)", offset: 0.3, easing: "linear" },
        { filter: "brightness(0.35) saturate(0.5)", transform: "scale(0.92)", offset: 0.8, easing: "cubic-bezier(0.1, 0.8, 0.2, 1)" },
        { filter: "brightness(2.2) saturate(1.3)", transform: "scale(1.07)", offset: 0.9, easing: "ease-out" },
        { filter: "brightness(1)", transform: "scale(1)", offset: 1 },
      ],
      { duration: handOver, delay: d, fill: "backwards", easing: "linear" },
    );
    flash(track, burst.current, d + 940, { peak: 0.95, grow: 1.7, duration: 480 });
  });

  // The arc, orb and beam exist only after the geometry is measured: animate them in a second pass.
  useLayoutEffect(() => {
    const g = geoRef.current;
    if (!arc || !g) return undefined;
    const track = new Track();
    const { p0, ctrl, p2, d } = g;
    const draw = (el: Element | null) =>
      track.play(el, [{ strokeDashoffset: 1, opacity: 0 }, { strokeDashoffset: 0.6, opacity: 1, offset: 0.2 }, { strokeDashoffset: 0, opacity: 1, offset: 0.62 }, { strokeDashoffset: 0, opacity: 0.9, offset: 0.78 }, { strokeDashoffset: 0, opacity: 0 }], {
        duration: 1180,
        delay: d,
        fill: "both",
        easing: "linear",
      });
    draw(arcGlow.current);
    draw(arcLine.current);
    // Swing left to right, back to the top, then drop straight to the zone.
    const frames: Keyframe[] = [];
    const steps = 16;
    for (let i = 0; i <= steps; i += 1) {
      const u = i / steps;
      const [x, y] = quad(p0, ctrl, p2, -(Math.cos(Math.PI * u) - 1) / 2);
      frames.push({ offset: u * 0.52, transform: `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`, opacity: i === 0 ? 0 : 1 });
    }
    for (let i = 1; i <= 8; i += 1) {
      const u = i / 8;
      const [x, y] = quad(p0, ctrl, p2, 1 - 0.5 * (-(Math.cos(Math.PI * u) - 1) / 2));
      frames.push({ offset: 0.52 + u * 0.3, transform: `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`, opacity: 1 });
    }
    const [bx, by, cx, cy] = arc.beam;
    frames.push({ offset: 0.84, transform: `translate(${bx.toFixed(1)}px, ${by.toFixed(1)}px)`, opacity: 1, easing: "cubic-bezier(0.6, 0, 0.9, 0.4)" });
    frames.push({ offset: 0.98, transform: `translate(${cx.toFixed(1)}px, ${cy.toFixed(1)}px)`, opacity: 1 });
    frames.push({ offset: 1, transform: `translate(${cx.toFixed(1)}px, ${cy.toFixed(1)}px)`, opacity: 0 });
    track.play(orb.current, frames, { duration: 980, delay: d, fill: "both", easing: "linear" });
    track.play(beam.current, [{ opacity: 0, strokeDashoffset: 1 }, { opacity: 1, strokeDashoffset: 0, offset: 0.4 }, { opacity: 1, offset: 0.7 }, { opacity: 0 }], {
      duration: 420,
      delay: d + 820,
      fill: "both",
      easing: "ease-out",
    });
    return () => track.dispose();
    // Runs once when the arc geometry arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [arc != null]);

  return (
    <>
      <svg ref={svg} className={styles.pendulumSvg} viewBox={`0 0 ${overlay.clientWidth} ${overlay.clientHeight}`} aria-hidden="true" style={{ "--fx-a": TONE_RGB.pendulum[0], "--fx-b": TONE_RGB.pendulum[1] } as CSSProperties}>
        {arc ? (
          <>
            <path ref={arcGlow} className={styles.arcGlow} d={arc.d} pathLength={1} />
            <path ref={arcLine} className={styles.arcLine} d={arc.d} pathLength={1} />
            <line ref={beam} className={styles.arcBeam} x1={arc.beam[0]} y1={arc.beam[1]} x2={arc.beam[2]} y2={arc.beam[3]} pathLength={1} />
            <circle ref={orb} className={styles.arcOrb} cx={0} cy={0} r={Math.max(3, overlay.clientWidth * 0.006)} />
          </>
        ) : null}
      </svg>
      <div ref={refs.anchor} className={styles.anchor} data-fx="pendulum">
        <CardCopy card={item.card} refs={refs} />
        <span ref={burst} className={styles.burst} />
      </div>
    </>
  );
}

function TypedFx(props: EffectProps & { style: SummonStyle }) {
  switch (props.style) {
    case "fusion":
      return <FusionFx {...props} />;
    case "synchro":
      return <SynchroFx {...props} />;
    case "xyz":
      return <XyzFx {...props} />;
    case "link":
      return <LinkFx {...props} />;
    case "ritual":
      return <RitualFx {...props} />;
    case "pendulum":
      return <PendulumFx {...props} />;
    default:
      return null;
  }
}

/* ---------- WebGL summons ---------- */

/** Aura colours of a plain heavy summon as the 3D tint: the attribute's light, and a paler accent. */
function auraTint3d(attribute: number | undefined): FxTint {
  const [main, alt] = auraTintOf(attribute);
  const m = parseRgbTriplet(main);
  return { main: m, alt: parseRgbTriplet(alt), accent: [m[0] * 0.4 + 0.6, m[1] * 0.4 + 0.6, m[2] * 0.4 + 0.6] };
}

/**
 * A heavy or typed summon drawn by the WebGL layer. The real card stays hidden until the portrait
 * has shrunk back into it (handOver); the canvas does the rest. Sound cues fire where the DOM
 * versions fire them: heavy summons "holo" at the start and "slam" at the landing, typed ones
 * their own cue at the start. The prompt panel waits for the whole effect (it is not a Web
 * Animation, so prompt-reveal cannot see it).
 */
function Summon3dFx({ item, overlay, done }: EffectProps) {
  const anchor = useAnchor();
  const three = item.three;
  useEffectSetup(overlay, item, done, ({ track, zone, geo }) => {
    if (!three) return;
    const d = item.delayMs;
    const tl = SUMMON3D_TIMELINE[three.key];
    const weight = heavyWeight(item.card, item.event.summonKind === "tribute");
    // The hold outlasts the hand-over by a margin; the real card is shown exactly at the slam below.
    const hidden = holdHidden(track, zone, d + tl.handOver + HAND_OVER_MARGIN_MS);
    // Keeps the item alive until the last light has faded.
    track.play(anchor.current, [{ opacity: 1 }, { opacity: 1 }], { duration: tl.total, delay: d });
    holdPromptReveal(d + tl.total);
    if (item.kind === "heavy") {
      track.after(d, () => emitCue("holo", weight));
      track.after(d + tl.handOver, () => emitCue("slam", weight));
    } else {
      track.after(d, () => emitCue(three.key as SummonStyle, 1));
    }
    const abort = new AbortController();
    track.onDispose(() => abort.abort());
    const request: FxRequest = {
      rect: { x: geo.left, y: geo.top, w: geo.w, h: geo.h },
      tint: item.style ? undefined : auraTint3d(item.card?.attribute),
      strength: item.strength || 1,
      shake: shakeScaleOf(item.shake),
      side: geo.side,
      defense: geo.defense,
      artCode: item.card?.code,
      seed: item.event.id,
    };
    track.after(d, () => {
      // The canvas can be lost between planning and now: show the real card at once then.
      if (!three.api.ready) {
        hidden?.cancel();
        return;
      }
      // The portrait starts now: the real card shows when it lands, measured from this moment.
      track.after(tl.handOver, () => hidden?.cancel());
      // An effect that ends early (it failed to start, the canvas was lost) never leaves the zone empty.
      void three.api.play(summonEffectId(three.key), request, abort.signal).then(() => hidden?.cancel());
    });
  });
  return <div ref={anchor} className={styles.anchor} data-fx="summon3d" />;
}

function FxView({ item, overlay, done }: EffectProps) {
  if (item.reduced) {
    const tone = item.kind === "destroy" ? "red" : item.kind === "activate" && item.event.chainIndex == null ? "violet" : item.style ? "typed" : "gold";
    return <GlowFx item={item} overlay={overlay} done={done} tone={tone} />;
  }
  if (item.three && (item.kind === "heavy" || item.kind === "typed")) {
    return <Summon3dFx item={item} overlay={overlay} done={done} />;
  }
  switch (item.kind) {
    case "heavy":
      return <HeavyFx item={item} overlay={overlay} done={done} />;
    case "typed":
      return item.style ? <TypedFx item={item} overlay={overlay} done={done} style={item.style} /> : <LightFx item={item} overlay={overlay} done={done} />;
    case "light":
      return <LightFx item={item} overlay={overlay} done={done} />;
    case "set":
      return <SetFx item={item} overlay={overlay} done={done} />;
    case "activate":
      return <ActivateFx item={item} overlay={overlay} done={done} />;
    case "destroy":
      return <DestroyFx item={item} overlay={overlay} done={done} />;
    case "impact":
      return <ImpactFx item={item} overlay={overlay} done={done} />;
    default:
      return null;
  }
}

/* ---------- planning ---------- */

function visibleCard(event: DuelEvent): DuelCardInfo | null {
  const card = event.card;
  return card != null && card.code > 0 ? card : null;
}

function planKind(event: DuelEvent, fresh: readonly DuelEvent[]): { kind: FxKind; style: SummonStyle | null } | null {
  if (!event.zone) return null;
  switch (event.kind) {
    case "summon": {
      // A Flip Summon's reveal is drawn by PositionFx; the light pop would only double it.
      if (summonCoveredByFlip(fresh, event)) return null;
      const plan = pairedMovePlan(event.id);
      const style = summonStyleOf(event, plan?.event.from?.location);
      if (isHeavySummon(event)) return { kind: "heavy", style };
      return { kind: style ? "typed" : "light", style };
    }
    case "set":
      return { kind: "set", style: null };
    case "activate":
      return { kind: "activate", style: null };
    case "destroy":
      return visibleCard(event) ? { kind: "destroy", style: null } : null;
    default:
      return null;
  }
}

export function SummonFx({ events, duelKey, reducedMotion, shake }: SummonFxProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const [items, setItems] = useState<FxItem[]>([]);
  const [overlay, setOverlay] = useState<HTMLDivElement | null>(null);
  const cursorRef = useRef<number | null>(null);
  const keyRef = useRef(duelKey);
  const heavyFreeAtRef = useRef(0);
  const seqRef = useRef(0);
  const prefsRef = useRef({ reducedMotion, shake });
  prefsRef.current = { reducedMotion, shake };
  // The WebGL layer loads while the room is idle; its ref is null until the canvas can draw.
  const fx3d = useFx3d(overlay, !reducedMotion);
  // The battle and scene layers draw into this canvas: publish it while it can draw.
  useEffect(() => {
    const api = fx3d.current;
    setSharedFx3d(overlay && api?.ready ? { api, host: overlay } : null);
    return () => setSharedFx3d(null);
  });

  useLayoutEffect(() => {
    setOverlay(overlayRef.current);
  }, []);

  useLayoutEffect(() => {
    if (keyRef.current !== duelKey) {
      keyRef.current = duelKey;
      cursorRef.current = null;
      heavyFreeAtRef.current = 0;
      setItems([]);
    }
    if (cursorRef.current == null) {
      cursorRef.current = maxEventId(events) ?? 0;
      return;
    }
    const { nextCursor, fresh } = collectFreshEvents(events, cursorRef.current);
    cursorRef.current = nextCursor;
    if (fresh.length === 0) return;
    if (typeof document !== "undefined" && document.hidden) return;

    const now = typeof performance !== "undefined" ? performance.now() : 0;
    // Idempotent: MoveFx plans the same batch; whichever layer runs first fixes the timing.
    planMoves(fresh, { now, reduced: prefsRef.current.reducedMotion, duelKey });
    const planned: FxItem[] = [];
    let step = 0;
    for (const event of fresh) {
      const planned_ = planKind(event, fresh);
      if (!planned_ || !findZoneElement(event.zone)) continue;
      const { kind, style } = planned_;
      const plan = pairedMovePlan(event.id);
      // A light summon or a set is the landing of its flight: no second animation of the same move.
      if (plan && (kind === "light" || kind === "set")) continue;
      let delayMs = Math.min(step, MAX_STAGGER_STEPS) * STAGGER_MS;
      if (plan) {
        // Effects that belong after the card has landed wait for it; a destroy leads the flight.
        const at = kind === "destroy" ? plan.startAt - plan.leadMs : plan.landAt;
        delayMs = Math.max(0, at - now);
      }
      // The effect of a resolving chain link starts while its badge is lit, never before.
      const chainAt = chainEffectAt(event.id);
      if (chainAt > now) delayMs = Math.max(delayMs, chainAt - now);
      // The layer is picked here and stays: an effect never changes layer half-way.
      const api = fx3d.current;
      const threeKey =
        pickSummonRoute({ kind, reduced: prefsRef.current.reducedMotion, ready: api?.ready === true }) === "three" ? summon3dKeyOf(kind, style) : null;
      const three = threeKey && api ? { key: threeKey, api } : null;
      if (kind === "heavy" || kind === "typed") {
        delayMs = Math.max(delayMs, heavyFreeAtRef.current - now);
        heavyFreeAtRef.current = now + delayMs + (three ? summon3dLockMs(three.key) : HEAVY_LOCK_MS);
      }
      if (three && event.card && event.card.code > 0) three.api.prefetchArt(event.card.code);
      // A card a fight destroyed keeps standing until the fight has landed its last strike.
      let breakMs: number | undefined;
      let claim3d = false;
      if (kind === "destroy") {
        claim3d = battleBreakIs3d(event.zone, now);
        const heldAt = battleDestroyAt(event.zone, now);
        if (heldAt > 0) {
          breakMs = HELD_CRACK_MS;
          delayMs = Math.max(delayMs, heldAt - now - breakMs);
        }
      }
      step += 1;
      seqRef.current += 1;
      const strength = kind === "heavy" || kind === "typed" ? slamStrengthOf(event, plan?.event.from?.location) : 0;
      const base: FxItem = {
        key: `${event.id}-${seqRef.current}`,
        kind,
        style,
        event,
        card: visibleCard(event),
        delayMs,
        reduced: prefsRef.current.reducedMotion,
        shake: prefsRef.current.shake,
        plan,
        strength,
        life: 0,
        breakMs,
        claim3d,
        three,
      };
      planned.push(base);
      if (strength > 0 && !base.reduced) {
        // The slam: shake, jolt, cracks and aura, timed to the moment the card lands.
        const hit = slamHitMs(kind, style, three?.key);
        seqRef.current += 1;
        planned.push({ ...base, key: `${event.id}-${seqRef.current}`, kind: "impact", delayMs: delayMs + hit, life: impactLifeMs(hit) });
      }
    }
    if (planned.length === 0) return;
    setItems((current) => [...current, ...planned].slice(-MAX_ITEMS - 4));
  }, [duelKey, events]);

  const finish = (key: string) => setItems((current) => current.filter((item) => item.key !== key));

  return (
    <div ref={overlayRef} className={styles.layer} aria-hidden="true">
      {overlay
        ? items.map((item) => (
            <FxView key={item.key} item={item} overlay={overlay} done={() => finish(item.key)} />
          ))
        : null}
    </div>
  );
}
