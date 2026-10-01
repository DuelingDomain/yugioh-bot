import * as THREE from "three";
import { MIRROR, MIRROR_STOP, mirrorAt, mirrorDemoTime, mirrorGeo, mirrorWorld } from "../../mirror-math";
import { toWorldX, toWorldY } from "../../scene-plan";
import {
  CW,
  GLSL_COMMON,
  bump,
  easeIn2,
  easeIn3,
  easeOut3,
  lerp,
  ramp,
  type Color3,
  type ParticleSpec,
  type ShakeImpulse,
  type WipeBuild,
  type WipeParticles,
} from "./common";

/**
 * Mirror Force (piece mirror-force): a prismatic mirror wall stands in front of the caster, the attack hits it,
 * and a fan of reflected beams breaks every attack-position monster of the attacker's side. Port of the demo
 * `sceneMirror` (.fx-demo/js/scenes.js).
 *
 * The wall is one shader quad of pointy-top hex facets. The shader works out the grid from local coordinates,
 * and `cells` mirrors that grid in JS, so the falling glass starts exactly where a facet leaves the wall.
 *
 * Time. The scene runs in game time; `mirrorDemoTime` maps it to the demo clock, where the impact is at 0.6 s
 * (then a 0.15 s time-stop). With an incoming attack the impact is the moment that attack lands: the barrier
 * rises before it, and the scene draws no bolt of its own. Without one the scene shows the demo's own bolt.
 * The plan (scene-plan.ts) uses the same functions, so a card breaks when its beam arrives.
 * Defense-position monsters are not victims: they stay on the page.
 */

const R = 34; // hex size, centre to corner
const HY = 52.5; // cell-centre limit across the wall (three rows of facets)
const PH = 210; // wall plane height
const LIGHT: Color3 = [0.62, 0.88, 1];
const HOT: Color3 = [1, 0.5, 0.18];
const TAU = Math.PI * 2;

/* ---------- the wall ---------- */

const MIR_VS = `uniform float uFlex, uDir, uImpX; varying vec2 vL;
void main(){
  vL = position.xy; vec3 p = position;
  float g = exp(-pow((p.x - uImpX)/300., 2.));
  p.y += uDir*uFlex*g*(34. + 16.*(1. - abs(p.y)/105.));
  gl_Position = projectionMatrix*viewMatrix*modelMatrix*vec4(p,1.);
}`;

