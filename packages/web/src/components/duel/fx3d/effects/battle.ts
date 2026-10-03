import { clamp01 } from "../ease";
import type { FxAttackStyle, FxStrike, Rgb } from "../types";
import { compose, setColor, type FxFactory, type FxPart } from "./base";
import {
  arc,
  bezier,
  bolt,
  centreOf,
  decal,
  dirOf,
  edgeOf,
  fireball,
  haze,
  hot,
  jagged,
  lerpP,
  orb,
  pool,
  ring,
  runeCircle,
  sparks,
  Stage,
  timedMesh,
  wave,
  WHITE,
  type P,
} from "./draw";
import { cardBreak, cutOf } from "./shards";
import { particles } from "./parts";

/**
 * The seven attack styles and six signature attacks, drawn in the Three.js layer. Every strike is
 * built twice: `ground` puts marks and ripples on the board first, then the card shards, then `air`
 * draws the light on top. All times are seconds; a strike lands at `impactMs / 1000` exactly, which is
 * the moment `battleTiming` and the sound use.
 */

const SIG = { BLUE_EYES: 89631139, DARK_MAGICIAN: 46986414, DARK_MAGICIAN_GIRL: 38033121, RED_EYES: 74677422, CYBER_DRAGON: 70095154, SUMMONED_SKULL: 70781052 } as const;

type Ctx = {
  st: Stage;
  s: FxStrike;
  /** Start and end of the flight, seconds. */
  t0: number;
  ti: number;
  p0: P;
  p1: P;
  dir: P;
  angle: number;
  /** Size unit: about one card height. */
  u: number;
  /** Strength of this strike (counters are weaker). */
  k: number;
  hi: Rgb;
  main: Rgb;
  deep: Rgb;
};

function context(st: Stage, s: FxStrike): Ctx {
  const p1 = centreOf(s.to);
  const p0 = edgeOf(s.from, p1, 2);
  const dir = dirOf(p0, p1);
  const k = 0.6 + 0.4 * s.scale;
  return {
    st,
    s,
    t0: s.startMs / 1000,
    ti: s.impactMs / 1000,
    p0,
    p1,
    dir,
    angle: Math.atan2(dir.y, dir.x),
    u: Math.max(60, (s.from.h + s.to.h) / 2) * k,
    k,
    hi: s.tint.accent,
    main: s.tint.main,
    deep: s.tint.alt,
  };
}

const along = (c: Ctx, tPx: number, side = 0): P => ({ x: c.p1.x + c.dir.x * tPx - c.dir.y * side, y: c.p1.y + c.dir.y * tPx + c.dir.x * side });

/** A trail of particles laid along a path over time. */
function trail(
  c: Ctx,
  at: (k: number) => P,
  o: { start: number; travel: number; n: number; colors: readonly Rgb[]; size: [number, number]; life: [number, number]; spread?: number; gravity?: [number, number]; shape?: "dot" | "star" | "chunk"; kind?: "add" | "solid" },
): FxPart {
  const { st } = c;
  return particles(st.rig, o.n, { shape: o.shape ?? "dot", kind: o.kind, gravity: o.gravity ?? [0, 40], shrink: 1 }, (add, count) => {
    for (let i = 0; i < count; i += 1) {
      const k = (i + st.rand()) / count;
      const p = st.off(at(k));
      const sp = o.spread ?? 24;
      add({
        x: p.x + (st.rand() - 0.5) * 8,
        y: p.y + (st.rand() - 0.5) * 8,
        vx: (st.rand() - 0.5) * sp * 2,
        vy: (st.rand() - 0.5) * sp * 2,
        birth: o.start + k * o.travel,
        life: o.life[0] + st.rand() * (o.life[1] - o.life[0]),
        size: o.size[0] + st.rand() * (o.size[1] - o.size[0]),
        seed: st.rand(),
        color: o.colors[i % o.colors.length],
      });
    }
  });
}

/* ---------- shared impact ---------- */

