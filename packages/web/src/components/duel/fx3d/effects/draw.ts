import { clamp01, easeInCubic, easeOutCubic, lerp, mulberry32, pulse, ramp } from "../ease";
import type { FxEnv, FxPart } from "./base";
import { Rig, setColor } from "./base";
import { burst, flash, particles, ringPulse, shockwave } from "./parts";
import type { FxRect, FxRequest, Rgb } from "../types";

/**
 * Drawing helpers for the attack and set-piece effects. A `Stage` is a Rig that covers the whole
 * canvas, so every point is a plain canvas position (CSS px, y DOWN, like the DOM rectangles) and
 * the parts convert to the scene's y-up offsets themselves. Times are seconds from the start.
 */

export type P = { x: number; y: number };

export const WHITE: Rgb = [1, 1, 1];

/** Mixes a colour toward white (k = 0 keeps it, 1 is white): the hot part of a light. */
export const hot = (c: Rgb, k: number): Rgb => [c[0] + (1 - c[0]) * k, c[1] + (1 - c[1]) * k, c[2] + (1 - c[2]) * k];

export const scaleRgb = (c: Rgb, k: number): Rgb => [Math.min(1, c[0] * k), Math.min(1, c[1] * k), Math.min(1, c[2] * k)];

export const mixRgb = (a: Rgb, b: Rgb, k: number): Rgb => [lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k)];

export class Stage {
  readonly rig: Rig;
  readonly view: { w: number; h: number };
  readonly rand: () => number;

  constructor(env: FxEnv, request: FxRequest, seed = 1) {
    this.view = env.view;
    this.rig = new Rig(env, { ...request, rect: { x: 0, y: 0, w: env.view.w, h: env.view.h } });
    this.rand = mulberry32((request.seed ?? 1) * 6151 + seed);
  }

  /** Canvas position (y down) to a Rig offset (from the canvas centre, y up). */
  off(p: P): P {
    return { x: p.x - this.view.w / 2, y: this.view.h / 2 - p.y };
  }
}

export const centreOf = (r: FxRect): P => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

export function dirOf(a: P, b: P): P {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  return len < 0.5 ? { x: 0, y: 1 } : { x: dx / len, y: dy / len };
}

/** Where a ray from the rectangle's centre toward `toward` leaves it, pushed out by `gap`. */
export function edgeOf(r: FxRect, toward: P, gap = 3): P {
  const c = centreOf(r);
  const d = dirOf(c, toward);
  if (d.x === 0 && d.y === 0) return c;
  const tx = d.x === 0 ? Infinity : r.w / 2 / Math.abs(d.x);
  const ty = d.y === 0 ? Infinity : r.h / 2 / Math.abs(d.y);
  const t = Math.min(tx, ty) + gap;
  return { x: c.x + d.x * t, y: c.y + d.y * t };
}

export const lerpP = (a: P, b: P, k: number): P => ({ x: lerp(a.x, b.x, k), y: lerp(a.y, b.y, k) });

/** A point on a quadratic curve. */
export function bezier(a: P, c: P, b: P, k: number): P {
  const m = 1 - k;
  return { x: m * m * a.x + 2 * m * k * c.x + k * k * b.x, y: m * m * a.y + 2 * m * k * c.y + k * k * b.y };
}

/** A jagged line from `a` to `b` (n+1 points), sideways offsets up to `amp` px, biggest in the middle. */
export function jagged(a: P, b: P, n: number, amp: number, rand: () => number): P[] {
  const d = dirOf(a, b);
  const nx = -d.y;
  const ny = d.x;
  const out: P[] = [a];
  for (let i = 1; i < n; i += 1) {
    const k = i / n;
    const o = (rand() - 0.5) * 2 * amp * Math.sin(k * Math.PI);
    out.push({ x: lerp(a.x, b.x, k) + nx * o, y: lerp(a.y, b.y, k) + ny * o });
  }
  out.push(b);
  return out;
}

/* ---------- parts ---------- */

export type BoltOptions = {
  /** At most 12 points, canvas positions. */
  pts: readonly P[];
  start: number;
  /** The head takes this long to run the whole line. */
  grow: number;
  /** The line stays lit until here, then the tail catches up with the head. */
  hold: number;
  end: number;
  width: number;
  color: Rgb;
  core?: Rgb;
  alpha?: number;
  flick?: number;
  dash?: number;
  taper?: number;
  bloom?: number;
  /** Head runs from the end to the start instead. */
  reverse?: boolean;
};

