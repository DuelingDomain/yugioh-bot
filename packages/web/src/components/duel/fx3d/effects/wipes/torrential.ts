import * as THREE from "three";
import {
  CH,
  CW,
  GLSL_COMMON,
  WORLD_GLSL,
  clamp,
  decay,
  easeInOut,
  easeIn2,
  easeIn3,
  easeOut3,
  forkedBolt,
  hash1,
  lerp,
  ramp,
  type Color3,
  type ParticleSpec,
  type Pt,
  type ShakeImpulse,
  type WipeBuild,
  type WipeCtx,
  type WipeParticles,
} from "./common";

/**
 * Torrential Tribute (piece torrential): a flood destroys every monster on the field.
 * Port of .fx-demo/js/scenes.js `sceneTorrential` (makeGeyser, makeSurge).
 *
 * Timeline (s): cast + seep 0-0.78, burst 0.78, surge 0.94, each card tears about 0.36 after its jet,
 * drain 1.8-2.6, landing from 2.0. The page keeps a card whole until `take`; the canvas draws it from
 * there and it is gone at `gone` (= its jet + 1.51). Nothing here reads the DOM or a clock.
 */

/* ---------- the water column: one shader quad ---------- */

const GEY_VS = `varying vec2 vL; void main(){ vL=position.xy; gl_Position=projectionMatrix*viewMatrix*modelMatrix*vec4(position,1.); }`;
const GEY_FS =
  GLSL_COMMON +
  `
uniform float uT, uH, uWid, uInt, uHalf, uSeed, uStat, uMul;
varying vec2 vL;
void main(){
  float y = vL.y, x = vL.x, live = 1.-uStat, tt = uT*live + uSeed;
  float s = clamp(y/max(uH,1.),0.,1.);
  float sway = (vnoise(vec2(y*.006, tt*3.))-.5)*16.*s*live;
  float dx = x - sway, sd = dx < 0. ? -1. : 1.;
  float hw = uHalf*uWid*(.88 + .4*smoothstep(.35,1.,s) + .35*pow(1.-smoothstep(0.,.12,s),2.));
  float wob = (fbm(vec2(y*.018 - tt*11. + sd*4.3, tt*.7 + sd)) - .5)*.8;
  float h = max(hw*(1.+wob), 1.);
  float nd = abs(dx)/h;
  float turb = fbm(vec2(dx*.05, y*.012 - tt*14.));
  float core = 1. - smoothstep(0., .55, nd + (turb-.5)*.55);
  float body = 1. - smoothstep(.8, 1., nd);
  float tip = 1. - smoothstep(uH - 70., uH + 10., y + (fbm(vec2(dx*.04, y*.03 - tt*6.)) - .5)*90.);
  float base = smoothstep(-8., 6., y);
  vec3 deep = vec3(.02,.34,.55), mid = vec3(.1,.74,.9), lit = vec3(.6,.96,1.);
  vec3 c = mix(deep, mid, 1.-smoothstep(.4,1.,nd));
  c = mix(c, lit, (1.-smoothstep(.15,.7,nd))*(.55+.7*turb));
  c = mix(c, vec3(1.), clamp(core*(.7+.5*turb),0.,1.)*.95);
  float spk = vnoise(vec2(dx*.12, y*.06 - tt*18.));
  c += vec3(.85,.97,1.)*smoothstep(.65,.95,nd)*spk*body*.9;
  c += vec3(.8,.95,1.)*exp(-max(y,0.)/55.)*.7;
  float a = body*tip*base*(.62 + .38*core);
  gl_FragColor = vec4(c, clamp(a*uInt*uMul, 0., 1.));
}`;

type Geyser = {
  mesh: THREE.Mesh;
  u: Record<string, THREE.IUniform<number>>;
  dispose(): void;
};