function groundCommon(c: Ctx, kind: 0 | 1 | 2 | 4, size: number, color: Rgb, rot = 0): FxPart[] {
  const { s, st, ti } = c;
  if (s.direct) return [wave(st, c.p1, { at: ti, dur: 0.5, size: c.u * 2.6, color: c.deep, peak: 0.5 })];
  return [
    wave(st, c.p1, { at: ti, dur: 0.62, size: c.u * (3.6 + s.scale), color: hot(c.deep, 0.15), peak: 0.85, band: 0.22 }),
    decal(st, { p: c.p1, size, kind, rot, at: ti, hold: ti + 0.45, end: ti + 1.15, color, seed: (s.impactMs % 97) / 97, peak: 0.85 }),
  ];
}

function airCommon(c: Ctx, size = 1): FxPart[] {
  const { st, ti } = c;
  return [
    pool(st, c.p1, { at: ti - 0.02, dur: 0.34, size: c.u * 2.1 * size, color: hot(c.main, 0.3), peak: 0.6 }),
    ring(st, c.p1, { at: ti, dur: 0.42, from: c.u * 0.3, to: c.u * 2.2 * size, color: c.hi, width: 0.05, peak: 0.75 }),
  ];
}

/* ---------- ground layer ---------- */

function ground(c: Ctx): FxPart[] {
  const { s } = c;
  const parts: FxPart[] = [];
  switch (s.style) {
    case "slash":
      parts.push(...groundCommon(c, 4, c.u * 1.5, hot(c.deep, -0.2), diagRot(c)));
      break;
    case "claw":
      parts.push(...groundCommon(c, 4, c.u * 1.5, [0.3, 0.02, 0.04], diagRot(c)));
      break;
    case "beam":
      parts.push(...groundCommon(c, 1, c.u * 1.5, [0.02, 0.05, 0.08]));
      if (!s.direct) parts.push(decal(c.st, { p: lerpP(c.p0, c.p1, 0.5), size: Math.hypot(c.p1.x - c.p0.x, c.p1.y - c.p0.y), h: c.u * 0.35, kind: 4, rot: c.angle, at: c.ti, hold: c.ti + 0.35, end: c.ti + 0.9, color: [0.03, 0.06, 0.1], peak: 0.35 }));
      break;
    case "arcane":
      parts.push(...groundCommon(c, 1, c.u * 1.7, hot(c.deep, -0.6)));
      break;
    case "lightning":
      parts.push(...groundCommon(c, 1, c.u * 1.3, [0.03, 0.03, 0.06]));
      break;
    case "flame":
      parts.push(...groundCommon(c, 1, c.u * 1.8, [0.1, 0.03, 0.01]));
      break;
    case "impact":
      parts.push(...groundCommon(c, 0, c.u * 1.9, [0.06, 0.05, 0.05]));
      if (!s.direct) parts.push(decal(c.st, { p: c.p1, size: c.u * 2.1, kind: 2, at: c.ti, hold: c.ti + 0.5, end: c.ti + 1.15, color: [0.05, 0.04, 0.04], seed: 0.31, open: 1, peak: 0.9 }));
      break;
  }
  // signature marks on the board
  if (s.signature === SIG.DARK_MAGICIAN) {
    parts.push(wave(c.st, c.p1, { at: c.ti + 0.06, dur: 0.75, size: c.u * 5, color: [0.12, 0.03, 0.22], peak: 0.85, band: 0.3 }));
  } else if (s.signature === SIG.RED_EYES) {
    parts.push(wave(c.st, c.p1, { at: c.ti, dur: 0.7, size: c.u * 5, color: [0.7, 0.08, 0.02], peak: 0.7, band: 0.25 }));
  }
  return parts;
}

const diagRot = (c: Ctx): number => cutAngle(c);

/** The angle (radians, y down) of the cut across the target: a diagonal to the blow. */
function cutAngle(c: Ctx): number {
  const flip = c.s.impactMs % 2 === 0 ? 1 : -1;
  return c.angle + flip * (Math.PI / 2 - 0.55);
}

/* ---------- air layer ---------- */

function cutLine(c: Ctx, offset: number, reach: number): P[] {
  const a = cutAngle(c);
  const d = { x: Math.cos(a), y: Math.sin(a) };
  const nx = -d.y;
  const ny = d.x;
  const mid = { x: c.p1.x + nx * offset, y: c.p1.y + ny * offset };
  return [
    { x: mid.x - d.x * reach, y: mid.y - d.y * reach },
    { x: mid.x + d.x * reach, y: mid.y + d.y * reach },
  ];
}