/** A line of light: laser, bolt, rip, chain. One quad over the bounding box; the shader draws the polyline. */
export function bolt(st: Stage, o: BoltOptions): FxPart {
  const pts = o.pts.slice(0, 12);
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of pts) {
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x);
    y1 = Math.max(y1, p.y);
  }
  const pad = Math.max(12, o.width * 9);
  const w = x1 - x0 + pad * 2;
  const h = y1 - y0 + pad * 2;
  const centre = { x: (x0 + x1) / 2, y: (y0 + y1) / 2 };
  const at = st.off(centre);
  const mesh = st.rig.mesh("bolt", { x: at.x, y: at.y, w, h });
  const u = mesh.material.uniforms;
  const list = pts.map((p) => ({ x: p.x - centre.x, y: centre.y - p.y }));
  if (o.reverse) list.reverse();
  for (let i = 0; i < list.length; i += 1) u.uPts.value[i].set(list[i].x, list[i].y);
  u.uCount.value = list.length;
  u.uSize.value.set(w, h);
  u.uWidth.value = o.width;
  setColor(u.uColor, o.color);
  setColor(u.uCore, o.core ?? hot(o.color, 0.85));
  u.uFlick.value = o.flick ?? 0;
  u.uDash.value = o.dash ?? 0;
  u.uTaper.value = o.taper ?? 0;
  u.uBloom.value = o.bloom ?? 0.35;
  mesh.visible = false;
  return {
    update(sec) {
      const on = sec >= o.start && sec < o.end;
      mesh.visible = on;
      if (!on) return;
      u.uTime.value = sec;
      u.uReveal.value = 1.06 * easeOutCubic(ramp(sec, o.start, o.start + o.grow));
      u.uTail.value = 1.06 * easeInCubic(ramp(sec, o.hold, o.end));
      u.uAlpha.value = (o.alpha ?? 1) * ramp(sec, o.start, o.start + 0.02) * (1 - 0.6 * ramp(sec, o.hold, o.end));
    },
  };
}

export type ArcOptions = {
  from: P;
  to: P;
  /** Diameter of the crescent, px. */
  size: number;
  /** The crescent's leading edge points this way (radians on screen, y down) at the start and at the end. */
  a0: number;
  a1: number;
  start: number;
  travel: number;
  end: number;
  color: Rgb;
  core?: Rgb;
  thick?: number;
  alpha?: number;
  /** The sweep reveals the crescent while it travels (default true). */
  sweep?: boolean;
};

/** A crescent of light (a blade) that travels and turns. */
export function arc(st: Stage, o: ArcOptions): FxPart {
  const at = st.off(o.from);
  const mesh = st.rig.mesh("arc", { x: at.x, y: at.y, w: o.size });
  const u = mesh.material.uniforms;
  setColor(u.uColor, o.color);
  setColor(u.uCore, o.core ?? hot(o.color, 0.8));
  u.uThick.value = o.thick ?? 0.32;
  mesh.visible = false;
  return {
    update(sec) {
      const on = sec >= o.start && sec < o.end;
      mesh.visible = on;
      if (!on) return;
      const k = easeInCubic(ramp(sec, o.start, o.start + o.travel)) * 0.4 + ramp(sec, o.start, o.start + o.travel) * 0.6;
      const p = st.off(lerpP(o.from, o.to, k));
      mesh.position.set(st.rig.cx + p.x, st.rig.cy + p.y, 0);
      // leading edge = mesh left; screen angle a (y down) -> scene angle -a; left is pi away
      mesh.rotation.z = -lerp(o.a0, o.a1, k) - Math.PI;
      u.uReveal.value = o.sweep === false ? 1.06 : 1.06 * ramp(sec, o.start, o.start + o.travel * 0.9);
      u.uTail.value = 1.06 * ramp(sec, o.start + o.travel * 0.7, o.end);
      u.uAlpha.value = (o.alpha ?? 1) * ramp(sec, o.start, o.start + 0.03) * (1 - ramp(sec, o.start + o.travel, o.end));
    },
  };
}

export type FireballOptions = {
  from: P;
  to: P;
  size: number;
  start: number;
  travel: number;
  /** Stays as a fading trail until here. */
  end: number;
  color: Rgb;
  color2: Rgb;
  curve?: number;
};

