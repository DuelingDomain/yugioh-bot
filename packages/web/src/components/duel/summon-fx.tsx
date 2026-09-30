"use client";

/**
 * Board effects for summons, sets, activations and destruction.
 *
 * Heavy summons (Level/Rank 7+ or a Tribute Summon) get the full treatment: a holographic
 * projection of the card rises above its zone, drops onto it with weight, rings and dust burst,
 * the field shakes (strength set by the shake preference) and a few cracks spread over the board
 * before they fade. Lighter summons get a quick develop pop, sets settle face-down, activations
 * flip and light up, and destroyed cards break into shards that drift to the Graveyard.
 *
 * Everything is a Web Animation on an overlay that never takes pointer input, so the board stays
 * usable. The real card is only hidden (never removed) while its projection lands on top of it.
 */
import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import type { DuelCardInfo, DuelEvent } from "@yugidraft/shared/duels";
import { cardArtUrl, LOCATION_GRAVE, TYPE_XYZ } from "./constants";
import {
  collectFreshEvents,
  DUEL_FX_CUE_EVENT,
  findZoneElement,
  isHeavySummon,
  maxEventId,
  type DuelFxCue,
  type DuelFxCueDetail,
} from "./event-queue";
import type { DuelShakePreference } from "./preferences";
import styles from "./summon-fx.module.css";

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
  rise: 360,
  hoverEnd: 580,
  impact: 720,
  handOver: 800,
  shake: 420,
  crackDraw: 150,
  crackFadeFrom: 1040,
  total: 1600,
} as const;

/** Peak vertical field shake in px for a Level 8 monster on a 1100px-wide board (horizontal is 0.45x). */
export const SHAKE_AMPLITUDE_PX: Record<DuelShakePreference, number> = {
  off: 0,
  low: 3,
  medium: 7,
  high: 13,
};

const CARD_ASPECT = 0.686;
const STAGGER_MS = 140;
const MAX_STAGGER_STEPS = 5;
const HEAVY_LOCK_MS = 1000;
const MAX_ITEMS = 10;
const HIDE_FAILSAFE_MS = 4000;
const GY_LOCATION = LOCATION_GRAVE;

type FxKind = "heavy" | "light" | "set" | "activate" | "destroy";

type FxItem = {
  key: string;
  kind: FxKind;
  event: DuelEvent;
  card: DuelCardInfo | null;
  delayMs: number;
  reduced: boolean;
  shake: DuelShakePreference;
};

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
class Track {
  readonly anims: Animation[] = [];
  private readonly timers: number[] = [];

  play(el: Element | null | undefined, frames: Keyframe[], options: KeyframeAnimationOptions): Animation | null {
    if (!el || typeof el.animate !== "function") return null;
    const anim = el.animate(frames, { fill: "both", ...options });
    this.anims.push(anim);
    return anim;
  }

  after(ms: number, fn: () => void): void {
    this.timers.push(window.setTimeout(fn, Math.max(0, ms)));
  }

  /** Resolves when every animation on the track has finished (a cancel counts as finished). */
  settled(): Promise<unknown> {
    return Promise.allSettled(this.anims.map((anim) => anim.finished));
  }

  dispose(): void {
    for (const timer of this.timers) window.clearTimeout(timer);
    for (const anim of this.anims) {
      try {
        anim.cancel();
      } catch {
        // already gone
      }
    }
  }
}