function slash(c: Ctx): FxPart[] {
  const { st, ti, t0, u, k } = c;
  const cut = cutLine(c, 0, c.s.to.h * 0.8);
  const flightEnd = Math.max(t0 + 0.12, ti - 0.02);
  return [
    pool(st, c.p0, { at: t0, dur: 0.22, size: u * 0.9, color: hot(c.main, 0.5), peak: 0.7 }),
    arc(st, { from: c.p0, to: c.p1, size: u * 1.25, a0: c.angle - 0.5, a1: c.angle + 0.35, start: t0 + 0.03, travel: flightEnd - t0 - 0.03, end: ti + 0.05, color: c.main, core: c.hi, thick: 0.34 }),
    bolt(st, { pts: cut, start: ti - 0.02, grow: 0.07, hold: ti + 0.1, end: ti + 0.38, width: 6 * k, color: c.main, core: WHITE, taper: 1, bloom: 0.55 }),
    bolt(st, { pts: cut, start: ti, grow: 0.05, hold: ti + 0.3, end: ti + 0.65, width: 14 * k, color: c.deep, alpha: 0.4, taper: 1, bloom: 0.2 }),
    sparks(st, c.p1, { at: ti, count: 30, speed: [160, 520], life: [0.2, 0.55], size: [4, 9], colors: [c.hi, c.main, WHITE], shape: "star", gravity: [0, -700], radius: 6 }),
    ...airCommon(c, 0.8),
  ];
}

function claw(c: Ctx): FxPart[] {
  const { st, ti, t0, u, k } = c;
  const parts: FxPart[] = [];
  const stagger = [0, 0.055, 0.11];
  const offsets = [-0.26, 0, 0.26];
  parts.push(
    bolt(st, { pts: [c.p0, lerpP(c.p0, c.p1, 0.94)], start: t0 + 0.04, grow: Math.max(0.1, ti - t0 - 0.08), hold: ti - 0.02, end: ti + 0.08, width: 9 * k, color: c.deep, alpha: 0.5, taper: 1, bloom: 0.2 }),
  );
  for (let i = 0; i < 3; i += 1) {
    const line = cutLine(c, offsets[i] * c.s.to.w, c.s.to.h * 0.85);
    const at = ti - 0.02 + stagger[i];
    parts.push(
      bolt(st, { pts: line, start: at, grow: 0.08, hold: at + 0.18, end: at + 0.5, width: 8 * k, color: c.main, core: WHITE, taper: 1, bloom: 0.5 }),
      bolt(st, { pts: line, start: at + 0.05, grow: 0.06, hold: at + 0.55, end: at + 0.85, width: 5 * k, color: [1, 0.15, 0.1], alpha: 0.35, taper: 1, bloom: 0.1 }),
    );
  }
  parts.push(
    pool(st, c.p1, { at: ti, dur: 0.5, size: u * 2.2, color: hot([0.9, 0.1, 0.1], 0.1), peak: 0.5 }),
    sparks(st, c.p1, { at: ti + 0.02, count: 22, speed: [120, 420], life: [0.25, 0.6], size: [3, 7], colors: [c.hi, c.main], shape: "star", gravity: [0, -600], radius: 8 }),
    ...airCommon(c, 0.75),
  );
  return parts;
}

function beam(c: Ctx): FxPart[] {
  const { st, ti, t0, u, k } = c;
  const charge = t0 + (ti - t0) * 0.6;
  const width = 18 * k;
  return [
    pool(st, c.p0, { at: t0, dur: charge - t0 + 0.25, size: u * 1.6, color: c.main, peak: 0.8 }),
    ring(st, c.p0, { at: t0, dur: Math.max(0.15, charge - t0), from: u * 1.7, to: u * 0.25, color: c.hi, width: 0.07, peak: 0.85 }),
    bolt(st, { pts: [c.p0, c.p1], start: charge, grow: Math.max(0.05, ti - charge), hold: ti + 0.32, end: ti + 0.52, width: width * 2.2, color: c.deep, alpha: 0.45, bloom: 0.6 }),
    bolt(st, { pts: [c.p0, c.p1], start: charge, grow: Math.max(0.05, ti - charge), hold: ti + 0.32, end: ti + 0.5, width, color: c.main, core: WHITE, flick: 0.15, bloom: 0.7 }),
    pool(st, c.p1, { at: ti - 0.02, dur: 0.6, size: u * 3.2, color: hot(c.main, 0.4), peak: 0.9 }),
    sparks(st, c.p1, { at: ti, count: 36, speed: [140, 560], life: [0.25, 0.7], size: [3, 8], colors: [c.hi, c.main, WHITE], gravity: [0, -400], radius: 4 }),
    ...airCommon(c, 1.1),
  ];
}

