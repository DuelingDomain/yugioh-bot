import * as THREE from "three";
import {
  GLSL_COMMON,
  WORLD_GLSL,
  clamp,
  easeIn2,
  easeInOut,
  easeOut3,
  forkedBolt,
  hash1,
  lerp,
  ramp,
  type Color3,
  type ParticleSpec,
  type ShakeImpulse,
  type WipeBuild,
  type WipeCtx,
  type WipeParticles,
} from "./common";

/**
 * Raigeki (piece raigeki): one giant beam of lightning from a storm sky hits every monster of the opponent.
 * Port of sceneRaigeki, makeBeam and makeSky of .fx-demo/js/scenes.js. World units are the demo units.
 *
 * Timeline (s): cast 0-0.5, storm builds 0.12-0.85, the head drops 0.85-0.94, the beam holds to 1.82,
 * narrows and cuts 1.82-2.1, aftermath and the landing to the graveyard after that.
 * The page owns the source card (it does not lift): only its glow and the slam ring are drawn here.
 */

const BEAM_VS = WORLD_GLSL + `varying vec2 vW; void main(){ vW=toWorld((modelMatrix*vec4(position,1.)).xy); gl_Position=projectionMatrix*viewMatrix*modelMatrix*vec4(position,1.); }`;

const BEAM_FS =
  GLSL_COMMON +
  `
uniform float uT, uWid, uInt, uFront, uYTop, uYEnd, uHalfTop, uHalfGround, uStatic, uMul;
varying vec2 vW;
void main(){
  float y = vW.y, live = 1.-uStatic, tt = uT*live;
  float s = clamp((uYTop-y)/(uYTop-uYEnd),0.,1.);
  float half0 = mix(uHalfTop,uHalfGround,pow(s,.9))*uWid;
  half0 *= 1. + .3*pow(smoothstep(uYEnd+120.,uYEnd,y),2.);          // flare at the foot
  float ax = (vnoise(vec2(y*.004,tt*4.))-.5)*26.*live;
  float dx = vW.x-ax, sd = dx < 0. ? -1. : 1.;
  float jt = floor(tt*28.);                                         // edge re-rolls 28 times a second: crackle
  float wl = fbm(vec2(y*.016-tt*7.+sd*17., jt*.37+sd*3.3));
  float spk = pow(vnoise(vec2(y*.06+sd*5., jt*1.3+sd)),3.);
  float h = max(half0*(.9+.3*wl)+40.*spk*uWid, 1.);
  float nd = abs(dx)/h;
  float streak = fbm(vec2(dx*.03, y*.005+tt*10.));                  // slow streaks flowing down
  float streak2 = vnoise(vec2(dx*.08, y*.015+tt*20.));
  float body = 1.-smoothstep(.88,1.,nd);
  float core = pow(clamp(1.-smoothstep(.08,.6,nd+(streak-.5)*.5),0.,1.),1.15);
  float vn = vnoise(vec2(dx*.045+tt*3., y*.02+tt*28.));
  float vein = pow(1.-abs(2.*vn-1.),10.)*(1.-smoothstep(.2,1.,nd))*live;
  vec3 violet = vec3(.5,.2,1.), blue = vec3(.18,.5,1.), ice = vec3(.7,.9,1.);
  vec3 c = mix(violet,blue,smoothstep(.95,.7,nd));
  c = mix(c,ice,smoothstep(.62,.28,nd));
  c = mix(c,vec3(1.),core);
  vec3 col = c*body*(.7+.6*streak2)*1.05 + vec3(1.)*vein*.85*body;
  float gl = exp(-max(nd-.85,0.)*2.1);
  col += mix(blue,violet,smoothstep(1.,2.4,nd))*gl*(1.-body)*.6;   // electric glow around the column
  col += vec3(.9,.95,1.)*exp(-pow((y-uFront)/36.,2.))*body*1.2*live; // bright head while it drops
  float rev = smoothstep(uFront-8.,uFront+22.,y);
  float bot = smoothstep(uYEnd-40.,uYEnd+30.,y);
  gl_FragColor = vec4(col*uInt*uMul*rev*bot,1.);
}`;

