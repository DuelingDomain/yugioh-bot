import { easeInOutCubic, easeOutCubic, lerp, mulberry32, ramp } from "../ease";
import { FIELD_PLACEMENT_SCALE, fieldPlacementMs } from "../../placement-timing";
import { SUMMON3D_AUTHORED, type Summon3dKey, type Summon3dTimeline } from "../timeline";
import type { FxTint, Rgb } from "../types";
import { compose, DEFAULT_TINT, Rig, setColor, type FxFactory, type FxPart } from "./base";
import { embodiment } from "./embodiment";
import { burst, flash, particles, pillar, ringPulse, shockwave } from "./parts";

/**
 * The big summons. Each one is a build-up (its own look), the embodiment (see embodiment.ts) and a
 * landing that hits the field when the portrait drops into the card. Times are seconds; `u` is
 * the height of the card in px and the unit every size is written in.
 */

/** Colours of each summon type, taken from the card frame it belongs to. */
export const SUMMON_TINTS: Record<Exclude<Summon3dKey, "heavy">, FxTint> = {
  fusion: { main: [0.66, 0.42, 1], alt: [0.3, 0.5, 1], accent: [0.92, 0.82, 1] },
  synchro: { main: [0.55, 1, 0.66], alt: [0.92, 1, 0.94], accent: [1, 1, 1] },
  xyz: { main: [1, 0.8, 0.32], alt: [0.36, 0.26, 0.72], accent: [1, 0.95, 0.72] },
  link: { main: [0.25, 0.56, 1], alt: [0.5, 0.9, 1], accent: [0.86, 1, 1] },
  ritual: { main: [0.3, 0.56, 1], alt: [0.62, 0.82, 1], accent: [0.92, 0.98, 1] },
  pendulum: { main: [1, 0.6, 0.2], alt: [0.3, 0.9, 0.9], accent: [1, 0.92, 0.62] },
};

const STONE: readonly Rgb[] = [
  [0.34, 0.3, 0.28],
  [0.22, 0.2, 0.2],
  [0.46, 0.4, 0.34],
];

function hue(h: number): Rgb {
  const f = (n: number) => Math.min(1, Math.max(0, Math.abs(((h * 6 + n) % 6) - 3) - 1));
  return [f(0), f(4), f(2)];
}

function fadeWindow(sec: number, inEnd: number, outStart: number, outEnd: number): number {
  return ramp(sec, 0, inEnd) * (1 - ramp(sec, outStart, outEnd));
}

/** The hit on the field when the portrait drops into the card: light, ripple, motes and, if wanted, debris. */
function landing(rig: Rig, at: number, o: { debris: number; second?: boolean; column?: boolean }): FxPart[] {
  const u = rig.h;
  const { main, alt, accent } = rig.tint;
  const reach = Math.min(Math.max(rig.env.view.w, rig.env.view.h) * 1.5, u * (4.6 + 3.6 * rig.strength));
  const parts: FxPart[] = [
    flash(rig, { at, dur: 0.36, size: u * 3, color: accent, peak: 0.95 }),
    ringPulse(rig, { at, dur: 0.5, from: u * 0.9, to: u * 3.6, color: main, width: 0.07 }),
    shockwave(rig, { at, dur: 0.62, size: reach, color: main, peak: 0.9 }),
    burst(rig, { at, count: 34, speed: [140, 420], life: [0.4, 0.75], size: [8, 20], colors: [main, alt, accent], radius: u * 0.3, seed: 1 }),
  ];
  if (o.second) parts.push(shockwave(rig, { at: at + 0.13, dur: 0.6, size: reach * 0.72, color: alt, peak: 0.6, band: 0.16 }));
  if (o.column) {
    parts.push(pillar(rig, { start: at, grow: at + 0.16, end: at + 0.3, fade: at + 0.62, width: u * 1.5, height: Math.min(rig.env.view.h * 1.4, u * 6), color: main, color2: alt, dir: 1, peak: 0.95 }));
  }
  // Debris only moves the field, so the shake preference "off" drops it and keeps the light.
  const chunks = rig.shake > 0 ? Math.round(o.debris * Math.min(1.3, rig.shake)) : 0;
  if (chunks > 0) {
    parts.push(
      burst(rig, {
        at,
        count: chunks,
        speed: [200, 560],
        life: [0.7, 1.15],
        size: [12, 26],
        colors: [...STONE, [main[0] * 0.55, main[1] * 0.55, main[2] * 0.55]],
        shape: "chunk",
        kind: "solid",
        gravity: [0, -1100],
        radius: u * 0.25,
        fountain: true,
        seed: 2,
      }),
    );
  }
  return parts;
}