function arcane(c: Ctx): FxPart[] {
  const { st, ti, t0, u } = c;
  const bend = (c.s.impactMs % 2 === 0 ? 1 : -1) * u * 0.7;
  const travelStart = t0 + (ti - t0) * 0.45;
  const flight = orb(st, { from: c.p0, to: c.p1, size: u * 0.55, start: travelStart, travel: Math.max(0.1, ti - travelStart), end: ti + 0.03, color: c.main, curve: bend, trail: 34, trailColor: c.hi });
  return [
    runeCircle(st, { p: c.p0, size: u * 1.9, at: t0, full: t0 + 0.25, end: ti + 0.05, color: c.main, color2: c.hi, peak: 0.85, squash: 0.85 }),
    ...flight.parts,
    runeCircle(st, { p: c.p1, size: u * 2.3, at: ti - 0.06, full: ti + 0.16, end: ti + 0.75, color: c.main, color2: c.hi, spin: 0.12, peak: 0.9, squash: 0.85 }),
    pool(st, c.p1, { at: ti - 0.02, dur: 0.6, size: u * 3, color: hot(c.main, 0.3), peak: 0.9 }),
    sparks(st, c.p1, { at: ti, count: 30, speed: [80, 320], life: [0.4, 0.9], size: [4, 10], colors: [c.hi, c.main, c.deep], shape: "star", gravity: [0, 90], radius: u * 0.3 }),
    ...airCommon(c, 0.9),
  ];
}

function lightning(c: Ctx): FxPart[] {
  const { st, ti, t0, u, k } = c;
  const parts: FxPart[] = [];
  const reach = Math.hypot(c.p1.x - c.p0.x, c.p1.y - c.p0.y);
  const variants: Array<[number, number]> = [
    [ti - 0.08, 0.32],
    [ti - 0.02, 0.27],
  ];
  const a = jagged(c.p0, c.p1, 10, Math.max(14, reach * 0.09), st.rand);
  for (const [start, len] of variants) {
    const line = jagged(c.p0, c.p1, 10, Math.max(14, reach * 0.09), st.rand);
    parts.push(bolt(st, { pts: line, start, grow: 0.07, hold: start + len * 0.6, end: start + len, width: 5 * k, color: c.main, core: WHITE, flick: 1, bloom: 0.6 }));
  }
  parts.push(bolt(st, { pts: a, start: ti - 0.05, grow: 0.06, hold: ti + 0.15, end: ti + 0.6, width: 12 * k, color: c.deep, alpha: 0.35, flick: 0.3, bloom: 0.25 }));
  for (let i = 0; i < 3; i += 1) {
    const from = lerpP(c.p0, c.p1, 0.3 + i * 0.22);
    const away = { x: -c.dir.y * (st.rand() < 0.5 ? 1 : -1), y: c.dir.x * (st.rand() < 0.5 ? 1 : -1) };
    const to = { x: from.x + away.x * u * 0.7 + c.dir.x * u * 0.3, y: from.y + away.y * u * 0.7 + c.dir.y * u * 0.3 };
    parts.push(bolt(st, { pts: jagged(from, to, 5, 10, st.rand), start: ti - 0.05 + i * 0.02, grow: 0.06, hold: ti + 0.06, end: ti + 0.28, width: 2.4 * k, color: c.main, core: WHITE, flick: 1, bloom: 0.4 }));
  }
  parts.push(
    pool(st, c.p0, { at: t0 + (ti - t0) * 0.5, dur: 0.5, size: u * 1.4, color: c.main, peak: 0.55 }),
    sparks(st, c.p0, { at: ti - 0.08, count: 18, speed: [100, 380], life: [0.15, 0.4], size: [3, 6], colors: [c.hi, WHITE], shape: "star", radius: 6 }),
    pool(st, c.p1, { at: ti - 0.05, dur: 0.5, size: u * 3, color: hot(c.main, 0.5), peak: 0.95 }),
    sparks(st, c.p1, { at: ti - 0.04, count: 30, speed: [160, 600], life: [0.2, 0.55], size: [3, 8], colors: [c.hi, c.main, WHITE], shape: "star", gravity: [0, -500], radius: 4 }),
    ...airCommon(c, 1),
  );
  return parts;
}