/** A ball of fire flying from `from` to `to`, tail streaming behind. */
export function fireball(st: Stage, o: FireballOptions): FxPart {
  const d = dirOf(o.from, o.to);
  const mid = lerpP(o.from, o.to, 0.5);
  const ctrl = { x: mid.x - d.y * (o.curve ?? 0), y: mid.y + d.x * (o.curve ?? 0) };
  const at = st.off(o.from);
  const mesh = st.rig.mesh("flame", { x: at.x, y: at.y, w: o.size * 2.8, h: o.size * 1.5 });
  const u = mesh.material.uniforms;
  setColor(u.uColor, o.color);
  setColor(u.uColor2, o.color2);
  mesh.visible = false;
  return {
    update(sec) {
      const on = sec >= o.start && sec < o.end;
      mesh.visible = on;
      if (!on) return;
      const k = easeInCubic(clamp01((sec - o.start) / o.travel)) * 0.55 + clamp01((sec - o.start) / o.travel) * 0.45;
      const p = bezier(o.from, ctrl, o.to, k);
      const ahead = bezier(o.from, ctrl, o.to, Math.min(1, k + 0.02));
      const heading = Math.atan2(ahead.y - p.y, ahead.x - p.x);
      const s = st.off(p);
      // the head is at the right edge of the quad; shift so the head sits on the point
      const shift = o.size * 1.4 * 0.62;
      mesh.position.set(st.rig.cx + s.x - Math.cos(-heading) * shift, st.rig.cy + s.y - Math.sin(-heading) * shift, 0);
      mesh.rotation.z = -heading;
      u.uTime.value = sec;
      u.uAlpha.value = ramp(sec, o.start, o.start + 0.03) * (1 - ramp(sec, o.start + o.travel, o.end));
      u.uTailLen.value = 1;
    },
  };
}

export type DecalOptions = {
  p: P;
  size: number;
  h?: number;
  kind: 0 | 1 | 2 | 3 | 4;
  rot?: number;
  at: number;
  /** Fully visible until here, then fades until `end`. */
  hold: number;
  end: number;
  color: Rgb;
  peak?: number;
  seed?: number;
  /** cracks: how far they have grown at the end; pit: the opening radius. */
  open?: number;
  ember?: number;
  /** Seconds the mark takes to appear. */
  rise?: number;
};

/** A mark on the board: dent, scorch, cracks, pit or burnt line. */
export function decal(st: Stage, o: DecalOptions): FxPart {
  const at = st.off(o.p);
  const mesh = st.rig.mesh("decal", { x: at.x, y: at.y, w: o.size, h: o.h ?? o.size, rot: -(o.rot ?? 0) });
  const u = mesh.material.uniforms;
  setColor(u.uColor, o.color);
  u.uKind.value = o.kind;
  u.uSeed.value = o.seed ?? 0.5;
  mesh.visible = false;
  return {
    update(sec) {
      const on = sec >= o.at && sec < o.end;
      mesh.visible = on;
      if (!on) return;
      const rise = o.rise ?? 0.08;
      const grown = easeOutCubic(ramp(sec, o.at, o.at + Math.max(0.05, rise * 3)));
      u.uAlpha.value = (o.peak ?? 1) * ramp(sec, o.at, o.at + rise) * (1 - ramp(sec, o.hold, o.end));
      u.uOpen.value = (o.open ?? 1) * (o.kind === 2 || o.kind === 3 || o.kind === 4 ? grown : 1);
      u.uEmber.value = (o.ember ?? 1) * (1 - ramp(sec, o.at, o.hold));
    },
  };
}

export type HazeOptions = { p: P; size: number; at: number; end: number; color: Rgb; peak?: number };

/** Heat haze: rising shimmer bands over the spot. */
export function haze(st: Stage, o: HazeOptions): FxPart {
  const at = st.off(o.p);
  const mesh = st.rig.mesh("haze", { x: at.x, y: at.y, w: o.size, h: o.size * 1.15 });
  const u = mesh.material.uniforms;
  setColor(u.uColor, o.color);
  mesh.visible = false;
  return {
    update(sec) {
      const on = sec >= o.at && sec < o.end;
      mesh.visible = on;
      if (!on) return;
      u.uTime.value = sec;
      u.uAlpha.value = (o.peak ?? 1) * pulse(sec, o.at, o.at + (o.end - o.at) * 0.25, o.end);
    },
  };
}