function makeGeyser(gw: number, order: number, mul: number, half: number, seed: number): Geyser {
  const gh = 760;
  const geo = new THREE.PlaneGeometry(gw, gh);
  geo.translate(0, gh / 2 - 60, 0);
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uT: { value: 0 },
      uH: { value: 1 },
      uWid: { value: 1 },
      uInt: { value: 0 },
      uHalf: { value: half },
      uSeed: { value: seed },
      uStat: { value: 0 },
      uMul: { value: mul },
    },
    vertexShader: GEY_VS,
    fragmentShader: GEY_FS,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = order;
  mesh.frustumCulled = false;
  mesh.visible = false;
  return {
    mesh,
    u: mat.uniforms as Geyser["u"],
    dispose() {
      geo.dispose();
      mat.dispose();
    },
  };
}

const setGeyser = (layers: Geyser[], p: { t: number; h: number; wid: number; int: number }): void => {
  for (const q of layers) {
    const u = q.u;
    u.uT.value = p.t;
    u.uH.value = p.h;
    u.uWid.value = p.wid;
    u.uInt.value = p.int;
    u.uStat.value = 0;
    q.mesh.visible = p.int > 0.004 && p.h > 2 && p.wid > 0.02;
  }
};

/* ---------- the tidal surge: a flood from the centre with a foam front, caustics, then puddles ---------- */

const SURGE_VS =
  WORLD_GLSL +
  `varying vec2 vW; void main(){ vW=toWorld((modelMatrix*vec4(position,1.)).xy); gl_Position=projectionMatrix*viewMatrix*modelMatrix*vec4(position,1.); }`;
const SURGE_FS =
  GLSL_COMMON +
  `
uniform float uT, uFront, uLvl, uInt, uAsp; varying vec2 vW;
void main(){
  vec2 d = vW; d.y *= uAsp;
  float r = length(d), ang = atan(d.y, d.x);
  float rag = (fbm(vec2(ang*3. + uT*.5, r*.004)) - .5)*110. + (vnoise(vec2(ang*13., uT*7.)) - .5)*34.;
  float fr = uFront + rag;
  float inside = 1. - smoothstep(fr - 10., fr + 12., r);
  vec2 pq = vW*vec2(.0045,.0055) + vec2(1.7,3.1);
  float n = .6*vnoise(pq) + .4*vnoise(pq*2.3 + 7.1);
  float depth = uLvl + (n - .5)*1.35;
  float wm = smoothstep(.36, .5, depth);
  float rim = exp(-pow((depth - .43)/.035, 2.));
  float cn = fbm(vW*.02 + vec2(uT*.45, -uT*.32));
  float caus = pow(1. - abs(2.*cn - 1.), 7.);
  float flow = fbm(vec2(r*.011 - uT*4.2, ang*5.));
  vec3 deep = vec3(.02,.3,.46), lit = vec3(.2,.78,.95);
  float flooded = smoothstep(.55, 1., uLvl), standing = 1. - flooded;
  vec3 flood = mix(deep, lit, .3 + .4*flow) + vec3(.6,.92,1.)*caus*.16;
  float spec = pow(vnoise(vec2(vW.x*.018, vW.y*.11 + uT*.15)), 9.);
  vec3 pud = vec3(.05,.2,.32) + vec3(.1,.2,.3)*smoothstep(-250., 350., vW.y) + vec3(.7,.92,1.)*spec*.9;
  vec3 col = mix(pud, flood, flooded);
  float foamBand = smoothstep(fr - 110., fr - 6., r)*(1. - smoothstep(fr - 6., fr + 12., r));
  float foam = clamp(foamBand*(.5 + 1.1*vnoise(vW*.045 + vec2(uT*3., -uT*2.))), 0., 1.);
  col = mix(col, vec3(.95,1.,1.), foam);
  col += vec3(.7,.95,1.)*rim*standing*.55;
  float a = wm*inside*mix(.62, .26 + .12*caus + .1*flow, flooded) + foam*.9 + rim*inside*.3*standing;
  gl_FragColor = vec4(col, clamp(a*uInt, 0., 1.));
}`;