/* ---------- build-ups ---------- */

function fusion(rig: Rig, tl: Summon3dTimeline): FxPart[] {
  const u = rig.h;
  const H = tl.handOver / 1000;
  const { main, alt, accent } = rig.tint;
  const rand = mulberry32((rig.request.seed ?? 1) * 31);
  const disc = rig.mesh("vortex", { w: u * 3.6 });
  setColor(disc.material.uniforms.uColor, main);
  setColor(disc.material.uniforms.uColor2, alt);
  disc.material.uniforms.uArms.value = 3;
  disc.material.uniforms.uTwist.value = 7;
  disc.material.uniforms.uSpin.value = 5;
  disc.material.uniforms.uHole.value = 0.08;
  disc.visible = false;
  const vortex: FxPart = {
    update(sec) {
      const a = fadeWindow(sec, 0.3, H - 0.3, H + 0.05);
      disc.visible = a > 0.01;
      const s = u * 3.6 * lerp(0.4, 1, easeOutCubic(ramp(sec, 0, 0.5))) * lerp(1, 0.35, ramp(sec, H - 0.3, H));
      disc.scale.set(s, s, 1);
      disc.material.uniforms.uAlpha.value = a * 0.85;
      disc.material.uniforms.uTime.value = sec;
    },
  };
  // Two streams of energy, violet from one side and blue from the other, spiral into the zone.
  const streams = particles(rig, 150, { swirl: [4.6, 1, 0.12, 0.5], shrink: 0.5 }, (add, n) => {
    for (let i = 0; i < n; i += 1) {
      const side = i % 2 === 0 ? 1 : -1;
      add({
        x: side * u * (1.7 + rand() * 0.6),
        y: (rand() - 0.5) * u * 0.9,
        birth: rand() * 0.42,
        life: 0.55 + rand() * 0.25,
        size: 9 + rand() * 12,
        seed: rand(),
        color: side > 0 ? main : alt,
      });
    }
  });
  return [vortex, streams, flash(rig, { at: 0.6, dur: 0.5, size: u * 2.4, color: accent, peak: 0.85 })];
}