function flame(c: Ctx, scale = 1, colorA?: Rgb, colorB?: Rgb): FxPart[] {
  const { st, ti, t0, u } = c;
  const a = colorA ?? hot(c.main, 0.15);
  const b = colorB ?? c.deep;
  const size = u * 0.5 * scale;
  const path = (kk: number): P => bezier(c.p0, lerpP(c.p0, c.p1, 0.5), c.p1, kk);
  return [
    fireball(st, { from: c.p0, to: c.p1, size, start: t0, travel: Math.max(0.1, ti - t0), end: ti + 0.12, color: a, color2: b, curve: u * 0.15 }),
    trail(c, path, { start: t0, travel: Math.max(0.1, ti - t0), n: 46, colors: [a, c.hi, b], size: [4, 10], life: [0.3, 0.6], gravity: [0, 80], spread: 30 }),
    pool(st, c.p0, { at: t0, dur: 0.28, size: u * 1.1, color: a, peak: 0.7 }),
    pool(st, c.p1, { at: ti - 0.03, dur: 0.6, size: u * 3.4 * scale, color: hot(a, 0.25), peak: 0.95 }),
    sparks(st, c.p1, { at: ti, count: 46, speed: [100, 460], life: [0.45, 1.0], size: [4, 11], colors: [a, c.hi, b], gravity: [0, 220], radius: u * 0.25 }),
    sparks(st, c.p1, { at: ti + 0.02, count: 16, speed: [30, 120], life: [0.7, 1.3], size: [16, 30], colors: [[0.12, 0.1, 0.1], [0.2, 0.15, 0.13]], kind: "solid", gravity: [0, 110], radius: u * 0.2 }),
    haze(st, { p: { x: c.p1.x, y: c.p1.y - u * 0.3 }, size: u * 2.4, at: ti, end: ti + 0.95, color: a, peak: 0.6 }),
    ...airCommon(c, 1.1),
  ];
}

function impact(c: Ctx): FxPart[] {
  const { st, ti, t0, u } = c;
  const from = { x: c.p0.x - c.dir.x * u * 0.1, y: c.p0.y - c.dir.y * u * 0.1 };
  const flight = orb(st, { from, to: c.p1, size: u * 0.5, start: t0, travel: Math.max(0.1, ti - t0), end: ti + 0.02, color: c.hi, trail: 26, trailColor: c.main, ease: "in" });
  return [
    ...flight.parts,
    pool(st, c.p1, { at: ti - 0.02, dur: 0.4, size: u * 3.2, color: hot(c.main, 0.5), peak: 1 }),
    sparks(st, c.p1, { at: ti, count: 26, speed: [140, 540], life: [0.5, 0.95], size: [5, 12], colors: [[0.32, 0.26, 0.2], [0.45, 0.36, 0.28], c.main], shape: "chunk", kind: "solid", gravity: [0, -1400], radius: 6 }),
    sparks(st, c.p1, { at: ti, count: 20, speed: [60, 300], life: [0.5, 1.0], size: [14, 26], colors: [[0.5, 0.45, 0.4], [0.38, 0.34, 0.3]], kind: "solid", gravity: [0, 60], radius: u * 0.35 }),
    sparks(st, c.p1, { at: ti, count: 20, speed: [200, 600], life: [0.2, 0.5], size: [3, 7], colors: [c.hi, WHITE], shape: "star", radius: 4 }),
    ...airCommon(c, 1.25),
  ];
}

/* ---------- signatures (on top of the style) ---------- */