const MIR_FS =
  GLSL_COMMON +
  `
uniform float uT, uApp, uShat, uCrack, uRip, uRipT, uInt, uStat, uPulse, uFlash, uHX, uReach; uniform vec2 uImp; varying vec2 vL;
const float R = ${R.toFixed(1)};
void main(){
  vec2 p = vL;
  float cq = (.57735027*p.x - .33333333*p.y)/R, cr = .66666667*p.y/R, cs = -cq - cr;
  float rx = floor(cq+.5), rs = floor(cs+.5), rz = floor(cr+.5);
  float dx = abs(rx-cq), ds = abs(rs-cs), dz = abs(rz-cr);
  if (dx > ds && dx > dz) rx = -rs - rz; else if (ds > dz) rs = -rx - rz; else rz = -rx - rs;
  vec2 id = vec2(rx, rz), ctr = vec2(R*1.7320508*(rx + rz*.5), R*1.5*rz);
  if (abs(ctr.x) > uHX || abs(ctr.y) > ${HY.toFixed(1)}) discard;
  vec2 lp = p - ctr;
  float d = max(abs(lp.x), abs(lp.x)*.5 + abs(lp.y)*.8660254), inr = R*.8660254;
  float h = hash21(id + 7.31), h2 = hash21(id*1.7 + 2.9);
  float tm = uT*(1. - uStat);
  // the wall grows in from the middle outwards, every facet scaling up from its centre
  float th = abs(ctr.x)/uHX*.6 + h*.4;
  float ac = mix(clamp((uApp*1.3 - th)/.3, 0., 1.), 1., uStat);
  // glass breaks away from the impact outwards
  float ts = length(ctr - uImp)/uReach*.9;
  if (uShat > ts) discard;
  float e = inr*ac - 1.3 - d;
  if (e < 0.) discard;
  // facet: iridescent body, six triangular sub-facets, moving sheen
  vec3 gd = vec3(cos(h*6.2831853), sin(h*6.2831853), 0.);
  float g = dot(lp, gd.xy)/inr*.5 + .5;
  vec3 pr = .5 + .5*cos(6.2831853*(g*.6 + h2 + vec3(0., .33, .67) + tm*.06));
  vec3 body = mix(vec3(.3,.55,.9), pr, .5);
  float sec = floor((atan(lp.y, lp.x) + 3.14159265)/1.0471976);
  float sh = hash21(id*3.1 + sec*1.9);
  body *= .55 + .75*sh;
  float sheen = pow(.5 + .5*sin((vL.x*.75 - vL.y*.55)*.017 + tm*2.4 + h*5.), 9.) * (.35 + .65*step(.35, fract(h2*5. + sec*.37)));
  vec3 col = body*.85 + vec3(.9,.97,1.)*sheen*1.1;
  float alpha = .24 + .22*sh + sheen*.5;
  // bevel with a chromatic fringe, a fainter inner bevel line, brighter outer facets
  vec3 ec = vec3(smoothstep(5.5, 0., e - 1.5), smoothstep(5.5, 0., e), smoothstep(5.5, 0., e + 1.5));
  col += ec*1.05; alpha = max(alpha, max(ec.r, max(ec.g, ec.b))*.97);
  float inl = smoothstep(1.7, 0., abs(e - 12.))*.55*(.5 + .5*h2);
  col += vec3(.7,.9,1.)*inl; alpha += inl*.35;
  float outer = step(44., abs(ctr.y)) + smoothstep(uHX - 70., uHX - 5., abs(ctr.x));
  col *= 1. + .35*outer; alpha += .08*outer;
  // impact: glow, then ring ripples that travel through the glass
  vec2 di = p - uImp; float rr = length(di);
  float rip = sin(rr*.075 - uRipT*38.)*exp(-rr*.0042)*uRip*step(rr, uRipT*650. + 30.);
  col += vec3(.75,.93,1.)*max(rip, 0.)*1.1; alpha += max(rip, 0.)*.5;
  float imp = exp(-rr*rr/12800.)*uPulse;
  col += vec3(1.)*imp*1.5; alpha += imp;
  float pop = ac*(1. - ac)*4.*(1. - uStat);
  col += vec3(.9,1.,1.)*pop*.9; alpha += pop*.5;
  float pre = (1. - smoothstep(0., .07, ts - uShat))*step(.0001, uShat);
  col += vec3(1.)*pre*1.3; alpha += pre;
  // crack web: crooked spokes from the impact, with broken rings between them
  if (uCrack > 0.) {
    float reach = uCrack*uReach*1.17;
    vec2 dc = vec2(di.x, di.y*3.2);
    float cr2 = length(dc), ca = atan(dc.y, dc.x);
    float aj = ca + (fbm(vec2(cr2*.013, ca*1.7)) - .5)*.9;
    float sc = aj/6.2831853*11.;
    float dpx = (.5 - abs(fract(sc) - .5))*.5712*cr2/3.2;
    float spoke = smoothstep(2.4, .3, dpx)*step(.2, hash21(vec2(floor(sc), 3.1)));
    float fr = cr2*.022 + (fbm(dc*.02 + 3.) - .5)*2.;
    float ring = smoothstep(.06, 0., min(fract(fr), 1. - fract(fr)))*step(.5, hash21(vec2(floor(sc), floor(fr)) + 9.));
    float cw = max(spoke, ring*.85)*(1. - smoothstep(reach - 90., reach, cr2));
    col = mix(col, vec3(.95,.99,1.), cw*.95); alpha = max(alpha, cw*.95);
  }
  col += vec3(1.)*uFlash;
  gl_FragColor = vec4(col, clamp(alpha, 0., 1.)*uInt);
}`;

/* ---------- a ray: one quad, head and tail run along it ---------- */

const RAY_VS = `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*viewMatrix*modelMatrix*vec4(position,1.); }`;
const RAY_FS =
  GLSL_COMMON +
  `
uniform float uT, uHead, uTail, uAlpha, uPrism, uLen, uSeed; uniform vec3 uCol; varying vec2 vUv;
void main(){
  float u = vUv.x, v = (vUv.y - .5)*2.;
  float vis = smoothstep(uTail, uTail + .05, u)*(1. - smoothstep(uHead - .012, uHead + .012, u));
  float tr = pow(clamp((u - uTail)/max(uHead - uTail, .001), 0., 1.), 1.5);
  float nz = vnoise(vec2(u*uLen*.05 - uT*28. + uSeed, v*2.5));
  float core = exp(-pow(v/(.12 + .05*nz), 2.)), glow = exp(-pow(v/.5, 2.))*.45;
  float hd = exp(-pow((u - uHead)*uLen/30., 2.))*exp(-v*v*1.4);
  vec3 col;
  if (uPrism > .5) {
    float sp = .32 + .07*sin(u*uLen*.05 - uT*20.);
    float rc = exp(-pow((v - sp)/.12, 2.)), bc = exp(-pow((v + sp)/.12, 2.));
    col = (vec3(1.,.3,.78)*rc + vec3(.3,.92,1.)*bc + vec3(1.)*core*1.15 + vec3(.55,.8,1.)*glow)*vis*(.3 + .7*tr) + vec3(.9,.97,1.)*hd*1.5;
  } else {
    col = (uCol*glow*1.1 + mix(uCol, vec3(1.), .85)*core*1.3)*vis*(.3 + .7*tr) + vec3(1.,.95,.8)*hd*1.7;
  }
  col *= 1. - smoothstep(.8, 1., abs(v));
  gl_FragColor = vec4(col*uAlpha, 1.);
}`;