function synchro(rig: Rig, tl: Summon3dTimeline): FxPart[] {
  const u = rig.h;
  const H = tl.handOver / 1000;
  const { main, alt, accent } = rig.tint;
  const rand = mulberry32((rig.request.seed ?? 1) * 37);
  const RINGS = 4;
  const rings = Array.from({ length: RINGS }, (_, i) => {
    const mesh = rig.mesh("ring", { w: u * 3.6 });
    setColor(mesh.material.uniforms.uColor, i % 2 === 0 ? main : alt);
    mesh.material.uniforms.uRadius.value = 0.92;
    mesh.material.uniforms.uWidth.value = 0.05;
    mesh.visible = false;
    return mesh;
  });
  const stack: FxPart = {
    update(sec) {
      rings.forEach((mesh, i) => {
        const t0 = 0.05 + i * 0.09;
        const a = fadeWindow(sec - t0, 0.12, H - t0 - 0.35, H - t0 - 0.05);
        mesh.visible = a > 0.01;
        const d = u * lerp(3.8, 1.5 + i * 0.28, easeOutCubic(ramp(sec, t0, t0 + 0.4)));
        const wobble = 1 + Math.sin(sec * 9 + i * 1.7) * 0.02;
        mesh.scale.set(d * wobble, d * wobble, 1);
        mesh.material.uniforms.uAlpha.value = a * 0.95;
      });
    },
  };
  // Stars fly up through the rings.
  const stars = particles(rig, 96, { shape: "star", shrink: 0.4 }, (add, n) => {
    for (let i = 0; i < n; i += 1) {
      add({
        x: (rand() - 0.5) * u * 1.1,
        y: -u * (0.7 + rand() * 0.8),
        vy: u * (2.4 + rand() * 1.4),
        birth: 0.05 + rand() * 0.7,
        life: 0.65 + rand() * 0.35,
        size: 10 + rand() * 11,
        seed: rand(),
        color: i % 3 === 0 ? accent : i % 3 === 1 ? main : alt,
      });
    }
  });
  const beam = pillar(rig, { start: 0.42, grow: 0.62, end: 1.0, fade: H + 0.08, width: u * 1.1, height: Math.min(rig.env.view.h * 1.6, u * 7), color: accent, color2: main, peak: 0.95 });
  return [stack, stars, beam];
}

function xyz(rig: Rig, tl: Summon3dTimeline): FxPart[] {
  const u = rig.h;
  const H = tl.handOver / 1000;
  const { main, alt, accent } = rig.tint;
  const rand = mulberry32((rig.request.seed ?? 1) * 41);
  const galaxy = rig.mesh("galaxy", { w: u * 3.8 });
  setColor(galaxy.material.uniforms.uColor, main);
  setColor(galaxy.material.uniforms.uColor2, alt);
  galaxy.visible = false;
  const disc: FxPart = {
    update(sec) {
      const a = fadeWindow(sec, 0.35, H - 0.22, H + 0.04);
      galaxy.visible = a > 0.01;
      const collapse = easeInOutCubic(ramp(sec, 0.95, H));
      const s = u * 3.8 * lerp(0.35, 1, easeOutCubic(ramp(sec, 0, 0.55))) * lerp(1, 0.12, collapse);
      galaxy.scale.set(s, s, 1);
      galaxy.material.uniforms.uAlpha.value = a * 0.95;
      galaxy.material.uniforms.uTime.value = sec;
      galaxy.material.uniforms.uSpin.value = 2 + 3 * collapse;
    },
  };
  // Three material lights circle the galaxy on comet tails, then collapse into the centre.
  const TAIL = 22;
  const comets = particles(rig, 3 * TAIL, { swirl: [3.4, 1, 0.55, 0], shrink: 0.3 }, (add) => {
    for (let c = 0; c < 3; c += 1) {
      const a0 = (c / 3) * Math.PI * 2 + rand() * 0.4;
      for (let j = 0; j < TAIL; j += 1) {
        const a = a0 - j * 0.1;
        const r = u * 1.3 * (1 + 0.02 * j);
        const fade = 1 - j / TAIL;
        add({ x: Math.cos(a) * r, y: Math.sin(a) * r, birth: 0.12, life: 1.2, size: 8 + 20 * fade * fade, seed: rand(), color: j < 2 ? accent : main, weight: 0.25 + 0.75 * fade });
      }
    }
  });
  return [disc, comets, flash(rig, { at: 1.05, dur: 0.4, size: u * 2.2, color: accent, peak: 0.8 })];
}