function signature(c: Ctx): FxPart[] {
  const { st, ti, t0, u, k } = c;
  const view = st.view;
  switch (c.s.signature) {
    case SIG.BLUE_EYES: {
      const straight = [c.p0, c.p1];
      return [
        timedMesh(
          st,
          "sil",
          { p: { x: c.p0.x - c.dir.x * u * 0.5, y: c.p0.y - c.dir.y * u * 0.5 }, w: u * 3.6, h: u * 2.2, rot: -c.angle, at: t0, end: ti + 0.1, fadeIn: 0.08, fadeOut: 0.14, peak: 0.85 },
          (m) => {
            setColor(m.material.uniforms.uColor, [0.55, 0.8, 1]);
            setColor(m.material.uniforms.uCore, WHITE);
          },
          (m, sec) => {
            m.material.uniforms.uTime.value = sec;
            m.material.uniforms.uOpen.value = clamp01((sec - t0) / 0.25);
          },
        ),
        bolt(st, { pts: straight, start: ti - 0.2, grow: 0.18, hold: ti + 0.3, end: ti + 0.55, width: 30 * k, color: [0.75, 0.9, 1], core: WHITE, bloom: 0.8, alpha: 0.9 }),
        bolt(st, { pts: jagged(c.p0, c.p1, 11, 26, st.rand), start: ti - 0.16, grow: 0.16, hold: ti + 0.2, end: ti + 0.4, width: 5 * k, color: WHITE, core: WHITE, flick: 1, bloom: 0.5 }),
        pool(st, c.p1, { at: ti - 0.02, dur: 0.7, size: u * 4.2, color: [0.7, 0.88, 1], peak: 0.9 }),
      ];
    }
    case SIG.DARK_MAGICIAN:
      return [
        runeCircle(st, { p: c.p1, size: u * 3.6, at: ti - 0.18, full: ti + 0.2, end: ti + 0.95, color: [0.6, 0.25, 1], color2: [0.2, 0.05, 0.4], spin: 0.09, peak: 1, squash: 0.85, segs: 24 }),
        runeCircle(st, { p: c.p0, size: u * 2.4, at: t0, full: t0 + 0.3, end: ti, color: [0.6, 0.25, 1], color2: [0.9, 0.7, 1], peak: 0.9, squash: 0.85 }),
        pool(st, c.p1, { at: ti, dur: 0.6, size: u * 3.6, color: [0.5, 0.15, 0.9], peak: 0.8 }),
        ring(st, c.p1, { at: ti, dur: 0.6, from: u * 0.5, to: u * 3.4, color: [0.7, 0.4, 1], width: 0.07, peak: 0.85 }),
      ];
    case SIG.DARK_MAGICIAN_GIRL: {
      const pink: Rgb = [1, 0.45, 0.78];
      const trailPath = (kk: number): P => bezier(c.p0, lerpP(c.p0, c.p1, 0.5), c.p1, kk);
      return [
        trail(c, trailPath, { start: t0 + (ti - t0) * 0.4, travel: (ti - t0) * 0.6, n: 40, colors: [pink, WHITE], size: [8, 15], life: [0.4, 0.7], shape: "star", gravity: [0, 20] }),
        sparks(st, c.p1, { at: ti, count: 60, speed: [120, 560], life: [0.4, 0.95], size: [8, 18], colors: [pink, WHITE, [1, 0.7, 0.9]], shape: "star", gravity: [0, -160], radius: 6 }),
        bolt(st, { pts: [{ x: c.p1.x - u * 1.2, y: c.p1.y }, { x: c.p1.x + u * 1.2, y: c.p1.y }], start: ti - 0.02, grow: 0.08, hold: ti + 0.12, end: ti + 0.4, width: 6 * k, color: pink, core: WHITE, taper: 1, bloom: 0.6 }),
        bolt(st, { pts: [{ x: c.p1.x, y: c.p1.y - u * 1.1 }, { x: c.p1.x, y: c.p1.y + u * 1.1 }], start: ti - 0.02, grow: 0.08, hold: ti + 0.12, end: ti + 0.4, width: 6 * k, color: pink, core: WHITE, taper: 1, bloom: 0.6 }),
        pool(st, c.p1, { at: ti - 0.02, dur: 0.6, size: u * 3.4, color: pink, peak: 0.9 }),
      ];
    }
    case SIG.RED_EYES:
      return [
        ...flame(c, 1.5, [1, 0.45, 0.1], [0.8, 0.05, 0.02]),
        sparks(st, c.p1, { at: ti, count: 40, speed: [80, 360], life: [0.7, 1.4], size: [3, 7], colors: [[1, 0.6, 0.2], [1, 0.3, 0.05]], gravity: [0, 260], radius: u * 0.4 }),
        pool(st, c.p1, { at: ti - 0.02, dur: 0.8, size: u * 4.6, color: [1, 0.3, 0.05], peak: 0.85 }),
      ];
    case SIG.CYBER_DRAGON: {
      const cy: Rgb = [0.55, 0.95, 1];
      const ghosts: FxPart[] = [];
      [0.22, 0.4, 0.62, 0.8].forEach((f, i) => {
        ghosts.push(pool(st, lerpP(c.p0, c.p1, f), { at: ti - 0.06, dur: 0.36, size: u * (0.6 + 0.4 * (i % 2)), color: i % 2 ? cy : [1, 0.8, 0.5], peak: 0.55 }));
      });
      return [
        bolt(st, { pts: [c.p0, c.p1], start: ti - 0.2, grow: 0.14, hold: ti + 0.3, end: ti + 0.5, width: 12 * k, color: cy, core: WHITE, bloom: 0.9 }),
        bolt(st, { pts: [{ x: c.p1.x - u * 2.6, y: c.p1.y }, { x: c.p1.x + u * 2.6, y: c.p1.y }], start: ti - 0.03, grow: 0.06, hold: ti + 0.14, end: ti + 0.45, width: 5 * k, color: cy, core: WHITE, taper: 1, bloom: 0.8, alpha: 0.9 }),
        ...ghosts,
        pool(st, c.p1, { at: ti - 0.04, dur: 0.6, size: u * 3.8, color: cy, peak: 0.9 }),
      ];
    }
    case SIG.SUMMONED_SKULL: {
      const purple: Rgb = [0.7, 0.35, 1];
      const parts: FxPart[] = [pool(st, { x: view.w / 2, y: view.h / 2 }, { at: ti - 0.12, dur: 0.5, size: Math.max(view.w, view.h) * 1.5, color: [0.35, 0.12, 0.6], peak: 0.4 })];
      const xs = [-0.9, 0.1, 0.8];
      xs.forEach((f, i) => {
        const top = { x: c.p1.x + f * u * 1.4, y: -20 };
        const start = ti - 0.14 + i * 0.05;
        parts.push(bolt(st, { pts: jagged(top, c.p1, 10, 34, st.rand), start, grow: 0.09, hold: start + 0.12, end: start + 0.34, width: 6 * k, color: purple, core: WHITE, flick: 1, bloom: 0.7 }));
        parts.push(pool(st, c.p1, { at: start + 0.08, dur: 0.3, size: u * 2.4, color: purple, peak: 0.6 }));
      });
      return parts;
    }
    default:
      return [];
  }
}