const BEAM_HT = 230; // half width at the sky
const BEAM_HG = 380; // half width at the monster row: the foot covers all 5 zones

type BeamLayer = { mesh: THREE.Mesh; u: Record<string, THREE.IUniform> };

/** The beam is one shader quad: a wide, solid energy column (white-hot core, blue/violet body, stepped jagged edges, flowing veins). */
function makeBeam(ctx: WipeCtx, yTop: number, yEnd: number, order: number, mul: number): BeamLayer {
  const { minX, maxX } = ctx.bounds;
  const bot = yEnd - 60;
  const geo = new THREE.PlaneGeometry(maxX - minX + 40, yTop - bot);
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uWorld: ctx.world,
      uT: { value: 0 },
      uWid: { value: 1 },
      uInt: { value: 0 },
      uFront: { value: yTop },
      uYTop: { value: yTop },
      uYEnd: { value: yEnd },
      uHalfTop: { value: BEAM_HT },
      uHalfGround: { value: BEAM_HG },
      uStatic: { value: 0 },
      uMul: { value: mul },
    },
    vertexShader: BEAM_VS,
    fragmentShader: BEAM_FS,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set((minX + maxX) / 2, (yTop + bot) / 2, 0);
  mesh.renderOrder = order;
  mesh.frustumCulled = false;
  mesh.visible = false;
  ctx.addMesh(mesh, () => {
    geo.dispose();
    mat.dispose();
  });
  return { mesh, u: mat.uniforms };
}

const setBeam = (layers: BeamLayer[], p: { t: number; wid: number; int: number; front: number }): void => {
  for (const b of layers) {
    b.u.uT.value = p.t;
    b.u.uWid.value = p.wid;
    b.u.uInt.value = p.int;
    b.u.uFront.value = p.front;
    b.u.uStatic.value = 0;
    b.mesh.visible = p.int > 0.003 && p.wid > 0.01;
  }
};

/** Storm sky: churning dark cloud over the top of the screen, lit from inside by rumbling flickers. */
const SKY_FS =
  GLSL_COMMON +
  `
uniform float uT, uYEdge, uYTop, uAmt; uniform vec4 uFl[4]; varying vec2 vW;
void main(){
  vec2 p = vec2(vW.x*.0045, vW.y*.0055);
  float w = fbm(p*2.6+vec2(uT*.22,-uT*.1));
  float n = fbm(p*1.5+vec2(uT*.3, w*1.6-uT*.12));
  float n2 = fbm(p*4.2-vec2(uT*.4,0.)+w);
  float vy = clamp((vW.y-uYEdge)/(uYTop-uYEdge),0.,1.);
  float dens = smoothstep(.12,.7,vy)*(.35+1.*n)*uAmt;
  float lit = 0.;
  for (int i=0;i<4;i++){ vec2 d = vW-uFl[i].xy; lit += uFl[i].w*exp(-dot(d,d)/(uFl[i].z*uFl[i].z)); }
  lit *= smoothstep(0.,.2,vy);
  float hi = smoothstep(.4,.8,n2*.6+n*.6);
  vec3 col = mix(vec3(.008,.008,.03),vec3(.26,.21,.5),hi) + vec3(.5,.6,1.)*lit*(.4+1.5*n2);
  gl_FragColor = vec4(col, clamp(dens*1.05+lit*.3,0.,.92));
}`;

type Sky = { set(t: number, amt: number, fl: number): void };