type Pt = { x: number; y: number };

function makeRay(prism: boolean, seed: number, col: Color3 = HOT) {
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uT: { value: 0 },
      uHead: { value: 0 },
      uTail: { value: 0 },
      uAlpha: { value: 0 },
      uPrism: { value: prism ? 1 : 0 },
      uLen: { value: 100 },
      uSeed: { value: seed },
      uCol: { value: new THREE.Color(...col) },
    },
    vertexShader: RAY_VS,
    fragmentShader: RAY_FS,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const geo = new THREE.PlaneGeometry(1, 1);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = 130;
  mesh.frustumCulled = false;
  mesh.visible = false;
  return {
    mesh,
    /** head and tail are 0..1 along a -> b, so the same quad is a bolt, a beam or a trail. */
    set(a: Pt, b: Pt, head: number, tail: number, alpha: number, wid: number, t: number): void {
      const L = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      const full = L + 80;
      const dx = (b.x - a.x) / L;
      const dy = (b.y - a.y) / L;
      mesh.position.set((a.x + b.x) / 2, (a.y + b.y) / 2, 0);
      mesh.rotation.z = Math.atan2(dy, dx);
      mesh.scale.set(full, wid, 1);
      const u = mat.uniforms;
      u.uHead.value = (head * L + 40) / full;
      u.uTail.value = (tail * L + 40) / full;
      u.uLen.value = full;
      u.uAlpha.value = alpha;
      u.uT.value = t;
      mesh.visible = alpha > 0.004 && head > tail + 0.002;
    },
    dispose(): void {
      geo.dispose();
      mat.dispose();
    },
  };
}

/* ---------- the scene ---------- */