export type RuneOptions = {
  p: P;
  size: number;
  at: number;
  /** Fully drawn by here. */
  full: number;
  end: number;
  color: Rgb;
  color2: Rgb;
  spin?: number;
  peak?: number;
  segs?: number;
  /** Tilt the circle into the ground plane (0 = flat on screen). */
  squash?: number;
};

/** A ring of runes drawn around a point, turning. */
export function runeCircle(st: Stage, o: RuneOptions): FxPart {
  const at = st.off(o.p);
  const squash = o.squash ?? 1;
  const mesh = st.rig.mesh("rune", { x: at.x, y: at.y, w: o.size, h: o.size * squash });
  const u = mesh.material.uniforms;
  setColor(u.uColor, o.color);
  setColor(u.uColor2, o.color2);
  u.uSpin.value = o.spin ?? 0.06;
  u.uSegs.value = o.segs ?? 20;
  u.uRadius.value = 0.72;
  u.uWidth.value = 0.13;
  const inner = st.rig.mesh("ring", { x: at.x, y: at.y, w: o.size * 0.62, h: o.size * 0.62 * squash });
  setColor(inner.material.uniforms.uColor, o.color);
  inner.material.uniforms.uRadius.value = 0.9;
  inner.material.uniforms.uWidth.value = 0.03;
  mesh.visible = false;
  inner.visible = false;
  return {
    update(sec) {
      const on = sec >= o.at && sec < o.end;
      mesh.visible = on;
      inner.visible = on;
      if (!on) return;
      u.uTime.value = sec;
      u.uReveal.value = 1.04 * easeOutCubic(ramp(sec, o.at, o.full));
      const a = (o.peak ?? 1) * ramp(sec, o.at, o.at + 0.05) * (1 - ramp(sec, o.full + (o.end - o.full) * 0.3, o.end));
      u.uAlpha.value = a;
      inner.material.uniforms.uAlpha.value = a * 0.7;
    },
  };
}

export type OrbOptions = {
  from: P;
  to: P;
  size: number;
  start: number;
  travel: number;
  end: number;
  color: Rgb;
  curve?: number;
  ease?: "in" | "out" | "linear";
  trail?: number;
  trailColor?: Rgb;
};

/** A glowing orb along a curve with a trail of sparks left behind. Returns the parts and the path function. */
export function orb(st: Stage, o: OrbOptions): { parts: FxPart[]; at: (k: number) => P } {
  const d = dirOf(o.from, o.to);
  const mid = lerpP(o.from, o.to, 0.5);
  const ctrl = { x: mid.x - d.y * (o.curve ?? 0), y: mid.y + d.x * (o.curve ?? 0) };
  const shape = (k: number): number => (o.ease === "linear" ? k : o.ease === "out" ? easeOutCubic(k) : easeInCubic(k) * 0.6 + k * 0.4);
  const at = (k: number): P => bezier(o.from, ctrl, o.to, shape(clamp01(k)));
  const start = st.off(o.from);
  const halo = st.rig.mesh("glow", { x: start.x, y: start.y, w: o.size * 2.4 });
  const core = st.rig.mesh("glow", { x: start.x, y: start.y, w: o.size });
  setColor(halo.material.uniforms.uColor, o.color);
  halo.material.uniforms.uPow.value = 1.8;
  setColor(core.material.uniforms.uColor, hot(o.color, 0.7));
  core.material.uniforms.uPow.value = 1.2;
  halo.visible = false;
  core.visible = false;
  const parts: FxPart[] = [
    {
      update(sec) {
        const on = sec >= o.start && sec < o.end;
        halo.visible = on;
        core.visible = on;
        if (!on) return;
        const k = clamp01((sec - o.start) / o.travel);
        const p = st.off(at(k));
        halo.position.set(st.rig.cx + p.x, st.rig.cy + p.y, 0);
        core.position.set(st.rig.cx + p.x, st.rig.cy + p.y, 0);
        const pulseK = 1 + 0.12 * Math.sin(sec * 40);
        halo.scale.set(o.size * 2.4 * pulseK, o.size * 2.4 * pulseK, 1);
        core.scale.set(o.size * pulseK, o.size * pulseK, 1);
        const a = ramp(sec, o.start, o.start + 0.04) * (1 - ramp(sec, o.start + o.travel, o.end));
        halo.material.uniforms.uAlpha.value = 0.7 * a;
        core.material.uniforms.uAlpha.value = a;
      },
    },
  ];
  const n = o.trail ?? 0;
  if (n > 0) {
    const color = o.trailColor ?? o.color;
    parts.push(
      particles(st.rig, n, { shape: "dot", gravity: [0, -30], shrink: 1 }, (add, count) => {
        for (let i = 0; i < count; i += 1) {
          const k = (i + 0.5) / count;
          const p = st.off(at(k));
          add({
            x: p.x + (st.rand() - 0.5) * o.size * 0.4,
            y: p.y + (st.rand() - 0.5) * o.size * 0.4,
            vx: (st.rand() - 0.5) * 50,
            vy: (st.rand() - 0.5) * 50,
            birth: o.start + k * o.travel,
            life: 0.3 + st.rand() * 0.25,
            size: 5 + st.rand() * 7,
            seed: st.rand(),
            color: color,
            weight: 0.9,
          });
        }
      }),
    );
  }
  return { parts, at };
}