function link(rig: Rig, tl: Summon3dTimeline): FxPart[] {
  const u = rig.h;
  const H = tl.handOver / 1000;
  const { main, alt, accent } = rig.tint;
  const rand = mulberry32((rig.request.seed ?? 1) * 43);
  const size = Math.min(u * 6, Math.min(rig.env.view.w, rig.env.view.h) * 0.98);
  const grid = rig.mesh("circuit", { w: size });
  setColor(grid.material.uniforms.uColor, main);
  setColor(grid.material.uniforms.uColor2, alt);
  grid.material.uniforms.uSeed.value = (rig.request.seed ?? 1) % 97;
  grid.material.uniforms.uCells.value = Math.round(18 * (size / (u * 6)) + 6);
  grid.visible = false;
  const circuit: FxPart = {
    update(sec) {
      const a = fadeWindow(sec, 0.12, H - 0.15, H + 0.2);
      grid.visible = a > 0.01;
      grid.material.uniforms.uAlpha.value = a;
      grid.material.uniforms.uFront.value = lerp(1.08, 0, easeInOutCubic(ramp(sec, 0, 0.62)));
    },
  };
  // Eight Link Arrows around the card light one after the other.
  const arrows = Array.from({ length: 8 }, (_, i) => {
    const angle = (i / 8) * Math.PI * 2;
    const a = rig.mesh("arrow", { x: Math.sin(angle) * rig.w * 0.68, y: Math.cos(angle) * u * 0.62, w: Math.max(16, rig.w * 0.36), rot: -angle });
    setColor(a.material.uniforms.uColor, i % 2 === 0 ? alt : accent);
    a.visible = false;
    return a;
  });
  const marks: FxPart = {
    update(sec) {
      arrows.forEach((mesh, i) => {
        const t0 = 0.42 + i * 0.05;
        const a = ramp(sec, t0, t0 + 0.08) * (1 - ramp(sec, H - 0.05, H + 0.25));
        mesh.visible = a > 0.01;
        mesh.material.uniforms.uAlpha.value = a * (0.85 + 0.15 * Math.sin(sec * 14 + i));
      });
    },
  };
  const streaks = particles(rig, 70, { shrink: 0.3, swirl: [0, 1, 0.1, 0] }, (add, n) => {
    for (let i = 0; i < n; i += 1) {
      const a = rand() * Math.PI * 2;
      const r = u * (2.2 + rand() * 0.8);
      add({ x: Math.cos(a) * r, y: Math.sin(a) * r, birth: 0.03 + rand() * 0.45, life: 0.45 + rand() * 0.2, size: 7 + rand() * 9, seed: rand(), color: i % 2 ? accent : main });
    }
  });
  return [circuit, marks, streaks];
}

function ritual(rig: Rig, tl: Summon3dTimeline): FxPart[] {
  const u = rig.h;
  const H = tl.handOver / 1000;
  const { main, alt, accent } = rig.tint;
  const rand = mulberry32((rig.request.seed ?? 1) * 47);
  const glow = rig.mesh("glow", { w: u * 2.8 });
  setColor(glow.material.uniforms.uColor, main);
  glow.visible = false;
  const rim = rig.mesh("ring", { w: u * 2.6 });
  setColor(rim.material.uniforms.uColor, alt);
  rim.material.uniforms.uRadius.value = 0.92;
  rim.material.uniforms.uWidth.value = 0.045;
  rim.visible = false;
  const runes = rig.mesh("rune", { w: u * 2.6 });
  setColor(runes.material.uniforms.uColor, main);
  setColor(runes.material.uniforms.uColor2, accent);
  runes.material.uniforms.uRadius.value = 0.72;
  runes.material.uniforms.uWidth.value = 0.13;
  runes.material.uniforms.uSegs.value = 22;
  runes.visible = false;
  const circle: FxPart = {
    update(sec) {
      const a = fadeWindow(sec, 0.22, H - 0.2, H + 0.08);
      for (const mesh of [glow, rim, runes]) mesh.visible = a > 0.01;
      glow.material.uniforms.uAlpha.value = a * 0.42;
      rim.material.uniforms.uAlpha.value = a * 0.9;
      runes.material.uniforms.uAlpha.value = a;
      runes.material.uniforms.uReveal.value = 0.02 + 1.03 * easeOutCubic(ramp(sec, 0.04, 0.6));
      runes.material.uniforms.uTime.value = sec;
      runes.material.uniforms.uSpin.value = 0.06;
    },
  };
  // Blue flames rise from the whole circle.
  const flames = particles(rig, 170, { gravity: [0, u * 1.6], shrink: 1 }, (add, n) => {
    for (let i = 0; i < n; i += 1) {
      const a = rand() * Math.PI * 2;
      const r = u * 1.2;
      add({
        x: Math.cos(a) * r,
        y: Math.sin(a) * r,
        vy: u * (0.4 + rand() * 0.9),
        birth: 0.05 + rand() * 1.0,
        life: 0.45 + rand() * 0.4,
        size: 22 + rand() * 20,
        seed: rand(),
        color: i % 4 === 0 ? accent : i % 4 === 1 ? alt : main,
        weight: 0.7,
      });
    }
  });
  return [circle, flames];
}