export const buildMirror: WipeBuild = (ctx) => {
  const P = ctx.post;
  const r = ctx.rand;
  const scene = ctx.scene;
  const world = scene.world;
  const victims = ctx.victims;
  const n = victims.length;
  const incoming = scene.incoming;
  const hit = scene.hitMs > 0 ? scene.hitMs / 1000 : MIRROR.th;
  const { th, tl, tr, tsh, tcr } = MIRROR;

  // geometry (the same numbers as the plan)
  const rowMid = (side: "you" | "opp"): number | null => {
    const row = ctx.rows[side].m;
    return row ? (row.minY + row.maxY) / 2 : null;
  };
  const rect = scene.attacker;
  const attacker =
    rect && world ? { x: toWorldX(world, rect.x + rect.w / 2), y: toWorldY(world, rect.y + rect.h / 2) } : null;
  const geo = mirrorGeo({
    wx: victims.map((v) => v.x),
    wy: victims.map((v) => v.y),
    attacker,
    ownerSide: ctx.ownerSide,
    rowYou: rowMid("you"),
    rowOpp: rowMid("opp"),
    incoming,
  });
  const { cs, os, cyM, yI, I, tbMin } = geo;
  const rowY = n ? victims.reduce((sum, v) => sum + v.y, 0) / n : cyM + os * MIRROR.halfGap * 0.8;
  const boundsW = ctx.bounds.maxX - ctx.bounds.minX;
  // the wall spans the owner's row and a little more; with no rows it is a demo-sized wall
  const rows = [ctx.rows.you.m, ctx.rows.opp.m].filter((x): x is NonNullable<typeof x> => x != null);
  const rowHalf = Math.max(0, ...rows.map((x) => (x.maxX - x.minX) / 2), ...victims.map((v) => Math.abs(v.x) + CW / 2));
  const HX = rows.length || n ? Math.min(Math.min(560, 0.47 * boundsW), Math.max(380, rowHalf + 215)) : Math.min(500, 0.45 * boundsW);
  const PW = 2 * HX + 80;

  const cells: Pt[] = [];
  {
    const w = R * Math.sqrt(3);
    const h = R * 1.5;
    const qMax = Math.ceil(HX / w) + 2;
    for (let rr = -2; rr <= 2; rr += 1) {
      for (let q = -qMax; q <= qMax; q += 1) {
        const x = w * (q + rr / 2);
        const y = h * rr;
        if (Math.abs(x) < HX && Math.abs(y) < HY) cells.push({ x, y });
      }
    }
  }
  const reach = Math.max(700, 1.2 * Math.max(0, ...cells.map((c) => Math.hypot(c.x - I.x, c.y + cyM - yI))));
  const tsOf = (cell: Pt): number => (Math.hypot(cell.x - I.x, cell.y + cyM - yI) / reach) * 0.9;

  const info = victims.map((v, i) => {
    const p = geo.at[i];
    const d = Math.hypot(p.x - I.x, p.y - I.y);
    const tb = geo.tb[i];
    return { v, i, p, tb, bk: tb + MIRROR.breakLag, ux: (p.x - I.x) / (d || 1), uy: (p.y - I.y) / (d || 1), isA: i === geo.attacker };
  });
  const att = geo.attacker >= 0 ? info[geo.attacker] : null;
  const ax = att ? att.v.x : I.x;
  const ay = att ? att.v.y : rowY;
  const aEnd: Pt = att ? att.p : { x: ax, y: ay };
  const off = (te: number): number => (incoming ? 0 : cs * MIRROR.lunge * easeOut3(ramp(te, 0.14, 0.36)) + os * 12 * bump(te, 0.06, 0.16));

  const WHITE: [number, number, number, number] = [0.95, 0.98, 1, 1];
  const CYAN: [number, number, number, number] = [0.45, 0.92, 1, 1];
  const PINK: [number, number, number, number] = [1, 0.5, 0.85, 1];
  const VIOLET: [number, number, number, number] = [0.7, 0.6, 1, 1];
  const prismCol = (): [number, number, number, number] => {
    const k = r();
    return k < 0.35 ? WHITE : k < 0.6 ? CYAN : k < 0.82 ? PINK : VIOLET;
  };
  const withA = (c: readonly number[], a: number): [number, number, number, number] => [c[0], c[1], c[2], a];
  const mkP = (count: number, gen: (i: number) => ParticleSpec, o: Parameters<typeof ctx.particles>[2]): Pick<WipeParticles, "setT"> =>
    count > 0 ? ctx.particles(count, gen, o) : { setT() {} };

  // wall, light line, glow
  const wallGeo = new THREE.PlaneGeometry(PW, PH, Math.round(PW / 7.2), 8);
  const wallMat = new THREE.ShaderMaterial({
    uniforms: {
      uT: { value: 0 },
      uApp: { value: 0 },
      uShat: { value: 0 },
      uCrack: { value: 0 },
      uRip: { value: 0 },
      uRipT: { value: 0 },
      uInt: { value: 1 },
      uStat: { value: 0 },
      uPulse: { value: 0 },
      uFlash: { value: 0 },
      uImp: { value: new THREE.Vector2(I.x, yI - cyM) },
      uFlex: { value: 0 },
      uDir: { value: cs },
      uImpX: { value: I.x },
      uHX: { value: HX },
      uReach: { value: reach },
    },
    vertexShader: MIR_VS,
    fragmentShader: MIR_FS,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  const wall = new THREE.Mesh(wallGeo, wallMat);
  wall.position.set(0, cyM, 0);
  wall.renderOrder = 114;
  wall.frustumCulled = false;
  wall.visible = false;
  ctx.addMesh(wall, () => {
    wallGeo.dispose();
    wallMat.dispose();
  });
  const mu = wallMat.uniforms;

  const tex = ctx.tex;
  const mglow = ctx.sprite(tex.soft, [0.5, 0.8, 1]);
  const scan = ctx.sprite(tex.soft, [0.8, 0.95, 1]);
  const flare = ([[1, 0.25, 0.5, -14], [0.25, 1, 0.7, 0], [0.3, 0.5, 1, 14]] as const).map(([a, b, d, dx]) => ({ dx, s: ctx.sprite(tex.soft, [a, b, d]) }));
  const bigflash = ctx.sprite(tex.soft, [0.9, 0.96, 1]);
  const orb = ctx.sprite(tex.soft, [1, 0.6, 0.25]);
  const charge = ctx.sprite(tex.soft, [1, 0.5, 0.2]);
  const iring = [0, 1].map((i) => ctx.sprite(tex.ring, i ? [0.6, 0.9, 1] : [1, 1, 1]));
  const waves = [0, 1].map((i) => ctx.sprite(tex.ring, i ? [0.6, 0.85, 1] : [0.9, 0.97, 1]));
  // the source card (a page card): an aura and a slam ring
  const aura = ctx.source ? ctx.sprite(tex.soft, LIGHT) : null;
  const slam = ctx.source ? ctx.sprite(tex.ring, LIGHT) : null;

  // the attack (only without an incoming one) and the reflected fan: a main beam and two thinner satellites per monster
  const strike = incoming ? null : ctx.add(makeRay(false, r() * 40, HOT));
  const beams = info.map((o) => ({
    o,
    rays: [0, 1, 2].map((k) => ({
      ray: ctx.add(makeRay(true, r() * 40)),
      dx: k === 0 ? 0 : (k === 1 ? -1 : 1) * 38,
      dy: k === 0 ? 0 : (k === 1 ? 1 : -1) * 22,
      w: k === 0 ? 62 : 36,
      lag: k === 0 ? 0 : 0.025,
    })),
    glow: ctx.sprite(tex.soft, [0.8, 0.92, 1]),
    ring: ctx.sprite(tex.ring, [0.75, 0.95, 1]),
  }));

  // particles
  const sparks = mkP(
    incoming ? 0 : ctx.count(70),
    () => {
      const u = r();
      const px = lerp(aEnd.x, I.x, u) + (r() - 0.5) * 20;
      const py = lerp(aEnd.y, I.y, u) + (r() - 0.5) * 20;
      return { p: [px, py], v: [(r() - 0.5) * 60, os * (30 + r() * 120)], delay: tl + u * (th - tl) * 0.9, life: 0.25 + r() * 0.2, size: 4 + r() * 5, shape: 0, col: r() < 0.5 ? [1, 0.7, 0.3, 1] : [1, 0.95, 0.8, 1] };
    },
    { drag: 1.5, P: [0, 0, 1, 0.1] },
  );
  const motes = mkP(
    ctx.count(130),
    () => {
      const cell = cells[Math.floor(r() * cells.length)];
      return { p: [cell.x + (r() - 0.5) * 50, cyM + cell.y + (r() - 0.5) * 50], v: [(r() - 0.5) * 40, (r() - 0.5) * 40], delay: 0.28 + (Math.abs(cell.x) / HX) * 0.24 + r() * 0.1, life: 0.4 + r() * 0.25, size: 5 + r() * 9, shape: 4, col: prismCol() };
    },
    { drag: 1.2, P: [0, 0, 1, 0.15] },
  );
  const burst = mkP(
    ctx.count(120),
    () => {
      const a = (r() < 0.5 ? 0 : Math.PI) + (r() - 0.5) * 1.1 + os * 0.25 * (r() - 0.2);
      const sp = 300 + r() * 1000;
      return { p: [I.x + (r() - 0.5) * 20, yI + (r() - 0.5) * 20], v: [Math.cos(a) * sp, Math.sin(a) * sp * 0.6 + os * r() * 300], delay: th + r() * 0.03, life: 0.35 + r() * 0.45, size: 14 + r() * 40, stretch: 0.6, shape: 1, col: withA(prismCol(), 0.9) };
    },
    { drag: 2.4, P: [0, 0, 1, 0.05] },
  );
  const burstShards = mkP(
    ctx.count(36),
    () => {
      const a = r() * TAU;
      const sp = 150 + r() * 600;
      return { p: [I.x, yI], v: [Math.cos(a) * sp, Math.sin(a) * sp * 0.7], delay: th + 0.005, life: 0.5 + r() * 0.4, size: 10 + r() * 18, rot: r() * 6, spin: (r() - 0.5) * 20, seed: r(), shape: 5, col: [0.85, 0.95, 1, 0.9] };
    },
    { drag: 1.6, normal: true, P: [0, 0, 0.7, 0.04], order: 124 },
  );
  const perBeam = ctx.count(40);
  const beamSpark = mkP(
    n * perBeam,
    (i) => {
      const o = info[Math.floor(i / perBeam)];
      const u = r();
      return { p: [lerp(I.x, o.p.x, u) + (r() - 0.5) * 34, lerp(I.y, o.p.y, u) + (r() - 0.5) * 34], v: [(r() - 0.5) * 80, (r() - 0.5) * 80], delay: tr + u * (o.tb - tr), life: 0.25 + r() * 0.2, size: 4 + r() * 7, shape: 4, col: prismCol() };
    },
    { drag: 1.5, P: [0, 0, 1, 0.1] },
  );
  const perShard = ctx.count(46);
  const hitShards = mkP(
    n * perShard,
    (i) => {
      const o = info[Math.floor(i / perShard)];
      const a = Math.atan2(o.uy, o.ux) + (r() - 0.5) * 2.4;
      const sp = 120 + r() * 700;
      return { p: [o.p.x + (r() - 0.5) * 80, o.p.y + (r() - 0.5) * 110], v: [Math.cos(a) * sp, Math.sin(a) * sp * 0.8 + 40], delay: o.bk + r() * 0.08, life: 0.7 + r() * 0.5, size: 10 + r() * 24, rot: r() * 6, spin: (r() - 0.5) * 16, seed: r(), shape: 5, col: [0.85, 0.96, 1, 0.92] };
    },
    { drag: 0.9, G: [0, -380], normal: true, P: [0, 0, 0.6, 0.04], order: 124 },
  );
  const perGlint = ctx.count(36);
  const hitGlints = mkP(
    n * perGlint,
    (i) => {
      const o = info[Math.floor(i / perGlint)];
      const a = Math.atan2(o.uy, o.ux) + (r() - 0.5) * 2.8;
      const sp = 250 + r() * 900;
      return { p: [o.p.x + (r() - 0.5) * 70, o.p.y + (r() - 0.5) * 100], v: [Math.cos(a) * sp, Math.sin(a) * sp], delay: o.bk + r() * 0.06, life: 0.3 + r() * 0.5, size: 8 + r() * 22, stretch: 0.6, shape: 1, col: withA(prismCol(), 1) };
    },
    { drag: 1.8, P: [0, 0, 1, 0.05], order: 126 },
  );
  const crackGlints = mkP(
    ctx.count(100),
    () => {
      const a = r() * TAU;
      const d = 30 + r() * 640;
      return { p: [I.x + Math.cos(a) * d, yI + Math.sin(a) * d * 0.3 + (r() - 0.5) * 40], v: [(r() - 0.5) * 60, (r() - 0.5) * 40], delay: tcr + (d / 640) * 0.35, life: 0.3 + r() * 0.3, size: 4 + r() * 8, shape: 4, col: [0.9, 0.98, 1, 1] };
    },
    { drag: 1.5, P: [0, 0, 1, 0.1] },
  );
  // the glass of the wall drops out facet by facet, starting where the attack hit
  const FR = 4;
  const frags = mkP(
    cells.length * FR,
    (i) => {
      const cell = cells[Math.floor(i / FR)];
      const dx = cell.x - I.x;
      const dy = cell.y + cyM - yI;
      const dl = Math.hypot(dx, dy) || 1;
      const sp = 20 + r() * 150;
      return { p: [cell.x + (r() - 0.5) * 44, cyM + cell.y + (r() - 0.5) * 44], v: [(dx / dl) * sp + (r() - 0.5) * 70, (dy / dl) * sp * 0.5 + 30 * (r() - 0.5)], delay: tsh + tsOf(cell) * 0.55 + r() * 0.05, life: 0.6 + r() * 0.4, size: 22 + r() * 30, rot: r() * 6, spin: (r() - 0.5) * 12, seed: r(), shape: 5, col: [0.8, 0.93, 1, 0.9] };
    },
    { drag: 0.5, G: [0, -1100], normal: true, P: [0, 0, 0.8, 0.03], order: 124 },
  );
  const fragGlints = mkP(
    cells.length * 2,
    (i) => {
      const cell = cells[Math.floor(i / 2)];
      const sp = 40 + r() * 200;
      const a = r() * TAU;
      return { p: [cell.x + (r() - 0.5) * 40, cyM + cell.y + (r() - 0.5) * 40], v: [Math.cos(a) * sp, Math.sin(a) * sp], delay: tsh + tsOf(cell) * 0.55 + r() * 0.06, life: 0.3 + r() * 0.4, size: 8 + r() * 16, stretch: 0.5, shape: 1, col: withA(prismCol(), 1) };
    },
    { drag: 1.6, G: [0, -500], P: [0, 0, 1, 0.05], order: 126 },
  );
  const linger = mkP(
    ctx.count(100),
    () => {
      const onWall = r() < 0.5;
      const x = (r() - 0.5) * 1.8 * HX;
      return { p: [x, onWall ? cyM + (r() - 0.5) * 170 : rowY + (r() - 0.5) * 150], v: [(r() - 0.5) * 30, 10 + r() * 40], delay: 1.8 + r() * 0.5, life: 0.6 + r() * 0.5, size: 3 + r() * 5, shape: 4, col: prismCol() };
    },
    { drag: 0.8, P: [0, 0, 1, 0.25] },
  );
  // the pieces of the destroyed monsters head for their owner's pile, with the landing streak (game time)
  const NG = 14;
  const piled = victims.filter((v) => v.pile != null);
  const gyShards = mkP(
    piled.length * NG,
    (i) => {
      const v = piled[Math.floor(i / NG)];
      const o = info[v.i];
      const pile = v.pile as Pt;
      return { p: [o.p.x + (r() - 0.5) * 70, o.p.y + (r() - 0.5) * 100], v: [pile.x + (r() - 0.5) * 30, pile.y + (r() - 0.5) * 40], delay: v.land - 0.1 + r() * 0.25, life: 0.55 + r() * 0.2, size: 12 + r() * 14, spin: 3 + r() * 5, seed: r(), shape: 5, col: [0.8, 0.94, 1, 0.9] };
    },
    { mode: 3, normal: true, P: [0, 0, 0.5, 0.15], order: 124 },
  );

  const land = ctx.landing({ from: (v) => info[v.i].p });
  const [shU, shV] = ctx.uv(0, rowY);
  const [iU, iV] = ctx.uv(I.x, yI);
  const shakes: ShakeImpulse[] = [
    { t: mirrorAt(0.45, hit), dur: 0.25, amp: 3, kind: "decay" },
    { t: hit, dur: MIRROR_STOP + 0.3, amp: 6, kind: "decay", freq: 70 },
    { t: mirrorAt(tbMin, hit), dur: 0.75, amp: 26, kind: "decay", freq: 34 },
    { t: mirrorAt(tsh, hit), dur: 0.5, amp: 9, kind: "decay", freq: 42 },
    ...info.map((o) => ({ t: mirrorAt(o.tb, hit), dur: 0.2, amp: 6, kind: "decay" as const, freq: 60 })),
  ];

  const S = ctx.source;
  return {
    shakes,
    update(ts) {
      const t = mirrorDemoTime(ts, hit);
      const te = mirrorWorld(t);
      const rt = Math.max(0, t - th);
      const post = te - th;

      // the source card: aura and slam ring (castSource without moving the card)
      if (S && aura && slam) {
        const tc = te - 0.15;
        const tS = 0.4;
        const lift = easeOut3(ramp(tc, 0.2, 0.42));
        const slamK = easeIn3(ramp(tc, tS, tS + 0.09));
        const up = lift * (1 - slamK);
        aura.set(S.x, S.y, 330 * (0.5 + up), 0.75 * up + 0.35 * ramp(tc, tS, tS + 0.1) * (1 - ramp(tc, tS + 0.1, tS + 0.7)));
        const rk = ramp(tc, tS + 0.04, tS + 0.5);
        slam.set(S.x, S.y, 90 + 380 * easeOut3(rk), rk > 0 ? (1 - rk) * 0.9 : 0);
      }

      const present = ramp(te, 0.15, 0.55) * (1 - ramp(te, 1.9, 2.9));
      P.uTint.value.setRGB(0.82, 0.93, 1.1);
      P.uTintAmt.value = 0.4 * present;
      P.uDarken.value = 0.14 * present;
      P.uVig.value = 0.25 + 0.3 * present;

      // wall
      mu.uT.value = te;
      mu.uApp.value = ramp(te, 0.3, 0.6);
      mu.uFlex.value = post > 0 ? Math.exp(-post / 0.28) * Math.sin(post * 16) : 0;
      mu.uRip.value = post > 0 ? Math.exp(-post / 0.4) * 0.8 : 0;
      mu.uRipT.value = Math.max(0, post);
      mu.uPulse.value = post >= 0 ? Math.exp(-post / 0.12) : 0;
      mu.uCrack.value = te >= tcr ? easeOut3(ramp(te, tcr, tcr + 0.4)) : 0;
      mu.uShat.value = te >= tsh ? 0.78 * ramp(te, tsh, tsh + 0.6) : 0;
      mu.uFlash.value = t >= th ? 0.5 * Math.exp(-rt / 0.07) : 0;
      wall.visible = te >= 0.28 && te < 2.1;
      const glowA = ramp(te, 0.3, 0.6) * (1 - ramp(te, tsh, tsh + 0.6));
      const wide = PW * 1.065;
      mglow.set(0, cyM, wide, 0.3 * glowA + 0.3 * (t >= th ? Math.exp(-rt / 0.2) : 0), 250);
      scan.set(0, cyM, wide * easeOut3(ramp(te, 0.24, 0.42)), 0.7 * bump(te, 0.24, 0.5), 30);

      // grade, flashes
      let fl = t < th ? 0.6 * ramp(t, th - 0.02, th) : 0.6 * Math.exp(-rt / 0.06);
      info.forEach((o) => {
        const d = te - o.tb;
        fl = Math.max(fl, d >= 0 ? (o.tb === tbMin ? 0.6 : 0.18) * Math.exp(-d / 0.09) : 0);
      });
      fl = Math.max(fl, te >= tsh ? 0.2 * Math.exp(-(te - tsh) / 0.12) : 0);
      P.uFlash.value.set(0.93, 0.97, 1, fl);
      P.uAberr.value = Math.min(1.3, fl * 1.3);
      const frz = t >= th && t < th + MIRROR_STOP;
      P.uInvert.value = frz ? 0.6 * Math.exp(-rt / 0.03) : 0;
      if (t >= th) {
        P.uCore.value.set(iU, iV);
        P.uLens.value.set(0.3, -0.2 * Math.exp(-rt / 0.18), 0, 0);
      }
      if (te >= tbMin) {
        const k = ramp(te - tbMin, 0, 0.7);
        P.uShock.value.set(shU, shV, 1.1 * easeOut3(k), lerp(0.05, 0.12, k));
        P.uShock2.value.set(0.04 * (1 - k), 0.5 * (1 - k) * (1 - k), 0);
        P.uShockCol.value.setRGB(0.8, 0.9, 1);
        const k1 = ramp(te - tbMin, 0, 0.55);
        const k2 = ramp(te - tbMin - 0.16, 0, 0.55);
        waves[0].set(0, rowY, 160 + 1500 * easeOut3(k1), 0.8 * (1 - k1), 40 + 230 * easeOut3(k1));
        waves[1].set(0, rowY, 120 + 1100 * easeOut3(k2), te - tbMin - 0.16 >= 0 ? 0.55 * (1 - k2) : 0, 30 + 170 * easeOut3(k2));
      }

      // impact flares, rings
      const fa = t >= th ? Math.exp(-rt / 0.16) : 0;
      flare.forEach((f) => f.s.set(I.x + f.dx, yI, 520, 0.75 * fa, 300));
      bigflash.set(I.x, yI, 1500, t >= th ? 0.5 * Math.exp(-rt / 0.08) : 0, 900);
      const ik = ramp(post, 0, 0.5);
      iring[0].set(I.x, yI, 40 + 800 * easeOut3(ik), post >= 0 ? 0.85 * (1 - ik) : 0, (40 + 800 * easeOut3(ik)) * 0.3);
      const ik2 = ramp(post - 0.12, 0, 0.5);
      iring[1].set(I.x, yI, 30 + 600 * easeOut3(ik2), post - 0.12 >= 0 ? 0.6 * (1 - ik2) : 0, (30 + 600 * easeOut3(ik2)) * 0.3);

      // the attack: charge and bolt (an incoming attack is drawn by the battle, not here)
      if (strike) {
        const sk = easeIn2(ramp(te, tl, th));
        const atkAlpha = te < tl ? 0 : 1;
        strike.set(aEnd, I, sk, post > 0 ? ramp(post, 0, 0.2) : 0, atkAlpha * (post > 0 ? 1 - ramp(post, 0.05, 0.22) : 1), 72, te);
        const ox = lerp(aEnd.x, I.x, sk);
        const oy = lerp(aEnd.y, I.y, sk);
        const big = 70 + 80 * bump(te, tl, th + 0.01) + 40 * sk;
        orb.set(ox, oy, big, (te >= 0.06 && te < th + 0.04 ? 0.95 : 0) * (post > 0 ? 1 - ramp(post, 0, 0.04) : 1), big);
        const cw = 40 + 190 * ramp(te, 0.04, 0.3);
        charge.set(ax, ay + off(te) + cs * 30, cw, 0.8 * bump(te, 0.04, tl + 0.3), cw);
      }

      // reflected fan
      beams.forEach((b) => {
        const o = b.o;
        b.rays.forEach((q) => {
          const to = { x: o.p.x + q.dx, y: o.p.y + q.dy };
          const hk = ramp(te, tr + q.lag, o.tb + q.lag);
          const after = te - o.tb - q.lag;
          const tail = after > 0 ? ramp(after, 0, 0.24) : Math.max(0, hk - 0.65);
          const al = te < tr ? 0 : 1 - (after > 0 ? ramp(after, 0.06, 0.3) : 0);
          q.ray.set(I, to, hk, tail, al, q.w, te);
        });
        const dh = te - o.tb;
        b.glow.set(o.p.x, o.p.y, 300, dh >= 0 ? 0.85 * Math.exp(-dh / 0.09) : 0, 300);
        const rk = ramp(dh, 0, 0.4);
        b.ring.set(o.p.x, o.p.y, 40 + 300 * easeOut3(rk), dh >= 0 ? 0.9 * (1 - rk) : 0);
      });
      [sparks, motes, burst, burstShards, beamSpark, hitShards, hitGlints, crackGlints, frags, fragGlints, linger].forEach((s) => s.setT(te));
      gyShards.setT(ts);

      // every attack-position monster is hit by its beam, cracks like glass and bursts
      info.forEach((o) => {
        const k = o.v.card;
        const dh = te - o.tb;
        const dB = te - o.bk;
        if (dB > MIRROR.hold) {
          k.mesh.visible = false;
          return;
        }
        k.mesh.renderOrder = 112;
        const ly = o.isA ? off(te) : 0;
        const sc = o.isA && !incoming ? 1 + 0.1 * easeOut3(ramp(te, 0.14, 0.36)) : 1;
        const tremble = dh >= 0 && dB < 0 ? 1 : 0;
        k.pose(o.v.x + Math.sin(te * 95 + o.i * 2) * 2.6 * tremble, o.v.y + ly + Math.cos(te * 81 + o.i) * 2 * tremble, sc);
        if (dh < 0) {
          if (o.isA && !incoming) {
            k.u.uRim.value.setRGB(HOT[0], HOT[1], HOT[2]);
            k.u.uRimAmt.value = 0.85 * ramp(te, 0.1, 0.3);
          } else {
            k.u.uRim.value.setRGB(LIGHT[0], LIGHT[1], LIGHT[2]);
            k.u.uRimAmt.value = 0.55 * ramp(te, th, o.tb);
          }
          return;
        }
        k.u.uFlashCol.value.setRGB(0.9, 0.96, 1);
        k.u.uFlash.value = 0.95 * Math.exp(-dh / 0.07);
        k.u.uCrack.value = ramp(dh, 0, 0.09);
        k.u.uCold.value = 0.5 * ramp(dh, 0, 0.09);
        k.u.uRim.value.setRGB(0.85, 0.95, 1);
        k.u.uRimAmt.value = 0.9 * (1 - ramp(dB, 0, 0.3));
        if (dB >= 0) {
          const w = k.u;
          w.uBreak.value = dB;
          w.uKick.value.set(I.x, yI);
          w.uPow.value = 1.1;
          w.uGrav.value = 420;
          w.uSpin.value = 14;
          w.uLife.value = 1.0;
          w.uStyle.value = 0;
          w.uDelaySpan.value = 0.1;
          w.uDelayDir.value.set(0, os);
          w.uHeatCol.value.setRGB(0.85, 0.95, 1);
        }
      });
      land.update(ts, { alpha: 0.5, col: LIGHT, cold: 0.6 });
    },
  };
};