function makeSky(ctx: WipeCtx, yEdge: number, yTop: number): Sky {
  const { minX, maxX } = ctx.bounds;
  const geo = new THREE.PlaneGeometry(maxX - minX + 40, yTop - yEdge + 20);
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uWorld: ctx.world,
      uT: { value: 0 },
      uYEdge: { value: yEdge },
      uYTop: { value: yTop },
      uFl: { value: [0, 1, 2, 3].map(() => new THREE.Vector4()) },
      uAmt: { value: 0 },
    },
    vertexShader: BEAM_VS,
    fragmentShader: SKY_FS,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set((minX + maxX) / 2, (yEdge + yTop + 20) / 2, 0);
  mesh.renderOrder = 90;
  mesh.frustumCulled = false;
  mesh.visible = false;
  ctx.addMesh(mesh, () => {
    geo.dispose();
    mat.dispose();
  });
  const fls = mat.uniforms.uFl.value as THREE.Vector4[];
  const half = (maxX - minX) / 2;
  const scaleX = Math.max(1, half / 450);
  return {
    // fl: flicker strength 0..1.3
    set(t, amt, fl) {
      mat.uniforms.uT.value = t;
      mat.uniforms.uAmt.value = amt;
      mesh.visible = amt > 0.003;
      for (let i = 0; i < 4; i += 1) {
        const ph = t * (7 + i * 1.3) + i * 1.7;
        const k = Math.floor(ph);
        const f = ph - k;
        const on = hash1(k * 1.7 + i * 9.3) > 0.5 ? 1 : 0;
        const a = on * Math.pow(1 - f, 2) * (0.5 + 0.7 * hash1(k * 3.3 + i)) * amt * fl;
        fls[i].set((hash1(k * 5.1 + i * 2.2) - 0.5) * 900 * scaleX, yEdge + (yTop - yEdge) * (0.5 + 0.5 * hash1(k * 7.7 + i)), 150 + 100 * hash1(k + i), a);
      }
    },
  };
}

const smoothstepJS = (a: number, b: number, x: number): number => {
  const k = clamp((x - a) / (b - a));
  return k * k * (3 - 2 * k);
};

const COL: Color3 = [0.55, 0.68, 1];
const WHITE: Color3 = [1, 1, 1];

