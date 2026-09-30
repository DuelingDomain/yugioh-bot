import type * as THREE from "three";
import { easeOutCubic, mulberry32, pulse, ramp } from "../ease";
import type { ParticleSet } from "../kit";
import type { Rgb } from "../types";
import { jitter, setColor, type FxPart, type Rig } from "./base";

/** Building blocks the summon effects (and later the attack effects) are made of. Times are seconds. */

type Add = ParticleSet["add"];

const SHAPE = { dot: 0, star: 1, chunk: 2 } as const;
export type ParticleShape = keyof typeof SHAPE;

export type ParticleConfig = {
  shape?: ParticleShape;
  kind?: "add" | "solid";
  /** Pixels per second squared, y up (buoyancy is positive). */
  gravity?: [number, number];
  /** [angular speed rad/s, share pulled to the centre 0..1, life fraction where the pull starts, speed variance]. */
  swirl?: [number, number, number, number];
  /** Points shrink over their life (1) or keep their size (0). */
  shrink?: number;
  /** Master alpha over time; default 1. */
  alpha?: (sec: number) => number;
};

/** A GPU particle set. `fill` adds the particles; the shader moves them from then on. */
export function particles(
  rig: Rig,
  count: number,
  config: ParticleConfig,
  fill: (add: Add, n: number) => void,
): FxPart & { points: THREE.Points } {
  const n = rig.count(count);
  const { set, material } = rig.points(n, config.kind ?? "add");
  fill((p) => set.add(p), n);
  set.commit();
  const u = material.uniforms;
  u.uShape.value = SHAPE[config.shape ?? "dot"];
  u.uShrink.value = config.shrink ?? 1;
  const g = config.gravity ?? [0, 0];
  u.uGravity.value.set(g[0], g[1], 0);
  const s = config.swirl ?? [0, 0, 0, 0];
  u.uSwirl.value.set(s[0], s[1], s[2], s[3]);
  return {
    points: set.points,
    update(sec) {
      u.uTime.value = sec;
      u.uAlpha.value = config.alpha ? config.alpha(sec) : 1;
    },
  };
}

/** A radial burst of particles from the origin at `at`. */
export function burst(
  rig: Rig,
  o: {
    at: number;
    count: number;
    speed: [number, number];
    life: [number, number];
    size: [number, number];
    colors: readonly Rgb[];
    shape?: ParticleShape;
    kind?: "add" | "solid";
    gravity?: [number, number];
    /** Radius of the ring the particles start on. */
    radius?: number;
    /** Only fly upward-ish (a fountain) instead of all around. */
    fountain?: boolean;
    seed?: number;
    /** Where it starts, px from the effect origin, y up. */
    x?: number;
    y?: number;
    /** A fixed direction (rad, y up) and spread (rad) instead of all around. */
    cone?: [number, number];
  },
): FxPart {
  const rand = mulberry32((rig.request.seed ?? 1) * 7919 + (o.seed ?? 0));
  return particles(rig, o.count, { shape: o.shape, kind: o.kind, gravity: o.gravity, shrink: o.kind === "solid" ? 0.2 : 1 }, (add, n) => {
    for (let i = 0; i < n; i += 1) {
      const angle = o.cone ? o.cone[0] + (rand() - 0.5) * o.cone[1] : o.fountain ? Math.PI / 2 + (rand() - 0.5) * 2.2 : rand() * Math.PI * 2;
      const speed = o.speed[0] + rand() * (o.speed[1] - o.speed[0]);
      const r = o.radius ?? 0;
      add({
        x: (o.x ?? 0) + Math.cos(angle) * r,
        y: (o.y ?? 0) + Math.sin(angle) * r,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        birth: o.at + rand() * 0.04,
        life: o.life[0] + rand() * (o.life[1] - o.life[0]),
        size: o.size[0] + rand() * (o.size[1] - o.size[0]),
        seed: rand(),
        color: jitter(o.colors[i % o.colors.length], rand),
      });
    }
  });
}

/** A soft flash of light on the zone. */
export function flash(rig: Rig, o: { at: number; dur: number; size: number; color: Rgb; peak?: number; x?: number; y?: number }): FxPart {
  const mesh = rig.mesh("glow", { w: o.size, x: o.x, y: o.y });
  setColor(mesh.material.uniforms.uColor, o.color);
  mesh.material.uniforms.uPow.value = 1.6;
  mesh.visible = false;
  return {
    update(sec) {
      const k = ramp(sec, o.at, o.at + o.dur);
      mesh.visible = k > 0 && k < 1;
      if (!mesh.visible) return;
      const a = pulse(k, 0, 0.18, 1);
      mesh.material.uniforms.uAlpha.value = a * (o.peak ?? 1);
      const s = o.size * (0.55 + 0.6 * easeOutCubic(k));
      mesh.scale.set(s, s, 1);
    },
  };
}