function air(c: Ctx): FxPart[] {
  const parts = (() => {
    switch (c.s.style) {
      case "slash":
        return slash(c);
      case "claw":
        return claw(c);
      case "beam":
        return beam(c);
      case "arcane":
        return arcane(c);
      case "lightning":
        return lightning(c);
      case "flame":
        return flame(c);
      case "impact":
        return impact(c);
    }
  })();
  return [...parts, ...signature(c)];
}

/** Every part of one fight, for tests and the effect. */
export const battleEffect: FxFactory = (env, request) => {
  const battle = request.battle;
  const st = new Stage(env, request, 3);
  if (!battle) return compose(st.rig, [], 1);
  const ctxs = battle.strikes.map((s) => context(st, s));
  const parts: FxPart[] = [];
  for (const c of ctxs) parts.push(...ground(c));
  battle.breaks.forEach((b, i) => {
    parts.push(
      ...cardBreak(st, {
        rect: b.rect,
        code: b.code,
        defense: b.defense,
        turned: b.turned,
        at: b.atMs / 1000,
        dir: b.dir,
        cut: cutOf(b.style as FxAttackStyle),
        tint: b.tint,
        seed: (request.seed ?? 1) * 31 + i,
        detail: env.quality < 0.8 ? 0.7 : 1,
        flare: true,
        glow: b.tint.accent,
      }),
    );
  });
  for (const c of ctxs) parts.push(...air(c));
  return compose(st.rig, parts, battle.totalMs);
};