function makeSurge(ctx: WipeCtx) {
  const b = ctx.bounds;
  const geo = new THREE.PlaneGeometry(b.maxX - b.minX, b.maxY - b.minY);
  const mat = new THREE.ShaderMaterial({
    uniforms: { uWorld: ctx.world, uT: { value: 0 }, uFront: { value: 0 }, uLvl: { value: 1 }, uInt: { value: 0 }, uAsp: { value: 1.35 } },
    vertexShader: SURGE_VS,
    fragmentShader: SURGE_FS,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2, 0);
  mesh.renderOrder = 116;
  mesh.frustumCulled = false;
  mesh.visible = false;
  ctx.addMesh(mesh, () => {
    geo.dispose();
    mat.dispose();
  });
  return {
    set(t: number, front: number, lvl: number, int: number): void {
      const u = mat.uniforms;
      u.uT.value = t;
      u.uFront.value = front;
      u.uLvl.value = lvl;
      u.uInt.value = int;
      mesh.visible = int > 0.004 && front > 1;
    },
  };
}

/* ---------- the scene ---------- */

type Jet = { kind: "center" | "mon" | "empty"; x: number; y0: number; hw: number; t0: number; v: number | null };

/** Cell centres of a row of zones (world units). */
function rowCentres(row: { minX: number; maxX: number; minY: number; maxY: number }): Pt[] {
  const n = Math.max(1, Math.min(7, Math.round((row.maxX - row.minX) / (CW * 1.19))));
  const step = (row.maxX - row.minX) / n;
  const y = (row.minY + row.maxY) / 2;
  const out: Pt[] = [];
  for (let i = 0; i < n; i += 1) out.push({ x: row.minX + step * (i + 0.5), y });
  return out;
}

/** The demo board's five columns, for a row the page did not give. */
const demoRow = (y: number): Pt[] => [0, 1, 2, 3, 4].map((i) => ({ x: -342 + 114 * (i + 1), y }));

export const buildTorrential: WipeBuild = (ctx) => {
  const P = ctx.post;
  const r = ctx.rand;
  const tex = ctx.tex;
  const COL: Color3 = [0.12, 0.5, 1];
  const TAU = Math.PI * 2;
  const Tb = 0.78;
  const Ts = Tb + 0.16;
  const T0 = 2.0;
  const D = ctx.duration;
  const S: Pt | null = ctx.source;
  const SP: Pt = S ?? { x: 0, y: 0 };
  const vs = ctx.victims;
  const N = vs.length;

  const mkP = (n: number, gen: (i: number) => ParticleSpec, o: Parameters<WipeCtx["particles"]>[2]): Pick<WipeParticles, "setT"> =>
    n > 0 ? ctx.particles(n, gen, o) : { setT() {} };
  const fan = (list: Jet[], per: (g: Jet) => number): number[] => {
    const m: number[] = [];
    list.forEach((g, gi) => {
      const k = Math.round(per(g) * Math.min(1, ctx.count(100) / 100));
      for (let q = 0; q < k; q += 1) m.push(gi);
    });
    return m;
  };

  // the monster zones (occupied or not): one jet each, plus the central torrent
  const zones: Pt[] = [];
  const rowFor = (side: "you" | "opp"): Pt[] => {
    const m = ctx.rows[side].m;
    return m ? rowCentres(m) : demoRow(side === "opp" ? 158 : -158);
  };
  zones.push(...rowFor("opp"), ...rowFor("you"));

  // every victim stands over its own jet; its eruption time comes from the plan (gone = jet + 0.36 + 1.15)
  const claimed = new Set<number>();
  const extra: Array<{ x: number; y: number; v: number }> = [];
  const vJet: number[] = [];
  vs.forEach((v, i) => {
    let best = -1;
    let bd = 100;
    zones.forEach((z, zi) => {
      if (claimed.has(zi)) return;
      const d = Math.hypot(z.x - v.x, z.y - v.y);
      if (d < bd) {
        bd = d;
        best = zi;
      }
    });
    if (best >= 0) {
      claimed.add(best);
      vJet[i] = best;
    } else {
      extra.push({ x: v.x, y: v.y, v: i });
      vJet[i] = zones.length + extra.length - 1;
    }
  });
  const jetAt = (x: number, y: number): number => Tb + 0.015 + 0.09 * clamp(Math.hypot(x - SP.x, y - SP.y) / 760);
  const gs: Jet[] = [{ kind: "center", x: 0, y0: -30, hw: 78, t0: Tb, v: null }];
  zones.forEach((z, zi) => {
    const vi = vJet.indexOf(zi);
    gs.push({ kind: vi >= 0 ? "mon" : "empty", x: z.x, y0: z.y - CH / 2 - 8, hw: 44, t0: vi >= 0 ? vs[vi].gone - 1.51 : jetAt(z.x, z.y), v: vi >= 0 ? vi : null });
  });
  extra.forEach((e) => gs.push({ kind: "mon", x: e.x, y0: e.y - vs[e.v].card.h / 2 - 8, hw: 44, t0: vs[e.v].gone - 1.51, v: e.v }));
  const info = vs.map((v, i) => {
    const g = gs.find((q) => q.v === i) as Jet;
    const side = v.pile && Math.abs(v.pile.x - v.x) > 1 ? Math.sign(v.pile.x - v.x) : v.side === "you" ? 1 : -1;
    return { v, i, g, dir: side, sp: hash1(i * 3.7 + 1) > 0.5 ? 1 : -1, tg: g.t0, tb: g.t0 + 0.36 };
  });

  // the streaks land in the pile; the arrival ring is drawn here so that it fades out with the piece
  const landing = ctx.landing({ pulse: false });
  const pulses = vs.filter((v) => v.pile != null).map((v) => ({ v, s: ctx.sprite(tex.ring, [0.4, 0.8, 1]) }));

  // water columns (back layer behind the card, thin front layer over it) and the flood
  let gseed = 0;
  const gey = gs
    .filter((g) => g.kind !== "empty")
    .map((g) => {
      const big = g.kind === "center";
      const gw = big ? 520 : 300;
      const back = ctx.add(makeGeyser(gw, 108, 1, g.hw, 3 + (gseed++ % 7) * 5.3));
      const front = ctx.add(makeGeyser(gw, 118, 0.36, g.hw, 3 + (gseed++ % 7) * 5.3));
      back.u.uSeed.value = front.u.uSeed.value;
      back.mesh.position.set(g.x, g.y0, 0);
      front.mesh.position.set(g.x, g.y0, 0);
      return { g, back, front };
    });
  const surge = makeSurge(ctx);
  const bigflash = ctx.sprite(tex.soft, [0.8, 0.95, 1]);
  const baseRing = gs.map(() => ctx.sprite(tex.ring, [0.6, 0.92, 1]));
  const aura = ctx.sprite(tex.soft, COL);
  const slam = ctx.sprite(tex.ring, COL);

  // cast: dark water seeping under the zones and the source, glowing cracks, trembling beads
  const seepAt: Array<{ x: number; y: number; tg: number }> = gs
    .filter((g) => g.kind !== "center")
    .map((g) => ({ x: g.x, y: g.y0 + CH / 2 + 8, tg: g.t0 }));
  if (S) seepAt.push({ x: S.x, y: S.y, tg: Tb });
  const seeps = seepAt.map((z, i) => ({
    ...z,
    s0: 0.1 + hash1(i * 4.3) * 0.25,
    ph: i * 1.3,
    pool: ctx.sprite(tex.soft, [0.02, 0.17, 0.27], { normal: true, order: 8 }),
    glow: ctx.sprite(tex.soft, [0.1, 0.45, 0.9], { order: 9 }),
  }));
  const cracks: Array<{ b: ReturnType<WipeCtx["bolt"]>; t0: number; tg: number }> = [];
  [...seeps, { x: 0, y: 0, s0: 0.2, tg: Tb }].forEach((z, zi) => {
    for (let k = 0; k < (zi === seeps.length ? 3 : 2); k += 1) {
      const x0 = z.x + (r() - 0.5) * CW * 0.7;
      const y0 = z.y - CH * 0.3 + (r() - 0.5) * 30;
      const a = r() * TAU;
      const len = 60 + r() * 90;
      const b = ctx.bolt(forkedBolt({ x: x0, y: y0 }, { x: x0 + Math.cos(a) * len, y: y0 + Math.sin(a) * len * 0.7 }, r, { seg: 8, amp: 12, forks: 0 }), 0.7, COL, [0.8, 0.97, 1]);
      b.mesh.renderOrder = 9;
      cracks.push({ b, t0: z.s0 + k * 0.08 + r() * 0.1, tg: z.tg });
    }
  });
  const beads = mkP(
    ctx.count(170),
    () => {
      const z = seeps[Math.floor(r() * seeps.length)] ?? { x: 0, y: 0 };
      const d = 0.14 + r() * 0.45;
      return { p: [z.x + (r() - 0.5) * CW * 1.1, z.y + (r() - 0.5) * CH * 0.9], v: [0, 6 + r() * 20], delay: d, life: 0.3 + r() * 0.35 + (Tb - d) * 0.4, size: 4 + r() * 6, seed: r(), shape: 0, col: [0.6, 0.92, 1, 1] };
    },
    { mode: 2, P: [3.5, 64, 0.5, 0.15], order: 126 },
  );

  // burst: spray, foam, mist, falling droplets from every jet
  const nS = fan(gs, (g) => (g.kind === "center" ? 130 : g.kind === "mon" ? 60 : 22));
  const spray = mkP(
    nS.length,
    (i) => {
      const g = gs[nS[i]];
      const big = g.kind === "center";
      const k = g.kind === "empty" ? 0.45 : 1;
      return {
        p: [g.x + (r() - 0.5) * g.hw * 1.2, g.y0 + r() * 40],
        v: [(r() - 0.5) * (big ? 560 : 360), ((big ? 700 : 520) + r() * (big ? 900 : 700)) * k],
        delay: g.t0 + r() * 0.14,
        life: 0.55 + r() * 0.5,
        size: 5 + r() * 8,
        stretch: 0.55,
        shape: 1,
        col: r() < 0.5 ? [0.8, 0.95, 1, 1] : [0.5, 0.88, 1, 1],
      };
    },
    { drag: 0.7, G: [0, -1500], P: [0, 0, 1, 0.04], order: 126 },
  );
  const nF = fan(gs, (g) => (g.kind === "center" ? 26 : g.kind === "mon" ? 14 : 6));
  const foam = mkP(
    nF.length,
    (i) => {
      const g = gs[nF[i]];
      return { p: [g.x + (r() - 0.5) * g.hw, g.y0 + 20 + r() * 120], v: [(r() - 0.5) * 260, 260 + r() * 520], delay: g.t0 + r() * 0.18, life: 0.5 + r() * 0.5, size: 16 + r() * 26, col: [0.92, 0.99, 1, 0.5] };
    },
    { normal: true, drag: 1.2, G: [0, -800], P: [0, 0, 1.1, 0.1], order: 123 },
  );
  const nM = fan(gs, (g) => (g.kind === "center" ? 18 : g.kind === "mon" ? 8 : 3));
  const mist = mkP(
    nM.length,
    (i) => {
      const g = gs[nM[i]];
      const big = g.kind === "center";
      return { p: [g.x + (r() - 0.5) * 160, g.y0 + 120 + r() * (big ? 400 : 280)], v: [(r() - 0.5) * 90, 20 + r() * 70], delay: g.t0 + 0.1 + r() * 0.25, life: 0.9 + r() * 0.8, size: 90 + r() * 80, col: [0.72, 0.88, 0.96, 0.17] };
    },
    { normal: true, drag: 1.0, P: [0, 0, 1.1, 0.25], order: 119 },
  );
  const nR = fan(gs, (g) => (g.kind === "center" ? 40 : g.kind === "mon" ? 18 : 0));
  const rain = mkP(
    nR.length,
    (i) => {
      const g = gs[nR[i]];
      return { p: [g.x + (r() - 0.5) * 200, g.y0 + 260 + r() * 250], v: [(r() - 0.5) * 120, 0], delay: g.t0 + 0.25 + r() * 0.5, life: 0.5 + r() * 0.35, size: 3 + r() * 3, stretch: 0.6, shape: 1, col: [0.75, 0.94, 1, 0.9] };
    },
    { drag: 0.2, G: [0, -1400], P: [0, 0, 1, 0.05], order: 126 },
  );
  const streaks = mkP(
    ctx.count(150),
    () => {
      const sd = r() < 0.5 ? -1 : 1;
      return { p: [(r() - 0.5) * 80, (r() - 0.5) * 260], v: [sd * (1300 + r() * 1500), (r() - 0.5) * 160], delay: Ts - 0.02 + r() * 0.45, life: 0.45 + r() * 0.3, size: 40 + r() * 80, stretch: 0.12, shape: 1, col: [0.55, 0.9, 1, 0.12 + r() * 0.12] };
    },
    { drag: 0.3, P: [0, 0, 0.5, 0.1], order: 125 },
  );
  // cards torn apart: soggy shards and spray swept toward the owner's GY
  const nShard = Math.round(30 * Math.min(1, ctx.count(100) / 100));
  const shards = mkP(
    N * nShard,
    (i) => {
      const o = info[Math.floor(i / nShard)];
      return {
        p: [o.v.x + (r() - 0.5) * 80, o.v.y + 70 + (r() - 0.5) * 110],
        v: [o.dir * (260 + r() * 900), (r() - 0.25) * 480],
        delay: o.tb + r() * 0.1,
        life: 0.9 + r() * 0.45,
        size: 8 + r() * 12,
        rot: r() * 6,
        spin: (r() - 0.5) * 16,
        shape: 2,
        col: [0.13, 0.23, 0.32, 0.95],
      };
    },
    { drag: 0.9, G: [0, -750], normal: true, P: [0, 0, 1, 0.05], order: 123 },
  );
  const nSpray = Math.round(36 * Math.min(1, ctx.count(100) / 100));
  const cardSpray = mkP(
    N * nSpray,
    (i) => {
      const o = info[Math.floor(i / nSpray)];
      return {
        p: [o.v.x + (r() - 0.5) * 80, o.v.y + 70 + (r() - 0.5) * 110],
        v: [o.dir * (200 + r() * 1000), (r() - 0.2) * 520],
        delay: o.tb + r() * 0.1,
        life: 0.5 + r() * 0.5,
        size: 5 + r() * 8,
        stretch: 0.55,
        shape: 1,
        col: r() < 0.5 ? [0.8, 0.95, 1, 1] : [0.5, 0.88, 1, 1],
      };
    },
    { drag: 1.0, G: [0, -900], P: [0, 0, 1, 0.05], order: 126 },
  );
  // aftermath: dripping from the rows and ripples on the puddles
  const dripSrc: Array<[number, number]> = [];
  for (const side of ["opp", "you"] as const) {
    const st = ctx.rows[side].st;
    const list = st ? rowCentres(st) : demoRow(side === "opp" ? 316 : -316);
    for (const q of list) dripSrc.push([q.x, q.y - CH / 2 + 6]);
  }
  for (const z of zones) dripSrc.push([z.x, z.y - CH / 2 + 6]);
  const dripSpread = clamp(D - 2.75, 0.2, 0.9);
  const drips = mkP(
    ctx.count(70),
    () => {
      const q = dripSrc[Math.floor(r() * dripSrc.length)];
      return { p: [q[0] + (r() - 0.5) * CW * 0.9, q[1]], v: [0, -30], delay: 1.9 + r() * dripSpread, life: 0.45 + r() * 0.35, size: 5 + r() * 3, stretch: 0.6, shape: 1, col: [0.8, 0.95, 1, 0.8] };
    },
    { drag: 0.2, G: [0, -900], P: [0, 0, 1, 0.05], order: 126 },
  );
  const ripSpots: Pt[] = [...vs.map((v) => ({ x: v.x, y: v.y - 20 })), { x: -300, y: 60 }, { x: 260, y: -90 }, { x: 40, y: 230 }, { x: -150, y: -230 }];
  const ripples = ripSpots.map((q, i) => ({ ...q, off: hash1(i * 2.3), s: ctx.sprite(tex.ring, [0.6, 0.9, 1]) }));

  const shakes: ShakeImpulse[] = [
    { t: 0.1, dur: 0.75, amp: 3, kind: "swell", freq: 22 },
    { t: 0.6, dur: 0.25, amp: 3, kind: "decay", freq: 40 },
    { t: Tb - 0.02, dur: 0.8, amp: 26, kind: "decay", freq: 36 },
    { t: Tb + 0.15, dur: 1.0, amp: 6, kind: "swell", freq: 58 },
  ];
  const colUniform = (u: THREE.IUniform, c: Color3): void => {
    (u.value as THREE.Color).setRGB(c[0], c[1], c[2]);
  };
  const uvc = ctx.uv(0, 0);

  return {
    shakes,
    update(t) {
      const pre = ramp(t, 0.1, Tb);
      const u0 = t - Tb;
      const endFade = 1 - ramp(t, D - 0.45, D);

      // the caster glows and slams (the page keeps the card where it is)
      if (S) {
        const up = easeOut3(ramp(t, 0.2, 0.42)) * (1 - easeIn3(ramp(t, 0.6, 0.69)));
        aura.color(COL);
        aura.set(S.x, S.y, 330 * (0.5 + up), 0.75 * up + 0.35 * ramp(t, 0.6, 0.7) * (1 - ramp(t, 0.7, 1.3)));
        slam.color(COL);
        const rr = ramp(t, 0.64, 1.1);
        slam.set(S.x, S.y, 90 + 380 * easeOut3(rr), rr > 0 ? (1 - rr) * 0.9 : 0);
      }

      // grade: a deep blue tint grows, then a lighter wet tint stays
      const wetA = ramp(t, 0.1, Tb + 0.2) * (1 - 0.45 * ramp(t, 2.0, 2.8)) * endFade;
      P.uTint.value.setRGB(0.6, 0.88, 1.1);
      P.uTintAmt.value = 0.5 * wetA;
      P.uDarken.value = 0.22 * wetA;
      P.uVig.value = 0.25 + 0.3 * wetA;
      // flash at the burst peak
      let fl = t < Tb ? 0.8 * ramp(t, Tb - 0.035, Tb) : 0.8 * Math.exp(-(t - Tb) / 0.1);
      fl = Math.max(fl, 0.15 * decay(t, 0.62, 0.08));
      P.uFlash.value.set(0.8, 0.95, 1, fl);
      P.uAberr.value = Math.min(1.2, fl * 1.2);
      bigflash.set(0, 0, 1500, t >= Tb ? 0.55 * Math.exp(-u0 / 0.09) : 0);
      // refraction + ripple distortion over the board, glints, wet darkening
      const bp = ramp(t, Tb - 0.02, Tb + 0.12) * (1 - ramp(t, Tb + 0.9, Tb + 1.8));
      const aft = ramp(t, 1.6, 2.1) * endFade;
      P.uWet.value.set(0.011 * bp + 0.0032 * aft, 0.0045 * bp + 0.0035 * aft, 0.07 * ramp(t, Tb + 0.3, Tb + 0.9) * endFade, 0.4 * ramp(t, Tb + 0.1, Tb + 0.5) * endFade);
      if (u0 >= 0) {
        const k = ramp(u0, 0, 0.9);
        P.uShock.value.set(uvc[0], uvc[1], 1.15 * easeOut3(k), lerp(0.05, 0.13, k));
        P.uShock2.value.set(0.045 * (1 - k) * (1 - k), 0.8 * (1 - k), 0);
        P.uShockCol.value.setRGB(0.5, 0.85, 1);
      }
      // seeping
      for (const z of seeps) {
        const k = ramp(t, z.s0, Tb);
        const fade = 1 - ramp(t, z.tg + 0.05, z.tg + 0.35);
        z.pool.set(z.x, z.y, 80 + 170 * k, 0.85 * k * fade, 60 + 120 * k);
        z.glow.set(z.x, z.y, 110 + 170 * k, 0.4 * k * fade * (0.8 + 0.2 * Math.sin(t * 14 + z.ph)), 90 + 130 * k);
      }
      cracks.forEach((q, i) => q.b.set(1.25 * ramp(t, q.t0, q.t0 + 0.45), 0.4 * ramp(t, q.t0, q.t0 + 0.15) * (1 - ramp(t, q.tg, q.tg + 0.3)) * (0.75 + 0.25 * Math.sin(t * 18 + i))));
      // jets, splash rings, flood
      gey.forEach((q, gi) => {
        const g = q.g;
        const u = t - g.t0;
        const big = g.kind === "center";
        const hmax = big ? 520 : 360;
        const fall = ramp(u, 0.4, 0.8);
        const pulse = 1 + 0.06 * Math.sin(t * 44 + gi * 1.7);
        setGeyser([q.back, q.front], {
          t,
          h: u >= 0 ? hmax * easeOut3(ramp(u, 0, 0.17)) * (1 - 0.45 * easeIn2(fall)) : 0,
          wid: (0.45 + 0.55 * easeOut3(ramp(u, 0, 0.14))) * (1 - 0.8 * easeIn2(fall)) * pulse,
          int: u < 0 ? 0 : 1 - ramp(u, 0.65, 0.95),
        });
      });
      gs.forEach((g, gi) => {
        const k = ramp(t - g.t0, 0, 0.45);
        baseRing[gi].set(g.x, g.y0 + 6, 40 + 300 * easeOut3(k), t >= g.t0 && g.kind !== "empty" ? 0.8 * (1 - k) : t >= g.t0 ? 0.4 * (1 - k) : 0, 18 + 90 * easeOut3(k));
      });
      const lvl = lerp(1, 0.3, easeInOut(ramp(t, Tb + 1.0, 2.6)));
      surge.set(t, 1250 * easeOut3(ramp(t, Ts, Ts + 0.85)), lvl, endFade);
      for (const s of [beads, spray, foam, mist, rain, streaks, shards, cardSpray, drips]) s.setT(t);
      // ripples on the puddles
      for (const rp of ripples) {
        const ph = ((((t - 1.8) / 0.9 + rp.off) % 1) + 1) % 1;
        const on = t > 1.8 ? 1 : 0;
        const w = 28 + 190 * ph;
        rp.s.set(rp.x, rp.y, w, 0.4 * (1 - ph) * on * endFade, w * 0.42);
      }
      // monsters: tremble, get lifted and tumbled by their jet, crack, then are torn apart and swept to the GY
      for (const o of info) {
        const k = o.v.card;
        const u = t - o.tg;
        const dB = t - o.tb;
        k.mesh.renderOrder = 112;
        if (u < 0) {
          const tr = ramp(t, 0.25, Tb);
          k.pose(o.v.x + Math.sin(t * 70 + o.i * 2) * 2 * tr, o.v.y + Math.cos(t * 63 + o.i) * 1.6 * tr, 1 + 0.02 * tr);
          colUniform(k.u.uRim, COL);
          k.u.uRimAmt.value = 0.5 * pre;
          continue;
        }
        const tum = easeOut3(ramp(u, 0.02, 0.36));
        const lift = 70 * easeOut3(ramp(u, 0.02, 0.28)) + 38 * ramp(u, 0.28, 0.36);
        k.pose(o.v.x + o.sp * 18 * tum, o.v.y + lift, 1 + 0.12 * tum, k.base.rot + o.sp * 1.15 * tum);
        k.u.uSoak.value = 0.9 * ramp(u, 0, 0.1);
        k.u.uCrack.value = ramp(u, 0.1, 0.34);
        colUniform(k.u.uFlashCol, [0.8, 0.95, 1]);
        k.u.uFlash.value = 0.85 * Math.exp(-u / 0.06);
        colUniform(k.u.uRim, COL);
        k.u.uRimAmt.value = 0.8 * (1 - ramp(u, 0.2, 0.36));
        if (dB >= 0) {
          const w = k.u;
          w.uBreak.value = dB;
          w.uStyle.value = 1;
          (w.uWind.value as THREE.Vector2).set(o.dir, 0.12);
          w.uGrav.value = 160;
          w.uSpin.value = 14;
          w.uDelaySpan.value = 0.1;
          (w.uDelayDir.value as THREE.Vector2).set(o.dir, 0);
          w.uLife.value = 1.05;
          colUniform(w.uHeatCol, [0.4, 0.8, 1]);
        }
      }
      landing.update(t, { alpha: 0.5, col: [0.4, 0.8, 1], cold: 0.5 });
      for (const { v, s } of pulses) {
        const pk = 1 - (t - v.end) / 0.5;
        const pile = v.pile as Pt;
        s.set(pile.x, pile.y, pk > 0 && pk < 1 ? 70 + 240 * (1 - pk) : 0, pk > 0 ? pk * 0.7 * endFade : 0);
      }
    },
  };
};