/** A ring that grows from `from` to `to` (diameters, px) and fades. */
export function ringPulse(
  rig: Rig,
  o: { at: number; dur: number; from: number; to: number; color: Rgb; width?: number; peak?: number; x?: number; y?: number },
): FxPart {
  const mesh = rig.mesh("ring", { w: o.to, x: o.x, y: o.y });
  setColor(mesh.material.uniforms.uColor, o.color);
  mesh.visible = false;
  return {
    update(sec) {
      const k = ramp(sec, o.at, o.at + o.dur);
      mesh.visible = k > 0 && k < 1;
      if (!mesh.visible) return;
      const e = easeOutCubic(k);
      const d = o.from + (o.to - o.from) * e;
      mesh.scale.set(d, d, 1);
      mesh.material.uniforms.uRadius.value = 0.9;
      mesh.material.uniforms.uWidth.value = (o.width ?? 0.06) * (1 - 0.5 * k);
      mesh.material.uniforms.uAlpha.value = (1 - k) * (o.peak ?? 1) * ramp(k, 0, 0.08);
    },
  };
}

/**
 * The ground ripple: bands of light and shade rolling outward over the field, with a ring at the
 * front. `shake` scales how strongly the shade bands dent the board (0 keeps only the light).
 */
export function shockwave(
  rig: Rig,
  o: { at: number; dur: number; size: number; color: Rgb; peak?: number; band?: number; x?: number; y?: number },
): FxPart {
  const ripple = rig.mesh("ripple", { w: o.size, x: o.x, y: o.y });
  setColor(ripple.material.uniforms.uColor, o.color);
  ripple.material.uniforms.uBand.value = o.band ?? 0.2;
  ripple.material.uniforms.uAmp.value = Math.min(1.4, rig.shake);
  ripple.visible = false;
  const ring = rig.mesh("ring", { w: o.size, x: o.x, y: o.y });
  setColor(ring.material.uniforms.uColor, o.color);
  ring.visible = false;
  return {
    update(sec) {
      const k = ramp(sec, o.at, o.at + o.dur);
      const on = k > 0 && k < 1;
      ripple.visible = on;
      ring.visible = on;
      if (!on) return;
      const front = 0.04 + 0.96 * easeOutCubic(k);
      const fade = Math.pow(1 - k, 1.3) * (o.peak ?? 1);
      ripple.material.uniforms.uFront.value = front;
      ripple.material.uniforms.uAlpha.value = fade;
      ripple.material.uniforms.uGlow.value = 1 - k;
      ring.material.uniforms.uRadius.value = front;
      ring.material.uniforms.uWidth.value = 0.035 * (1 - 0.6 * k) + 0.01;
      ring.material.uniforms.uAlpha.value = fade * 0.85;
    },
  };
}

/** A beam of light through the zone. `dir` 1 rises upward from the zone, -1 downward, 0 spreads both ways. */
export function pillar(
  rig: Rig,
  o: {
    start: number;
    grow: number;
    end: number;
    fade: number;
    width: number;
    height: number;
    color: Rgb;
    color2: Rgb;
    dir?: 1 | -1 | 0;
    rainbow?: number;
    peak?: number;
    x?: number;
    y?: number;
    rot?: number;
  },
): FxPart {
  const dir = o.dir ?? 0;
  const offset = dir * (o.height / 2);
  const mesh = rig.mesh("pillar", { x: o.x ?? 0, y: (o.y ?? 0) + offset, w: o.width, h: o.height, rot: (o.rot ?? 0) + (dir < 0 ? Math.PI : 0) });
  const u = mesh.material.uniforms;
  setColor(u.uColor, o.color);
  setColor(u.uColor2, o.color2);
  u.uSided.value = dir === 0 ? 0 : 1;
  u.uWidth.value = 0.55;
  u.uRainbow.value = o.rainbow ?? 0;
  mesh.visible = false;
  return {
    update(sec) {
      const on = sec >= o.start && sec < o.fade;
      mesh.visible = on;
      if (!on) return;
      u.uGrow.value = 0.12 + 0.95 * easeOutCubic(ramp(sec, o.start, o.grow));
      u.uAlpha.value = (o.peak ?? 1) * ramp(sec, o.start, o.start + 0.1) * (1 - ramp(sec, o.end, o.fade));
      u.uTime.value = sec;
    },
  };
}