/** A soft light on the board at a canvas point. */
export function pool(st: Stage, p: P, o: { at: number; dur: number; size: number; color: Rgb; peak?: number }): FxPart {
  const off = st.off(p);
  return flash(st.rig, { ...o, x: off.x, y: off.y });
}

export function ring(st: Stage, p: P, o: { at: number; dur: number; from: number; to: number; color: Rgb; width?: number; peak?: number }): FxPart {
  const off = st.off(p);
  return ringPulse(st.rig, { ...o, x: off.x, y: off.y });
}

export function wave(st: Stage, p: P, o: { at: number; dur: number; size: number; color: Rgb; peak?: number; band?: number }): FxPart {
  const off = st.off(p);
  return shockwave(st.rig, { ...o, x: off.x, y: off.y });
}

export function sparks(
  st: Stage,
  p: P,
  o: {
    at: number;
    count: number;
    speed: [number, number];
    life: [number, number];
    size: [number, number];
    colors: readonly Rgb[];
    shape?: "dot" | "star" | "chunk";
    kind?: "add" | "solid";
    gravity?: [number, number];
    radius?: number;
    /** Direction on screen (radians, y down) and spread. */
    cone?: [number, number];
    seed?: number;
  },
): FxPart {
  const off = st.off(p);
  return burst(st.rig, {
    at: o.at,
    count: o.count,
    speed: o.speed,
    life: o.life,
    size: o.size,
    colors: o.colors,
    shape: o.shape,
    kind: o.kind,
    gravity: o.gravity,
    radius: o.radius,
    seed: o.seed,
    x: off.x,
    y: off.y,
    cone: o.cone ? [-o.cone[0], o.cone[1]] : undefined,
  });
}

/** A silhouette / generic timed mesh: shows between `at` and `end`, fades in and out. */
export function timedMesh(
  st: Stage,
  name: "sil" | "hex" | "tide" | "glow" | "vortex" | "galaxy" | "pillar" | "ring",
  o: { p: P; w: number; h?: number; rot?: number; at: number; end: number; fadeIn?: number; fadeOut?: number; peak?: number },
  setup: (mesh: ReturnType<Rig["mesh"]>) => void,
  tick?: (mesh: ReturnType<Rig["mesh"]>, sec: number, k: number) => void,
): FxPart {
  const off = st.off(o.p);
  const mesh = st.rig.mesh(name, { x: off.x, y: off.y, w: o.w, h: o.h, rot: o.rot });
  setup(mesh);
  mesh.visible = false;
  return {
    update(sec) {
      const on = sec >= o.at && sec < o.end;
      mesh.visible = on;
      if (!on) return;
      const k = (sec - o.at) / Math.max(0.001, o.end - o.at);
      const a = (o.peak ?? 1) * ramp(sec, o.at, o.at + (o.fadeIn ?? 0.06)) * (1 - ramp(sec, o.end - (o.fadeOut ?? 0.15), o.end));
      if ("uAlpha" in mesh.material.uniforms) mesh.material.uniforms.uAlpha.value = a;
      tick?.(mesh, sec, k);
    },
  };
}