function pendulum(rig: Rig, tl: Summon3dTimeline): FxPart[] {
  const u = rig.h;
  const H = tl.handOver / 1000;
  const { main, alt, accent } = rig.tint;
  const pivotY = u * 1.7;
  const L = u * 1.55;
  const swing0 = 0.1;
  const period = 1.1;
  const angleAt = (sec: number) => 1.0 * Math.cos(((sec - swing0) / period) * Math.PI * 2) * (1 - 0.18 * ramp(sec, swing0, swing0 + period));
  const bobAt = (sec: number): [number, number] => {
    const a = angleAt(sec);
    return [Math.sin(a) * L, pivotY - Math.cos(a) * L];
  };
  const parts: FxPart[] = [];
  // Two pillars of light, one orange and one cyan, each with a spectrum running through it.
  for (const side of [-1, 1]) {
    parts.push(
      pillar(rig, {
        start: 0.02,
        grow: 0.3,
        end: H - 0.25,
        fade: H + 0.1,
        width: u * 0.62,
        height: Math.min(rig.env.view.h * 1.3, u * 4.6),
        color: side < 0 ? main : alt,
        color2: side < 0 ? accent : [0.7, 0.5, 1],
        x: side * u * 1.25,
        rainbow: 0.7,
        peak: 0.9,
      }),
    );
  }
  const rod = rig.mesh("pillar", { w: u * 0.05, h: L });
  rod.material.uniforms.uWidth.value = 0.8;
  setColor(rod.material.uniforms.uColor, accent);
  setColor(rod.material.uniforms.uColor2, main);
  rod.material.uniforms.uRainbow.value = 0.5;
  rod.visible = false;
  const bob = rig.mesh("glow", { w: u * 0.6 });
  setColor(bob.material.uniforms.uColor, accent);
  bob.material.uniforms.uPow.value = 1.4;
  bob.visible = false;
  const pivot = rig.mesh("glow", { w: u * 0.3, y: pivotY });
  setColor(pivot.material.uniforms.uColor, main);
  pivot.visible = false;
  const swingEnd = swing0 + period + 0.15;
  parts.push({
    update(sec) {
      const on = sec >= swing0 - 0.05 && sec < swingEnd + 0.25;
      const a = ramp(sec, swing0 - 0.05, swing0 + 0.1) * (1 - ramp(sec, swingEnd, swingEnd + 0.25));
      for (const mesh of [rod, bob, pivot]) mesh.visible = on;
      if (!on) return;
      const [bx, by] = bobAt(sec);
      bob.position.set(rig.cx + bx, rig.cy + by, 0);
      const midX = bx / 2;
      const midY = (by + pivotY) / 2;
      rod.position.set(rig.cx + midX, rig.cy + midY, 0);
      rod.rotation.z = Math.atan2(-bx, by - pivotY);
      rod.material.uniforms.uAlpha.value = 0.55 * a;
      rod.material.uniforms.uTime.value = sec;
      bob.material.uniforms.uAlpha.value = a;
      pivot.material.uniforms.uAlpha.value = 0.8 * a;
    },
  });
  // The swing leaves a spectrum behind it: the path is known, so the trail is laid out at once.
  const TRAIL = 64;
  parts.push(
    particles(rig, TRAIL, { shrink: 0.7 }, (add, n) => {
      for (let i = 0; i < n; i += 1) {
        const t = swing0 + (i / n) * (period + 0.1);
        const [x, y] = bobAt(t);
        add({ x, y, birth: t, life: 0.5, size: 18 - 8 * (i / n) * 0, seed: i / n, color: hue(0.02 + ((i / n) * 0.85) % 1), weight: 0.9 });
      }
    }),
  );
  return parts;
}

