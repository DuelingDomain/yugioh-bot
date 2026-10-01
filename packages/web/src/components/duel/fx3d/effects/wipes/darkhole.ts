import * as THREE from "three";
import { bump, CH, CW, clamp, decay, easeIn3, easeOut3, lerp, ramp, timeWarp, type Color3, type WipeBuild } from "./common";

/**
 * Dark Hole (piece dark-hole): a black hole opens, time freezes, every monster is sucked in.
 * Port of sceneDarkHole (.fx-demo/js/scenes.js). All numbers are the demo numbers.
 *
 * Differences from the demo (by the contract of the app):
 *  - The source card is a DOM card. It is not lifted or hidden. The aura and the slam ring are drawn on its zone.
 *  - Victim times come from the plan (take, gone, land, end). Break time `s` of a card is read back from `take`.
 *  - The cards land from the hole (the core) to the owner pile, as in the demo.
 */

const TAU = Math.PI * 2;
const COL: Color3 = [0.66, 0.32, 1];
/** Distance of a demo screen corner from the origin: full-screen things are scaled by (corner / this). */
const DEMO_CORNER = Math.hypot(560, 400);

export const buildDarkHole: WipeBuild = (ctx) => {
  const P = ctx.post;
  const r = ctx.rand;
  const tex = ctx.tex;
  const S = ctx.source;
  const TF = 1.55;
  const TW = timeWarp(TF, 0.22, 0.04);
  const b = ctx.bounds;
  const cxm = (b.minX + b.maxX) / 2;
  const cym = (b.minY + b.maxY) / 2;
  const hx = (b.maxX - b.minX) / 2;
  const hy = (b.maxY - b.minY) / 2;
  const corner = Math.max(Math.hypot(b.minX, b.minY), Math.hypot(b.minX, b.maxY), Math.hypot(b.maxX, b.minY), Math.hypot(b.maxX, b.maxY));
  const sc = Math.max(1, corner / DEMO_CORNER);
  const areaK = Math.min(2.5, Math.max(0.4, (hx * hy) / (560 * 400)));
  const [coreU, coreV] = ctx.uv(0, 0);

  // card zones (outlines of the frames shards come from)
  const zonePool = ctx.zones.length ? ctx.zones : ctx.victims.length ? ctx.victims.map((v) => ({ x: v.x, y: v.y })) : [{ x: 0, y: 0 }];
  const onZoneOutline = (): [number, number] => {
    const z = zonePool[Math.floor(r() * zonePool.length)];
    const k = r() * 4;
    const u = r() - 0.5;
    if (k < 1) return [z.x + u * CW, z.y + CH / 2];
    if (k < 2) return [z.x + u * CW, z.y - CH / 2];
    if (k < 3) return [z.x - CW / 2, z.y + u * CH];
    return [z.x + CW / 2, z.y + u * CH];
  };

  const seed = ctx.sprite(tex.soft, [0.55, 0.2, 1]);
  const flash = ctx.sprite(tex.soft, [0.92, 0.82, 1]);
  const blast = ctx.sprite(tex.ring, [0.85, 0.7, 1]);
  const rings = [0, 1, 2, 3].map(() => ctx.sprite(tex.ring, [0.7, 0.4, 1]));
  // the source: an aura and a slam ring on its zone (the card itself is the page's)
  const aura = S ? ctx.sprite(tex.soft, COL) : null;
  const slamRing = S ? ctx.sprite(tex.ring, COL) : null;

  // 1. board dust and zone-frame shards spiral in
  const dust = ctx.particles(
    ctx.count(Math.round(1100 * areaK)),
    () => {
      const st = r() < 0.5;
      const k = r();
      return {
        p: [cxm + (r() * 2 - 1) * hx * (545 / 560), cym + (r() * 2 - 1) * hy * (392 / 400)],
        delay: 0.5 + r() * 0.7,
        life: 0.75 + r() * 0.6,
        size: st ? 12 + r() * 12 : 3 + r() * 5,
        spin: 2 + r() * 3,
        stretch: st ? 1 : 0,
        shape: st ? 1 : 0,
        col: k < 0.4 ? [0.78, 0.55, 1, 0.9] : k < 0.75 ? [1, 0.92, 1, 0.8] : [0.5, 0.22, 0.95, 0.95],
      };
    },
    { mode: 1, P: [0, 0, 0.35, 0.12] },
  );
  const frames = ctx.particles(
    ctx.count(120),
    () => {
      const p = onZoneOutline();
      return { p, delay: 0.55 + r() * 0.6, life: 0.8 + r() * 0.55, size: 16 + r() * 18, rot: r() * 6, spin: 2 + r() * 3, shape: 1, col: [0.95, 0.85, 0.55, 0.65] };
    },
    { mode: 1, P: [0, 0, 0.3, 0.12] },
  );
  // 2. collapse: dark smoke, embers, outward sweep
  const smoke = ctx.particles(
    ctx.count(80),
    () => {
      const a = r() * TAU;
      const d = r() * 160;
      const sp = 70 + r() * 220;
      return { p: [Math.cos(a) * d, Math.sin(a) * d * 0.7], v: [Math.cos(a) * sp, Math.sin(a) * sp * 0.6], delay: 2.22 + r() * 0.3, life: 1.0 + r() * 0.7, size: 60 + r() * 90, col: [0.07, 0.02, 0.15, 0.6] };
    },
    { drag: 2.2, normal: true, order: 100, P: [0, 0, 1, 0.2] },
  );
  const embers = ctx.particles(
    ctx.count(150),
    () => {
      const a = r() * TAU;
      const d = r() * 260;
      const sp = 140 + r() * 460;
      return {
        p: [Math.cos(a) * d, Math.sin(a) * d * 0.7],
        v: [Math.cos(a) * sp, Math.sin(a) * sp * 0.7],
        delay: 2.25 + r() * 0.25,
        life: 0.8 + r() * 0.8,
        size: 3 + r() * 4,
        stretch: 0.5,
        shape: 0,
        col: r() < 0.5 ? [0.8, 0.55, 1, 1] : [1, 0.9, 1, 1],
      };
    },
    { drag: 1.8, P: [0, 0, 1, 0.1] },
  );
  const sweep = ctx.particles(
    ctx.count(160),
    () => {
      const a = r() * TAU;
      const sp = (900 + r() * 900) * sc;
      return { p: [Math.cos(a) * 30, Math.sin(a) * 30], v: [Math.cos(a) * sp, Math.sin(a) * sp * 0.75], delay: 2.25 + r() * 0.08, life: 0.45 + r() * 0.35, size: 20 + r() * 34, stretch: 0.5, shape: 1, col: [0.85, 0.7, 1, 0.85] };
    },
    { drag: 2.6, P: [0, 0, 1, 0.05] },
  );

  // The smoke and the embers of the demo are still alive at the end of the piece. Fade them out over the last
  // 0.45 s so nothing is left on the canvas when the piece ends (before that the look is the demo's).
  const tailFade = { value: 1 };
  for (const p of [smoke, embers]) {
    const mat = p.mesh.material as THREE.ShaderMaterial;
    mat.uniforms.uFade = tailFade;
    mat.onBeforeCompile = (shader) => {
      shader.fragmentShader = "uniform float uFade;\n" + shader.fragmentShader.replace("gl_FragColor = vec4(col, a*vCol.a);", "gl_FragColor = vec4(col, a*vCol.a*uFade);");
    };
    mat.customProgramCacheKey = () => "dark-hole-tail-fade";
  }

  // victims: the break time s (world time) is read back from the plan (take = inv(s - 0.4))
  const info = ctx.victims.map((v) => {
    const s = TW.fwd(v.take) + 0.4;
    return { v, s, dur: 0.95 };
  });

  // The landing streaks leave from the hole. The pile pulse is drawn here (not by the landing) so it can fade with the tail.
  const landing = ctx.landing({ from: () => ({ x: 0, y: 0 }), pulse: false });
  const pulses = ctx.victims.filter((v) => v.pile).map((v) => ({ v, sprite: ctx.sprite(tex.ring, COL) }));

  const shakes = [
    { t: 0.5, dur: 0.3, amp: 5, kind: "decay" as const },
    { t: TW.inv(0.7), dur: TW.inv(1.95) - TW.inv(0.7), amp: 3.5, kind: "swell" as const, freq: 30 },
    { t: TF, dur: 0.22, amp: 2, kind: "swell" as const, freq: 90 },
    { t: TW.inv(1.95), dur: 0.32, amp: 6, kind: "swell" as const, freq: 50 },
    { t: TW.inv(2.25), dur: 0.75, amp: 20, kind: "decay" as const, freq: 34 },
  ];

  return {
    shakes,
    update(t) {
      const te = TW.fwd(t);

      // the source card: aura and slam ring (the demo also lifted the card and slammed it at 0.5 s)
      if (S && aura && slamRing) {
        const tS = 0.5;
        const lift = easeOut3(ramp(t, 0, 0.22));
        const slam = easeIn3(ramp(t, tS, tS + 0.09));
        const up = lift * (1 - slam);
        aura.color(COL);
        aura.set(S.x, S.y, 330 * (0.5 + up), 0.75 * up + 0.35 * ramp(t, tS, tS + 0.1) * (1 - ramp(t, tS + 0.1, tS + 0.7)));
        slamRing.color(COL);
        const rr = ramp(t, tS + 0.04, tS + 0.5);
        slamRing.set(S.x, S.y, 90 + 380 * easeOut3(rr), rr > 0 ? (1 - rr) * 0.9 : 0);
      }

      const open = easeOut3(ramp(te, 0.42, 1.3));
      const col = ramp(te, 1.95, 2.25);
      const live = open * (1 - col);
      const pre = ramp(te, 1.5, 1.95);
      const calm = 1 - ramp(te, 2.2, 3.0);
      const hole = (140 + 100 * pre) * open * (1 - Math.pow(col, 3)) * (1 + 0.05 * Math.sin(te * 42) * pre);
      P.uCore.value.set(coreU, coreV);
      P.uHole.value.set(hole / 800, live * (0.95 + 1.2 * pre) + 2.2 * bump(te, 2.2, 2.32), 1, 0);
      P.uLens.value.set(0.8 * Math.pow(open, 0.6), 0.3 * live + 0.6 * pre * live, (0.7 + 1.1 * ramp(te, 1.0, 1.9)) * live, 0.7 * live);
      P.uDarken.value = 0.46 * open * calm;
      P.uTint.value.setRGB(0.7, 0.5, 1);
      P.uTintAmt.value = 0.6 * open * calm;
      P.uVig.value = 0.25 + 0.45 * open * calm;
      const frz = t >= TF && t < TF + TW.fd ? 1 : 0;
      P.uAberr.value = 0.3 * open * (1 - col) + 0.6 * frz + 1.3 * decay(te, 2.25, 0.18) * (te >= 2.25 ? 1 : 0);
      P.uInvert.value = frz ? 0.8 * Math.exp(-(t - TF) / 0.035) : 0;
      P.uFlash.value.set(0.88, 0.76, 1, (te >= 2.25 ? 0.7 * Math.pow(1 - ramp(te, 2.25, 2.55), 2) : 0) + 0.12 * frz);
      if (te >= 2.25) {
        const k = ramp(te, 2.25, 3.0);
        P.uShock.value.set(coreU, coreV, 1.05 * sc * easeOut3(k), lerp(0.06, 0.14, k));
        P.uShock2.value.set(0.05 * (1 - k), 1.3 * (1 - k), 0);
        P.uShockCol.value.setRGB(0.7, 0.5, 1);
      }

      seed.set(0, 0, 120 + 640 * open, 0.55 * live + 0.25 * pre * live);
      rings.forEach((rg, i) => {
        const ph = (te * 1.15 + i / 4) % 1;
        rg.set(0, 0, lerp(980, 170, ph), Math.sin(ph * Math.PI) * 0.34 * live);
      });
      flash.set(0, 0, 1500 * sc, te >= 2.25 ? 0.6 * Math.pow(1 - ramp(te, 2.25, 2.5), 2) : 0);
      blast.set(0, 0, 80 + 1900 * sc * easeOut3(ramp(te, 2.25, 2.95)), te >= 2.25 ? 0.7 * (1 - ramp(te, 2.35, 2.95)) : 0);
      tailFade.value = 1 - ramp(t, ctx.duration - 0.45, ctx.duration);
      for (const s of [dust, frames, smoke, embers, sweep]) s.setT(te);

      for (const o of info) {
        const k = o.v.card;
        const u = (te - o.s) / o.dur;
        const pr = ramp(te, o.s - 0.4, o.s);
        if (u >= 1) {
          k.mesh.visible = false;
          continue;
        }
        const tr = pr * (u > 0 ? 0.3 : 1);
        k.pose(o.v.x + Math.sin(te * 70 + o.v.i * 2) * 2.4 * tr, o.v.y + Math.cos(te * 63 + o.v.i) * 2 * tr, 1 + 0.07 * pr);
        k.u.uSuck.value = clamp(u);
        k.u.uSwirl.value = 1;
        k.u.uCore.value.set(0, 0);
        k.u.uRim.value.setRGB(0.7, 0.35, 1);
        k.u.uRimAmt.value = pr * 0.9;
        k.u.uHeatCol.value.setRGB(0.62, 0.3, 1);
        k.mesh.renderOrder = 20 + Math.floor(u * 10);
      }

      landing.update(t, { alpha: 0.5, col: COL });
      for (const { v, sprite } of pulses) {
        const pk = 1 - (t - v.end) / 0.5;
        const pile = v.pile;
        if (pile) sprite.set(pile.x, pile.y, pk > 0 && pk < 1 ? 70 + 240 * (1 - pk) : 0, pk > 0 ? pk * 0.7 * tailFade.value : 0);
      }
    },
  };
};