/** Keeps the real card invisible for `ms` (fill both), then lets it back on its own. */
function holdHidden(track: Track, zone: HTMLElement, ms: number): void {
  const body = cardBodyOf(zone);
  track.play(body, [{ opacity: 0 }, { opacity: 0 }], { duration: Math.min(ms, HIDE_FAILSAFE_MS), fill: "backwards" });
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

function crackCount(card: DuelCardInfo | null): number {
  const level = card?.level ?? 0;
  return level >= 7 ? clamp(3 + (level - 7), 3, 6) : 3;
}

type CrackPath = { d: string; delay: number; span: number };

/** Fissures spreading from the zone across the board. Deterministic per event so a replay looks the same. */
function buildCracks(geo: Geo, count: number, seed: number): CrackPath[] {
  const rand = mulberry32(seed * 2654435761);
  const out: CrackPath[] = [];
  const base = rand() * Math.PI * 2;
  const start = geo.h * 0.42;
  for (let k = 0; k < count; k += 1) {
    const angle = base + (k / count) * Math.PI * 2 + (rand() - 0.5) * 0.7;
    const length = geo.h * (1.5 + rand() * 1.5);
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
    out.push({ d, delay: k * 14, span: 150 + rand() * 60 });
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
      out.push({ d: bd, delay: k * 14 + 60, span: 110 });
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

function levelLabel(card: DuelCardInfo | null, tribute: boolean): string {
  if (tribute) return "Tribute Summon";
  if (!card) return "";
  return `${(card.type & TYPE_XYZ) !== 0 ? "Rank" : "Level"} ${card.level}`;
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
function GlowFx({ item, overlay, done, tone }: EffectProps & { tone: "gold" | "violet" | "red" }) {
  const anchor = useAnchor();
  const glow = useRef<HTMLSpanElement>(null);
  useEffectSetup(overlay, item, done, ({ track, geo }) => {
    if (anchor.current) placeAnchor(anchor.current, geo);
    track.play(glow.current, [{ opacity: 0 }, { opacity: 0.95, offset: 0.25 }, { opacity: 0 }], {
      duration: 460,
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

/** Level 6 and below: the card develops in place with a small lift and a thin ring. Under 400 ms. */
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
      { duration: 380, delay: item.delayMs, easing: "cubic-bezier(0.22, 0.8, 0.3, 1)" },
    );
    pulseRing(track, ring.current, item.delayMs, { grow: 1.22, duration: 380, peak: 0.7 });
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
      { duration: 340, delay: item.delayMs, easing: "cubic-bezier(0.2, 0.75, 0.3, 1)" },
    );
    track.play(shadow.current, [{ opacity: 0, transform: "scale(1.25)" }, { opacity: 0.55, offset: 0.6 }, { opacity: 0, transform: "scale(1)" }], {
      duration: 380,
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
    if (art) {
      track.play(art, frames, { duration: 420, delay: item.delayMs, easing: "cubic-bezier(0.25, 0.8, 0.3, 1)" });
    } else if (ghost.current) {
      // The card already left the zone (it resolved): flip a copy in place so the activation still reads.
      track.play(ghost.current, [{ opacity: 0, transform: "perspective(520px) rotateY(84deg)" }, { opacity: 1, transform: "perspective(520px) rotateY(0deg)", offset: 0.4 }, { opacity: 1, offset: 0.75 }, { opacity: 0 }], {
        duration: 620,
        delay: item.delayMs,
        easing: "cubic-bezier(0.25, 0.8, 0.3, 1)",
      });
    }
    pulseRing(track, edge.current, item.delayMs + 60, { grow: 1.16, duration: 620, peak: 1 });
  });
  return (
    <div ref={anchor} className={styles.anchor}>
      <span ref={edge} className={styles.ring} data-tone={chain ? "gold" : "violet"} data-strong="true" />
      {item.card ? (
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
  useEffectSetup(overlay, item, done, ({ track, geo }) => {
    if (anchor.current) placeAnchor(anchor.current, geo);
    const d = item.delayMs;
    const breakAt = item.event.cause === "battle" ? 460 : 150;
    const burst = 520;
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
        { opacity: 1, filter: "brightness(1)", offset: (breakAt - 130) / total },
        { opacity: 1, filter: "brightness(1.7) saturate(1.2)", transform: "translate(-1.5px, 0)", offset: (breakAt - 70) / total },
        { opacity: 1, filter: "brightness(1.2)", transform: "translate(1.5px, 0)", offset: (breakAt - 20) / total },
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
    track.play(flash.current, [{ opacity: 0 }, { opacity: 0.8, offset: 0.35 }, { opacity: 0 }], {
      duration: 240,
      delay: d + breakAt - 20,
      easing: "ease-out",
    });

    const rand = mulberry32(seed * 40503 + 7);
    shards.current.forEach((el, index) => {
      const shard = SHARDS[index];
      if (!el || !shard) return;
      const ox = (shard.cx - 50) / 50;
      const oy = (shard.cy - 50) / 50;
      const burstX = ox * geo.w * (0.32 + rand() * 0.22);
      const burstY = oy * geo.h * (0.2 + rand() * 0.14) - geo.h * 0.05;
      const spin = (rand() - 0.5) * 70 + ox * 24;
      const lag = rand() * 70;
      const flyX = dxGy * (0.7 + rand() * 0.25) + burstX * 0.3;
      const flyY = dyGy * (0.7 + rand() * 0.25) + burstY * 0.3;
      track.play(
        el,
        [
          { opacity: 0, transform: "translate(0, 0) rotate(0deg) scale(1)", offset: 0 },
          { opacity: 0, transform: "translate(0, 0) rotate(0deg) scale(1)", offset: (breakAt - 1) / (breakAt + burst + lag) },
          { opacity: 1, transform: "translate(0, 0) rotate(0deg) scale(1)", offset: breakAt / (breakAt + burst + lag), easing: "cubic-bezier(0.1, 0.7, 0.3, 1)" },
          { opacity: 1, transform: `translate(${burstX}px, ${burstY}px) rotate(${spin * 0.6}deg) scale(1.02)`, offset: (breakAt + 150) / (breakAt + burst + lag), easing: "cubic-bezier(0.5, 0, 0.75, 0.4)" },
          { opacity: 0, transform: `translate(${flyX}px, ${flyY}px) rotate(${spin * 1.6}deg) scale(0.3)` },
        ],
        { duration: breakAt + burst + lag, delay: d, easing: "linear" },
      );
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
      {SHARDS.map((shard, index) => (
        <span
          key={index}
          ref={(el) => {
            shards.current[index] = el;
          }}
          className={styles.shard}
          style={
            {
              clipPath: shard.clip,
              transformOrigin: `${shard.cx}% ${shard.cy}%`,
              backgroundImage: card ? `url(${cardArtUrl(card.code, "small")})` : undefined,
            } as CSSProperties
          }
        />
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
  const dust = useRef<Array<HTMLSpanElement | null>>([]);
  const cracksSvg = useRef<SVGSVGElement>(null);
  const crackPaths = useRef<Array<SVGPathElement | null>>([]);
  const [cracks, setCracks] = useState<CrackPath[]>([]);
  const tribute = item.event.summonKind === "tribute";
  const cardInfo = item.card;
  const T = HEAVY_TIMELINE;

  useEffectSetup(overlay, item, done, ({ track, zone, geo }) => {
    const d = item.delayMs;
    const weight = heavyWeight(cardInfo, tribute);
    if (anchor.current) placeAnchor(anchor.current, geo);
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
        ? "linear-gradient(to top, rgb(130 190 255 / 0.3), rgb(155 126 255 / 0.05) 78%, transparent)"
        : "linear-gradient(to bottom, rgb(130 190 255 / 0.3), rgb(155 126 255 / 0.05) 78%, transparent)";
    }

    // The real card waits underneath until the projection has landed.
    holdHidden(track, zone, d + T.handOver);

    const tilt = up ? 1 : -1;
    const at = (ms: number) => ms / T.handOver;
    const slamEase = "cubic-bezier(0.62, 0, 0.95, 0.4)";
    const riseEase = "cubic-bezier(0.16, 1, 0.3, 1)";
    track.play(
      card.current,
      [
        { opacity: 0, transform: `translate3d(0, 0, 0) rotateX(${tilt * 34}deg) scale(0.74)`, offset: 0, easing: riseEase },
        { opacity: 1, transform: `translate3d(0, ${rise}px, 0) rotateX(${tilt * 14}deg) scale(1.25)`, offset: at(T.rise) },
        { opacity: 1, transform: `translate3d(0, ${rise * 1.04}px, 0) rotateX(${tilt * 10}deg) scale(1.26)`, offset: at(T.hoverEnd), easing: slamEase },
        { opacity: 1, transform: `translate3d(0, 0, 0) rotateX(0deg) scale(1)`, offset: at(T.impact), easing: "cubic-bezier(0.2, 0.9, 0.3, 1)" },
        { opacity: 1, transform: `translate3d(0, 0, 0) rotateX(0deg) scale(${1 + 0.035}, ${1 - 0.04})`, offset: at(T.impact + 36), easing: "ease-out" },
        { opacity: 1, transform: "translate3d(0, 0, 0) rotateX(0deg) scale(1)", offset: 1 },
      ],
      { duration: T.handOver, delay: d, fill: "backwards", easing: "linear" },
    );
    if (geo.defense) {
      // A monster summoned in Defense Position turns as it lands.
      track.play(art.current, [{ rotate: "0deg", offset: 0 }, { rotate: "0deg", offset: at(T.hoverEnd) }, { rotate: "90deg", offset: at(T.impact) }, { rotate: "90deg" }], {
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
      duration: 470,
      delay: hit,
      fill: "forwards",
      easing: "cubic-bezier(0.1, 0.7, 0.2, 1)",
    });
    track.play(ring2.current, [{ opacity: 0.5, transform: "scale(0.4)" }, { opacity: 0, transform: `scale(${grow * 1.35})` }], {
      duration: 620,
      delay: hit + 70,
      fill: "forwards",
      easing: "cubic-bezier(0.1, 0.7, 0.2, 1)",
    });
    track.play(burst.current, [{ opacity: 0.7, transform: "scale(0.6)" }, { opacity: 0, transform: "scale(1.25)" }], {
      duration: 260,
      delay: hit,
      fill: "forwards",
      easing: "ease-out",
    });
    const rand = mulberry32(item.event.id * 7919 + 11);
    dust.current.forEach((el) => {
      if (!el) return;
      const angle = rand() * Math.PI * 2;
      const dist = geo.w * (0.55 + rand() * 0.75);
      const dx = Math.cos(angle) * dist * 1.25;
      const dy = Math.sin(angle) * dist * 0.55 - geo.h * 0.05;
      const life = 420 + rand() * 260;
      track.play(
        el,
        [
          { opacity: 0.75, transform: "translate(0, 0) scale(1)" },
          { opacity: 0, transform: `translate(${dx}px, ${dy}px) scale(${0.25 + rand() * 0.3})` },
        ],
        { duration: life, delay: hit, fill: "forwards", easing: "cubic-bezier(0.1, 0.6, 0.3, 1)" },
      );
    });

    // Field shake, scaled by the preference and by how heavy the monster is.
    const field = document.querySelector<HTMLElement>("[data-duel-field]");
    const boardScale = clamp(geo.overlayW / 1100, 0.7, 1.4);
    const amp = SHAKE_AMPLITUDE_PX[item.shake] * weight * boardScale;
    if (amp > 0 && field) {
      const frames = shakeFrames(amp, item.event.id);
      track.play(field, frames, { duration: T.shake, delay: hit, fill: "none", easing: "linear" });
      track.play(cracksSvg.current, frames, { duration: T.shake, delay: hit, fill: "none", easing: "linear" });
    }
    // Keeps the item alive until the cracks have faded.
    track.play(anchor.current, [{ opacity: 1 }, { opacity: 1 }], { duration: T.total, delay: d });

    // Cracks: drawn on the impact, hold, then fade out before the effect ends.
    const built = buildCracks(geo, crackCount(cardInfo), item.event.id);
    setCracks(built);
  });

  // Crack strokes exist only after setCracks: animate them in a second pass.
  const cracksKey = cracks.length;
  useLayoutEffect(() => {
    if (cracks.length === 0) return undefined;
    const track = new Track();
    const hit = item.delayMs + T.impact;
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
        { opacity: 0, offset: (T.impact - 1) / T.total },
        { opacity: 1, offset: T.impact / T.total },
        { opacity: 1, offset: T.crackFadeFrom / T.total },
        { opacity: 0, offset: 1 },
      ],
      { duration: T.total, delay: item.delayMs, fill: "both", easing: "linear" },
    );
    return () => track.dispose();
    // Runs once when the crack geometry arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cracksKey]);

  return (
    <>
      <svg
        ref={cracksSvg}
        className={styles.cracks}
        viewBox={`0 0 ${overlay.clientWidth} ${overlay.clientHeight}`}
        aria-hidden="true"
      >
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
      <div ref={anchor} className={styles.anchor} data-fx="heavy">
        <span ref={pad} className={styles.pad} />
        <span ref={beam} className={styles.beam} />
        <span ref={shadow} className={styles.shadow} />
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
              <em>{levelLabel(cardInfo, tribute)}</em>
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

function FxView({ item, overlay, done }: EffectProps) {
  if (item.reduced) {
    const tone = item.kind === "destroy" ? "red" : item.kind === "activate" && item.event.chainIndex == null ? "violet" : "gold";
    return <GlowFx item={item} overlay={overlay} done={done} tone={tone} />;
  }
  switch (item.kind) {
    case "heavy":
      return <HeavyFx item={item} overlay={overlay} done={done} />;
    case "light":
      return <LightFx item={item} overlay={overlay} done={done} />;
    case "set":
      return <SetFx item={item} overlay={overlay} done={done} />;
    case "activate":
      return <ActivateFx item={item} overlay={overlay} done={done} />;
    case "destroy":
      return <DestroyFx item={item} overlay={overlay} done={done} />;
    default:
      return null;
  }
}

/* ---------- planning ---------- */

function visibleCard(event: DuelEvent): DuelCardInfo | null {
  const card = event.card;
  return card != null && card.code > 0 ? card : null;
}

function planKind(event: DuelEvent): FxKind | null {
  if (!event.zone) return null;
  switch (event.kind) {
    case "summon":
      return isHeavySummon(event) ? "heavy" : "light";
    case "set":
      return "set";
    case "activate":
      return "activate";
    case "destroy":
      return visibleCard(event) ? "destroy" : null;
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
    const planned: FxItem[] = [];
    let step = 0;
    for (const event of fresh) {
      const kind = planKind(event);
      if (!kind || !findZoneElement(event.zone)) continue;
      let delayMs = Math.min(step, MAX_STAGGER_STEPS) * STAGGER_MS;
      if (kind === "heavy") {
        delayMs = Math.max(delayMs, heavyFreeAtRef.current - now);
        heavyFreeAtRef.current = now + delayMs + HEAVY_LOCK_MS;
      }
      step += 1;
      seqRef.current += 1;
      planned.push({
        key: `${event.id}-${seqRef.current}`,
        kind,
        event,
        card: visibleCard(event),
        delayMs,
        reduced: prefsRef.current.reducedMotion,
        shake: prefsRef.current.shake,
      });
    }
    if (planned.length === 0) return;
    setItems((current) => [...current, ...planned].slice(-MAX_ITEMS));
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