function heavy(rig: Rig, tl: Summon3dTimeline): FxPart[] {
  const u = rig.h;
  const H = tl.handOver / 1000;
  const { main, alt } = rig.tint;
  const rand = mulberry32((rig.request.seed ?? 1) * 53);
  const pad = rig.mesh("glow", { w: u * 2.8 });
  setColor(pad.material.uniforms.uColor, main);
  pad.visible = false;
  const charge: FxPart = {
    update(sec) {
      const a = ramp(sec, 0, 0.35) * (1 - ramp(sec, H, H + 0.2));
      pad.visible = a > 0.01;
      pad.material.uniforms.uAlpha.value = a * (0.35 + 0.3 * ramp(sec, 0.3, H));
    },
  };
  const column = pillar(rig, { start: 0.05, grow: 0.4, end: H - 0.1, fade: H + 0.05, width: u * 1.35, height: Math.min(rig.env.view.h * 1.3, u * 5), color: main, color2: alt, dir: 1, peak: 0.6 });
  const sparks = particles(rig, 80, { swirl: [2.4, 1, 0.2, 0.4], shrink: 0.6 }, (add, n) => {
    for (let i = 0; i < n; i += 1) {
      const a = rand() * Math.PI * 2;
      const r = u * (1.5 + rand() * 0.6);
      add({ x: Math.cos(a) * r, y: Math.sin(a) * r, birth: rand() * 0.55, life: 0.55 + rand() * 0.3, size: 8 + rand() * 11, seed: rand(), color: i % 3 === 0 ? alt : main });
    }
  });
  return [charge, column, sparks];
}

const BUILD: Record<Summon3dKey, (rig: Rig, tl: Summon3dTimeline) => FxPart[]> = {
  fusion,
  synchro,
  xyz,
  link,
  ritual,
  pendulum,
  heavy,
};

/** Debris and second ripples per summon: heavy monsters throw the most. */
const LANDING: Record<Summon3dKey, { debris: number; second: boolean; column: boolean }> = {
  heavy: { debris: 26, second: true, column: true },
  fusion: { debris: 8, second: false, column: false },
  synchro: { debris: 8, second: false, column: false },
  xyz: { debris: 12, second: true, column: false },
  link: { debris: 6, second: false, column: false },
  ritual: { debris: 12, second: true, column: false },
  pendulum: { debris: 8, second: false, column: false },
};

export function summonFactory(key: Summon3dKey): FxFactory {
  return (env, request) => {
    const tl = SUMMON3D_AUTHORED[key];
    const tint = key === "heavy" ? (request.tint ?? DEFAULT_TINT) : SUMMON_TINTS[key];
    const rig = new Rig(env, { ...request, tint });
    const land = LANDING[key];
    // Order matters: build-up first, the portrait over it, the landing over both.
    const parts = [
      ...BUILD[key](rig, tl),
      embodiment(rig, tl),
      ...landing(rig, tl.handOver / 1000, { debris: land.debris * (0.6 + 0.4 * rig.strength), second: land.second, column: land.column }),
    ];
    const effect = compose(rig, parts, tl.total);
    return { ...effect, durationMs: fieldPlacementMs(effect.durationMs), update: (sec) => effect.update(sec / FIELD_PLACEMENT_SCALE) };
  };
}