export const buildRaigeki: WipeBuild = (ctx) => {
  const r = ctx.rand;
  const P = ctx.post;
  const tex = ctx.tex;
  const D = ctx.duration;
  const top = ctx.bounds.maxY;

  // Which half of the board is hit: the half the victims stand on, or the opposite of the caster.
  const victims = ctx.victims.slice().sort((a, b) => a.x - b.x);
  const N = victims.length;
  const side: "you" | "opp" = N > 0 ? victims[0].side : ctx.ownerSide === "you" ? "opp" : "you";
  const row = ctx.rows[side].m;
  const rowY = row ? (row.minY + row.maxY) / 2 : N > 0 ? victims.reduce((s, v) => s + v.y, 0) / N : side === "opp" ? 158 : -158;
  const S = ctx.source ?? { x: 0, y: side === "opp" ? -316 : 316 };

  const Ts = 0.85;
  const Th = Ts + 0.09;
  const Tn = 1.82;
  const Tc = 2.1;
  const tb = Th + 0.4;
  const yTop = top + 50;
  const yEnd = rowY - 45;
  const yEdge = side === "opp" ? rowY - 118 : rowY + 48;
  const halfAt = (y: number): number => lerp(BEAM_HT, BEAM_HG, Math.pow(clamp((yTop - y) / (yTop - yEnd)), 0.9));
  // a particle never outlives the piece: nothing is left in the last frame
  const mkP = (n: number, gen: (i: number) => ParticleSpec, o: Parameters<WipeCtx["particles"]>[2]): WipeParticles | { setT(t: number): void } =>
    n > 0
      ? ctx.particles(
          n,
          (i) => {
            const d = gen(i);
            d.life = Math.min(d.life ?? 1, Math.max(0.05, D - (d.delay ?? 0) - 0.02));
            return d;
          },
          o,
        )
      : { setT() {} };
  const mkB = (a: { x: number; y: number }, b: { x: number; y: number }, w: number, o: { seg?: number; amp?: number; forks?: number }) => ctx.bolt(forkedBolt(a, b, r, o), w, COL, WHITE);

  const landing = ctx.landing();

  // sky and beam
  const sky = makeSky(ctx, yEdge, top);
  const bBack = makeBeam(ctx, yTop, yEnd, 100, 1);
  const bFront = makeBeam(ctx, yTop, yEnd, 135, 0.22);
  const skyGlow = ctx.sprite(tex.soft, [0.7, 0.82, 1]);
  const foot = ctx.sprite(tex.soft, [0.72, 0.84, 1]);
  const spill = ctx.sprite(tex.soft, [0.45, 0.58, 1]);
  const bigflash = ctx.sprite(tex.soft, [0.85, 0.92, 1]);
  const waves = [0, 1].map((i) => ctx.sprite(tex.ring, i ? [0.7, 0.6, 1] : [0.8, 0.9, 1]));
  const pulses = [0, 1, 2].map(() => ctx.sprite(tex.ring, [0.55, 0.7, 1]));
  const scorch = ctx.sprite(tex.soft, [0.01, 0.01, 0.03], { normal: true, order: 8 });
  const embGlow = ctx.sprite(tex.soft, [1, 0.45, 0.12]);
  // the source card glow (the page owns the card, it does not lift)
  const aura = ctx.sprite(tex.soft, COL);
  const slamRing = ctx.sprite(tex.ring, COL);

  // bolts: precursor sparks, the leader, arcs off the sides, ground arcs, lingering crackles
  const sparkBolts = (
    [
      [0.42, -330],
      [0.55, 270],
      [0.64, -120],
      [0.72, 380],
      [0.78, -40],
    ] as const
  ).map(([t, x]) => {
    const y1 = lerp(top, yEnd, 0.45 + r() * 0.25);
    return { t, b: mkB({ x: x + 40, y: yTop - 30 }, { x, y: y1 }, 2.4, { seg: 12, amp: 40, forks: 3 }) };
  });
  const leader = mkB({ x: 0, y: yTop - 20 }, { x: 0, y: yEnd + 10 }, 3.2, { seg: 18, amp: 60, forks: 6 });
  const arcs = Array.from({ length: 14 }, (_, i) => {
    const sd = i % 2 ? 1 : -1;
    const y0 = lerp(yEnd + 30, Math.min(380, yTop - 40), r());
    const x0 = sd * halfAt(y0) * 0.9;
    return { b: mkB({ x: x0, y: y0 }, { x: x0 + sd * (110 + r() * 150), y: y0 - (20 + r() * 110) }, 2.8, { seg: 9, amp: 30, forks: 2 }) };
  });
  const edgeB = (
    [
      [-1, 0],
      [1, 0],
      [0, 1],
    ] as const
  ).map(([sd, mid]) => ({ mid, b: mkB({ x: sd * halfAt(yTop) * 0.88, y: yTop - 10 }, { x: sd * halfAt(yEnd) * 0.88, y: yEnd + 10 }, mid ? 3.6 : 3, { seg: 20, amp: mid ? 22 : 26, forks: mid ? 3 : 4 }) }));
  const gArcs = Array.from({ length: 8 }, (_, i) => {
    const sd = i % 2 ? 1 : -1;
    return { b: mkB({ x: sd * (60 + r() * 180), y: yEnd + (r() - 0.5) * 30 }, { x: sd * (380 + r() * 180), y: yEnd + (r() - 0.5) * 90 }, 2.8, { seg: 10, amp: 22, forks: 2 }) };
  });
  const crackle = Array.from({ length: 6 }, () => {
    const x = (r() - 0.5) * 560;
    const y = rowY + (r() - 0.5) * 180;
    return { b: mkB({ x, y }, { x: x + (r() - 0.5) * 200, y: y + (r() - 0.5) * 130 }, 2.4, { seg: 6, amp: 20, forks: 1 }), t0: Tc + 0.05 + r() * 0.6 };
  });
  const arcsSrc = [0, 1, 2].map(() => {
    const a = r() * 6.28;
    return ctx.bolt(forkedBolt({ x: S.x + Math.cos(a) * 30, y: S.y + Math.sin(a) * 40 }, { x: S.x + Math.cos(a + 2.6) * 90, y: S.y + Math.sin(a + 2.6) * 100 }, r, { seg: 6, amp: 26, forks: 1 }), 2.2, COL, WHITE);
  });

  // particles
  const stream = mkP(
    ctx.count(320),
    () => {
      const vy = 2300 + r() * 1500;
      return { p: [(r() * 2 - 1) * 190, yTop], v: [(r() - 0.5) * 50, -vy], delay: Th - 0.05 + r() * (Tn - Th + 0.05), life: (yTop - yEnd) / vy, size: 60 + r() * 70, stretch: 0.12, shape: 1, col: r() < 0.5 ? [0.75, 0.9, 1, 0.5] : [0.8, 0.65, 1, 0.5] };
    },
    { P: [0, 0, 0.3, 0.05], order: 128 },
  );
  const ground = mkP(
    ctx.count(130),
    () => {
      const sd = r() < 0.5 ? -1 : 1;
      return { p: [(r() - 0.5) * 160, yEnd + (r() - 0.3) * 60], v: [sd * (500 + r() * 1100), 30 + r() * 140], delay: Th + r() * 0.2, life: 0.45 + r() * 0.45, size: 24 + r() * 40, stretch: 0.55, shape: 1, col: r() < 0.6 ? [0.7, 0.85, 1, 0.45] : [1, 0.8, 0.5, 0.45] };
    },
    { drag: 1.6, P: [0, 0, 1, 0.05], order: 126 },
  );
  const spray = mkP(
    ctx.count(170),
    () => ({ p: [(r() - 0.5) * 520, yEnd + r() * 30], v: [(r() - 0.5) * 700, 200 + r() * 700], delay: Th + r() * (Tn - Th), life: 0.5 + r() * 0.4, size: 8 + r() * 8, stretch: 0.7, shape: 1, col: r() < 0.5 ? [0.85, 0.93, 1, 1] : [1, 0.85, 0.5, 1] }),
    { drag: 0.9, G: [0, -900], P: [0, 0, 1, 0.05], order: 126 },
  );
  // embers and shards come from every monster: per-monster counts follow the quality of the canvas
  const perEmber = ctx.count(70);
  const perShard = ctx.count(30);
  const emberAt = (i: number, per: number) => {
    const e = victims[Math.min(N - 1, Math.floor(i / per))];
    return { e, a: r() * 6.28, sp: 100 + r() * 420 };
  };
  const embers = mkP(
    N * perEmber,
    (i) => {
      const { e, a, sp } = emberAt(i, perEmber);
      return { p: [e.x + (r() - 0.5) * 80, e.y + (r() - 0.5) * 110], v: [Math.cos(a) * sp, Math.sin(a) * sp + 120], delay: tb + r() * 0.14, life: 0.8 + r() * 0.6, size: 3 + r() * 5, stretch: 0.4, shape: 0, col: r() < 0.6 ? [1, 0.55, 0.15, 1] : [1, 0.85, 0.4, 1] };
    },
    { drag: 1.1, G: [0, -180], P: [0, 0, 1, 0.08], order: 126 },
  );
  const shards = mkP(
    N * perShard,
    (i) => {
      const { e, a, sp } = emberAt(i, perShard);
      return { p: [e.x + (r() - 0.5) * 80, e.y + (r() - 0.5) * 110], v: [Math.cos(a) * sp * 1.1, Math.sin(a) * sp + 100], delay: tb + r() * 0.14, life: 0.8 + r() * 0.4, size: 8 + r() * 12, rot: r() * 6, spin: (r() - 0.5) * 18, shape: 2, col: [0.07, 0.055, 0.055, 0.95] };
    },
    { drag: 0.9, G: [0, -600], normal: true, P: [0, 0, 1, 0.05], order: 124 },
  );
  const linger = mkP(
    ctx.count(80),
    () => ({ p: [(r() - 0.5) * 600, rowY + (r() - 0.5) * 140], v: [(r() - 0.5) * 50, 30 + r() * 90], delay: Tc - 0.1 + r() * 0.5, life: 1 + r() * 0.6, size: 3 + r() * 4, shape: 0, col: r() < 0.6 ? [1, 0.55, 0.15, 1] : [1, 0.85, 0.4, 1] }),
    { drag: 0.8, P: [0, 0, 1, 0.1], order: 126 },
  );
  const smoke = mkP(
    ctx.count(90),
    () => ({ p: [(r() - 0.5) * 560, rowY + (r() - 0.5) * 120], v: [(r() - 0.5) * 60, 40 + r() * 90], delay: Tc - 0.15 + r() * 0.45, life: 1 + r() * 0.4, size: 80 + r() * 60, col: [0.24, 0.23, 0.3, 0.42] }),
    { normal: true, drag: 1.1, P: [0, 0, 1, 0.2], order: 122 },
  );

  const alphaOf = (dt: number): number => (dt < -0.08 ? 0 : dt < 0 ? 0.55 : dt < 0.05 ? 1 : dt < 0.12 ? 0.3 : dt < 0.28 ? 0.3 * Math.exp(-(dt - 0.12) / 0.06) : 0);
  const [shU, shV] = ctx.uv(0, yEnd);
  const shakes: ShakeImpulse[] = [
    { t: 0.3, dur: 0.55, amp: 2.4, kind: "swell", freq: 30 },
    { t: Th - 0.02, dur: 0.62, amp: 30, kind: "decay", freq: 38 },
    { t: Th + 0.1, dur: Tn - Th, amp: 7, kind: "swell", freq: 62 },
    { t: Tc - 0.05, dur: 0.35, amp: 9, kind: "decay", freq: 44 },
  ];

  const tSlam = 0.45;

  return {
    shakes,
    update(t) {
      // the source glow (cast): lift and slam
      {
        const lift = easeOut3(ramp(t, 0, 0.22));
        const slam = ramp(t, tSlam, tSlam + 0.09) ** 3;
        const up = lift * (1 - slam);
        aura.color(COL);
        aura.set(S.x, S.y, 330 * (0.5 + up), 0.75 * up + 0.35 * ramp(t, tSlam, tSlam + 0.1) * (1 - ramp(t, tSlam + 0.1, tSlam + 0.7)));
        const k = ramp(t, tSlam + 0.04, tSlam + 0.5);
        slamRing.color(COL);
        slamRing.set(S.x, S.y, 90 + 380 * easeOut3(k), k > 0 ? (1 - k) * 0.9 : 0);
      }

      const build = ramp(t, 0.12, 0.8);
      const strike = ramp(t, Ts, Th);
      const cut = ramp(t, Tn, Tc);
      const live = strike * (1 - cut);
      const calm = 1 - ramp(t, Tc, D);
      // sky + grade
      sky.set(t, build * (1 - 0.85 * ramp(t, Tc, D)) * (1 - ramp(t, D - 0.35, D)), t < Th ? 0.35 + 0.9 * ramp(t, 0.2, 0.8) : 1.2);
      P.uDarken.value = 0.32 * build * calm * (1 - 0.7 * live);
      P.uTint.value.setRGB(0.62, 0.78, 1.08);
      P.uTintAmt.value = 0.4 * build * calm * (1 - 0.5 * live);
      P.uVig.value = 0.25 + 0.35 * build * calm;
      // beam
      const front = t < Ts ? yTop : lerp(yTop, yEnd - 40, ramp(t, Ts, Th));
      const grow = easeOut3(ramp(t, Ts + 0.02, Ts + 0.24));
      let wid = lerp(0.32, 1.06, grow) - 0.06 * ramp(t, Th + 0.15, Th + 0.45);
      wid *= 1 - 0.9 * easeInOut(cut);
      const int = t < Ts ? 0 : (0.9 + 0.2 * hash1(Math.floor(t * 38) * 1.3)) * (1 - easeIn2(ramp(t, Tc - 0.1, Tc + 0.06)));
      setBeam([bBack, bFront], { t, wid, int, front });
      const bi = int * (t >= Ts ? 1 : 0);
      skyGlow.set(0, yTop - 70, 800 * (0.4 + 0.6 * wid), 0.4 * bi * strike, 340);
      foot.set(0, yEnd + 5, 760 * wid, 0.5 * bi * ramp(t, Th - 0.02, Th + 0.04), 170);
      spill.set(0, rowY, 1300, 0.12 * bi * strike, 460);
      // whiteout + flashes
      const dc = t - Th;
      let fl = 0;
      if (dc > -0.03) fl = dc < 0 ? 0.95 * ramp(dc, -0.03, 0) : dc < 0.04 ? 0.95 : 0.95 * Math.exp(-(dc - 0.04) / 0.12);
      if (t > Th + 0.3 && t < Tc && hash1(Math.floor(t * 22) * 1.9) > 0.72) fl = Math.max(fl, 0.06);
      if (t > Tc) fl = Math.max(fl, 0.25 * Math.exp(-(t - Tc) / 0.08));
      for (const s of sparkBolts) {
        const d = t - s.t;
        s.b.set(((t - (s.t - 0.07)) / 0.07) * 1.25, alphaOf(d) * 0.85);
        fl = Math.max(fl, d >= 0 ? 0.12 * Math.exp(-d / 0.07) : 0);
      }
      P.uFlash.value.set(0.9, 0.95, 1, fl);
      P.uAberr.value = Math.min(1.2, fl * 1.1);
      bigflash.set(0, yEnd, 1600, dc >= 0 ? 0.6 * Math.exp(-dc / 0.1) : 0);
      leader.set(((t - (Ts - 0.1)) / 0.1) * 1.25, t > Ts - 0.1 && t < Th + 0.04 ? 1 : 0);
      arcs.forEach((a, i) => a.b.set(1.3, t > Th + 0.12 && t < Tc - 0.05 && hash1(Math.floor(t * 22) + i * 5.3) > 0.5 ? 0.9 * smoothstepJS(0.85, 1, wid) * bi : 0));
      edgeB.forEach((e, i) => e.b.set(1.3, t > Th + 0.1 && t < Tc && hash1(Math.floor(t * 26) + i * 6.1) > 0.3 ? 0.85 * smoothstepJS(0.85, 1, wid) * bi : 0));
      gArcs.forEach((a, i) => a.b.set(1.3, t > Th && t < Tc + 0.2 && hash1(Math.floor(t * 20) + i * 4.1) > 0.45 ? 0.6 * bi + 0.2 * (t > Tc ? 1 : 0) : 0));
      crackle.forEach((q, i) => {
        const on = t > q.t0 && t < D - 0.2 && hash1(Math.floor(t * 17) + i * 3.7) > 0.72;
        q.b.set(1.3, on ? 0.9 * (1 - ramp(t, D - 0.8, D - 0.2)) : 0);
      });
      arcsSrc.forEach((a, i) => a.set(1.3, t > 0.1 && t < Th && hash1(Math.floor(t * 26) + i * 7.3) > 0.45 ? 0.9 * ramp(t, 0.1, 0.4) : 0));
      // ground shockwave across the row
      const k1 = ramp(dc, 0, 0.5);
      const k2 = ramp(dc - 0.18, 0, 0.5);
      waves[0].set(0, yEnd, 160 + 1500 * easeOut3(k1), dc >= 0 ? 0.9 * (1 - k1) : 0, 40 + 230 * easeOut3(k1));
      waves[1].set(0, yEnd, 120 + 1100 * easeOut3(k2), dc - 0.18 >= 0 ? 0.6 * (1 - k2) : 0, 30 + 170 * easeOut3(k2));
      pulses.forEach((p, i) => {
        const ph = (((t - Th) / 0.3 + i / 3) % 1 + 1) % 1;
        p.set(0, yEnd, 200 + 800 * ph, t > Th + 0.1 && t < Tn ? 0.2 * (1 - ph) * live : 0, 40 + 120 * ph);
      });
      if (dc >= 0) {
        const k = ramp(dc, 0, 0.6);
        P.uShock.value.set(shU, shV, easeOut3(k), lerp(0.05, 0.12, k));
        P.uShock2.value.set(0.03 * (1 - k), 0.3 * (1 - k) * (1 - k), 0);
        P.uShockCol.value.setRGB(0.6, 0.75, 1);
      }
      // particles
      for (const s of [stream, ground, spray, embers, shards, linger, smoke]) s.setT(t);
      // scorched ground + glowing embers
      scorch.set(0, rowY - 10, 700, 0.85 * ramp(dc, 0.1, 0.35) * (1 - ramp(t, D - 0.5, D)), 210);
      embGlow.set(0, rowY - 10, 700, 0.85 * ramp(t, tb, tb + 0.2) * (1 - ramp(t, Tc, D)) * (1 - 0.5 * live), 200);
      // cards: all char, glow and break up together inside the beam (whole until the page hands them over at take)
      victims.forEach((v, k) => {
        const k0 = v.card;
        const d = t - Th;
        const dB = t - tb;
        if (dB > 0.7) {
          k0.mesh.visible = false;
          return;
        }
        k0.mesh.renderOrder = 112;
        const ch = ramp(d, 0.03, 0.4);
        const trem = d >= 0 && dB < 0 ? 1 : 0;
        k0.u.uFlashCol.value.setRGB(0.85, 0.92, 1);
        k0.u.uFlash.value = d >= 0 ? 0.95 * Math.exp(-d / 0.09) : 0;
        k0.u.uChar.value = ch * 0.95;
        if (d < 0) {
          k0.u.uRim.value.setRGB(COL[0], COL[1], COL[2]);
          k0.u.uRimAmt.value = 0.6 * ramp(t, v.take, Th);
        } else {
          k0.u.uRim.value.setRGB(1, 0.55, 0.18);
          k0.u.uRimAmt.value = 0.85 * ch * (1 - ramp(d, 0.5, 0.7));
        }
        k0.pose(v.x + Math.sin(t * 95 + k) * 2.4 * trem, v.y + Math.cos(t * 81 + k) * 2 * trem, 1 - 0.02 * trem);
        k0.u.uDissolve.value = ramp(t, tb - 0.02, tb + 0.62);
        k0.u.uDissCol.value.setRGB(1, 0.68, 0.28);
        if (dB >= 0) {
          k0.u.uBreak.value = dB;
          k0.u.uKick.value.set(v.x, v.y + 30);
          k0.u.uPow.value = 0.9;
          k0.u.uGrav.value = 500;
          k0.u.uLife.value = 1.0;
          k0.u.uSpin.value = 12;
          k0.u.uStyle.value = 0;
          k0.u.uDelaySpan.value = 0.12;
          k0.u.uHeatCol.value.setRGB(1, 0.55, 0.15);
        }
      });
      landing.update(t, { alpha: 0.5, col: COL, charred: 0.9 });
    },
  };
};
