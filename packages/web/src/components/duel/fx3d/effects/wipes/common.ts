import * as THREE from "three";
import { clamp01, lerp as lerp01, ramp as ramp01 } from "../../ease";
import type { PostUniforms } from "../../post";
import type { FxScene, FxScenePiece, FxVictim } from "../../types";
import { DEMO_CH, DEMO_CW, DEMO_H, DEMO_W, hash1, timeWarp } from "../../wipe-math";
import type { FxEnv, FxFactory, FxInstance, FxShake } from "../base";

/**
 * The shared part of the wipe scenes (Dark Hole, Raigeki, Heavy Storm, banish, Shock, Torrential).
 * It is a port of .fx-demo/js/core.js and board.js. One file per piece (darkhole.ts, raigeki.ts,
 * storm.ts, banish.ts, shock.ts, torrential.ts) builds a `WipeScene` from a `WipeCtx`. Those files
 * are the only ones a porter edits. Read the contract in each stub before you start.
 *
 * WORLD. Everything a scene draws is in DEMO WORLD UNITS, as in the demo: x right, y UP, a card is
 * 96 x 140, the origin is the middle of all card zones. `ctx.u` is the number of canvas px in one world
 * unit. The root group of the scene has the scale `u`, so meshes, bolts and sprites work as in the demo.
 * Shaders that read `modelMatrix` get px, not world units: use `WORLD_GLSL` (see below).
 *
 * TIME. `update(t)` gets seconds from the start of the piece. Cards are drawn from `victim.take`
 * and must be gone at `victim.gone`. Nothing is drawn for a victim before `take`: the page keeps the
 * card until then.
 */

/* ---------- math (same names as the demo) ---------- */

export const W = DEMO_W;
export const H = DEMO_H;
export const CW = DEMO_CW;
export const CH = DEMO_CH;
export { hash1, timeWarp };

export const clamp = (x: number, a = 0, b = 1): number => (x < a ? a : x > b ? b : x);
export const ramp = ramp01;
export const lerp = lerp01;
export const easeOut3 = (x: number): number => 1 - Math.pow(1 - x, 3);
export const easeIn2 = (x: number): number => x * x;
export const easeIn3 = (x: number): number => x * x * x;
export const easeInOut = (x: number): number => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
/** 0 -> 1 -> 0 over [a, b]. */
export const bump = (t: number, a: number, b: number): number => Math.sin(Math.PI * ramp01(t, a, b));
export const decay = (t: number, t0: number, tau: number): number => (t < t0 ? 0 : Math.exp(-(t - t0) / tau));
export { clamp01 };

/** The random generator of the demo. */
export function mulberry(seed: number): () => number {
  let s = seed | 0;
  return function () {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ---------- GLSL ---------- */

export const GLSL_COMMON = `
mat2 rot2(float a){float c=cos(a),s=sin(a);return mat2(c,s,-s,c);}
float hash21(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}
float vnoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
  return mix(mix(hash21(i),hash21(i+vec2(1,0)),f.x),mix(hash21(i+vec2(0,1)),hash21(i+vec2(1,1)),f.x),f.y);}
float fbm(vec2 p){float a=.5,s=0.;for(int i=0;i<4;i++){s+=a*vnoise(p);p*=2.03;a*=.5;}return s;}
`;

/**
 * For your own ShaderMaterial (Raigeki beam, Torrential tide...). In the vertex shader the demo wrote
 * `vW = (modelMatrix*vec4(position,1.)).xy;` and got world units. Here write
 * `vW = toWorld((modelMatrix*vec4(position,1.)).xy);` and add the uniform `uWorld: ctx.world`.
 * Keep `gl_Position = projectionMatrix*viewMatrix*modelMatrix*vec4(position,1.)` as it is.
 * Put WORLD_GLSL at the top of the vertex shader.
 */
export const WORLD_GLSL = `
uniform vec3 uWorld;
vec2 toWorld(vec2 px){return (px-uWorld.xy)/uWorld.z;}
`;

const CARD_VS = GLSL_COMMON + WORLD_GLSL + `
attribute vec2 aPivot; attribute vec3 aRand;
uniform float uSuck, uSwirl, uBreak, uPow, uGrav, uStyle, uDelaySpan, uLife, uSpin;
uniform vec2 uCore, uKick, uDelayDir, uWind;
varying vec2 vUv, vLocal; varying float vA, vHeat;
void main(){
  vLocal = position.xy; vUv = position.xy + 0.5;
  vec2 cc = toWorld((modelMatrix*vec4(0.,0.,0.,1.)).xy);
  vec2 w  = toWorld((modelMatrix*vec4(position,1.)).xy);
  vec2 pv = toWorld((modelMatrix*vec4(aPivot,0.,1.)).xy);
  float a = 1.; vHeat = 0.;
  if (uBreak >= 0.) {
    float delay = uDelaySpan*(0.5+dot(aPivot,uDelayDir)) + aRand.x*0.05;
    float ts = uBreak - delay;
    if (ts > 0.) {
      vec2 dirOut = pv - uKick; float dl = length(dirOut);
      dirOut = dl > 0.5 ? dirOut/dl : vec2(0.,1.);
      vec2 v;
      if (uStyle < 0.5) v = dirOut*(70.+320.*aRand.y)*uPow + vec2((aRand.z-.5)*110., 80.*aRand.x*uPow);
      else if (uStyle < 1.5) v = uWind*(180.+560.*aRand.y) + vec2((aRand.x-.5)*90., (aRand.z-.15)*190.);
      else v = vec2((aRand.z-.5)*40., 40.+110.*aRand.y);
      vec2 off = v*ts - vec2(0., uGrav)*0.5*ts*ts;
      float ang = (aRand.z-.5)*uSpin*ts;
      vec2 rel = rot2(ang)*(w-pv);
      float k = ts/uLife;
      rel *= 1. - .7*smoothstep(.3,1.,k);
      rel.x *= cos(ts*(2.+6.*aRand.x));
      w = pv + rel + off;
      a *= 1. - smoothstep(.5,1.,k);
      vHeat = (1.-smoothstep(0.,.35,ts))*.8;
    }
  }
  if (uSuck > 0.) {
    vec2 toC = uCore - cc; float D = max(length(toC),1.); vec2 dir = toC/D;
    float s = dot(w-cc, dir)/70.;
    float t = uSuck;
    float f = clamp(t*1.22 + .2*s*sin(3.14159*min(t,1.)), 0., 1.);
    float fe = f*f*(3.-2.*f);
    float pf = pow(fe, 1.5);
    float fc = clamp(t*1.22,0.,1.); fc = fc*fc*(3.-2.*fc);
    vec2 wd = w - uCore; vec2 rh = -dir;
    float q = dot(wd, rh); vec2 p = wd - q*rh;
    q *= (1. - pf);
    p *= (1. - .93*fc*fc);
    float ang = uSwirl*(1.+3.*pf)*pf*3.14159;
    w = uCore + rot2(ang)*(q*rh + p);
    a *= 1. - smoothstep(.9,1.,f);
    vHeat = max(vHeat, fe);
  }
  vA = a;
  gl_Position = projectionMatrix*viewMatrix*vec4(uWorld.xy + w*uWorld.z,0.,1.);
}`;

const CARD_FS = GLSL_COMMON + `
uniform sampler2D uTex;
uniform float uFlash, uChar, uCold, uDissolve, uOpacity, uRimAmt, uSeed, uSoak, uCrack;
uniform vec3 uFlashCol, uRim, uHeatCol, uDissCol;
varying vec2 vUv, vLocal; varying float vA, vHeat;
float sdBox(vec2 p, vec2 b, float r){vec2 q=abs(p)-b+r;return length(max(q,0.))+min(max(q.x,q.y),0.)-r;}
void main(){
  vec3 col = texture2D(uTex, vUv).rgb;
  float d = sdBox(vLocal, vec2(.5), .04);
  float mask = 1. - smoothstep(-.006,.004,d);
  if (uChar > 0.) {
    float n = fbm(vUv*vec2(6.,8.) + uSeed*13.);
    col = mix(col, vec3(.045,.032,.028)*(.5+n), clamp(uChar*(.45+n*.8),0.,.93));
    float cr = smoothstep(.055,0.,abs(fbm(vUv*vec2(9.,12.)+uSeed*7.)-.5)) * uChar;
    col += vec3(1.,.42,.08)*cr*1.7*(.65+.35*sin(uSeed*10.+uChar*18.));
  }
  if (uSoak > 0.) {
    col = mix(col, col*vec3(.6,.8,.95), uSoak*.75);
    float sh = pow(.5+.5*sin(vUv.y*15.+vUv.x*6.+uSeed*9.), 12.);
    col += vec3(.5,.8,1.)*sh*uSoak*.4;
  }
  if (uCrack > 0.) {
    float cw = fbm(vUv*vec2(8.,11.)+uSeed*5.);
    float ck = smoothstep(.025+.075*uCrack, 0., abs(cw-.5));
    col = mix(col, vec3(.86,.97,1.), ck*uCrack*.9);
  }
  if (uCold > 0.) { float l = dot(col, vec3(.3,.59,.11)); col = mix(col, vec3(l)*vec3(.72,.9,1.15)+vec3(.05,.09,.14), uCold*.78); }
  if (uDissolve > 0.) {
    float n = fbm(vUv*vec2(7.,10.) + uSeed*9.);
    float edge = n - (uDissolve*1.15 - .12);
    if (edge < 0.) discard;
    col += uDissCol*smoothstep(.12,0.,edge)*2.6;
  }
  float rim = 1. - smoothstep(0.,.1,-d);
  col += uRim*rim*uRimAmt*1.6;
  col = mix(col, uRim, uRimAmt*.1);
  col = mix(col, uHeatCol, vHeat*.55) + uHeatCol*vHeat*.5*rim;
  col = mix(col, uFlashCol, uFlash);
  gl_FragColor = vec4(col, mask*uOpacity*vA);
}`;

const PART_VS = GLSL_COMMON + WORLD_GLSL + `
attribute vec4 aA, aB, aC, aCol;
uniform float uT, uMode, uDrag; uniform vec2 uG, uCore; uniform vec4 uP;
varying vec2 vUv; varying vec4 vCol; varying float vShape, vU, vSeed;
vec2 posAt(float age, float life){
  float u = clamp(age/life,0.,1.);
  if (uMode < .5) { float k = max(uDrag,.001); return aA.xy + aA.zw*(1.-exp(-k*age))/k + .5*uG*age*age; }
  else if (uMode < 1.5) {
    vec2 d = aA.xy - uCore; float r0 = length(d); float th = atan(d.y,d.x);
    float r = r0*(1.-pow(u,2.)); th += aC.x*(.35*u + 2.2*pow(u,4.));
    return uCore + r*vec2(cos(th),sin(th));
  } else if (uMode < 2.5) {
    vec2 p = aA.xy + aA.zw*age + .5*uG*age*age; vec2 v = aA.zw + uG*age;
    vec2 n = normalize(vec2(-v.y,v.x)+vec2(1e-4));
    return p + n*sin(age*uP.y*(.6+aC.z)+aC.z*40.)*uP.x*(.5+aC.z);
  } else {
    vec2 tgt = aA.zw; vec2 d = tgt - aA.xy; vec2 n = normalize(vec2(-d.y,d.x)+vec2(1e-4));
    float e = pow(u,1.8);
    return mix(aA.xy,tgt,e) + n*sin(u*6.2832*aC.x)*(1.-u)*26.;
  }
}
void main(){
  float age = uT - aB.x, life = aB.y, u = age/life;
  if (age < 0. || u > 1.) { gl_Position = vec4(2.,2.,2.,1.); vU = 2.; return; }
  vec2 p = posAt(age,life), p2 = posAt(max(age-.016,0.),life);
  vec2 vel = (p-p2)/.016; float sp = length(vel);
  float rot = aB.w + aC.x*age; if (aC.y > 0. && sp > 1.) rot = atan(vel.y,vel.x);
  float env = smoothstep(0.,uP.w+1e-4,u)*pow(1.-u,uP.z);
  float size = aB.z*mix(1.,.45,u*u);
  vec2 q = position.xy; q.x *= size*(1.+aC.y*sp*.012); q.y *= size;
  q = rot2(rot)*q;
  gl_Position = projectionMatrix*viewMatrix*vec4(uWorld.xy + (p+q)*uWorld.z,0.,1.);
  vUv = position.xy+.5; vCol = vec4(aCol.rgb, aCol.a*env); vShape = aC.w; vU = u; vSeed = aC.z;
}`;

const PART_FS = `
varying vec2 vUv; varying vec4 vCol; varying float vShape, vU, vSeed;
void main(){
  if (vU > 1.) discard;
  vec2 q = vUv*2.-1.; float r = length(q); float a; vec3 col = vCol.rgb;
  if (vShape < .5) a = exp(-r*r*3.5)*(1.-smoothstep(.85,1.,r));
  else if (vShape < 1.5) a = exp(-q.y*q.y*20.)*(1.-q.x*q.x)*(1.-q.x*q.x);
  else if (vShape < 2.5) a = 1. - smoothstep(.65,.8,abs(q.x)+abs(q.y)*1.4);
  else if (vShape < 3.5) {
    float x = q.x, y = q.y + .28*x*x - .1*x;
    float wd = .42*pow(max(0.,1.-x*x),.6)*(.35+.65*smoothstep(-1.,.3,x));
    float m = 1. - smoothstep(wd-.05,wd,abs(y));
    float barb = .5+.5*sin((x*.8+abs(y)*2.4)*38.);
    col = col*mix(.72,1.,barb) + vec3(.22)*smoothstep(.07,0.,abs(y));
    a = m;
  } else if (vShape < 4.5) a = 1. - smoothstep(.6,.9,r);
  else {
    vec2 A0 = vec2(1., 0.), B0 = vec2(-.8, .65*(.5+vSeed)), C0 = vec2(-.6, -.7*(1.5-vSeed));
    vec2 e0 = B0-A0, e1 = C0-B0, e2 = A0-C0;
    float m = min(min((e0.x*(q.y-A0.y)-e0.y*(q.x-A0.x))/length(e0), (e1.x*(q.y-B0.y)-e1.y*(q.x-B0.x))/length(e1)), (e2.x*(q.y-C0.y)-e2.y*(q.x-C0.x))/length(e2));
    a = smoothstep(0., .05, m);
    float rim = 1. - smoothstep(0., .2, m);
    vec3 pr = .5 + .5*cos(6.2831853*(vSeed*3. + q.x*.25 + vec3(0., .33, .67)));
    col = col*(.5 + .5*(.5+.5*sin(q.x*3.4 + q.y*2.1 + vSeed*21.))) + pr*.3 + vec3(1.)*rim*.65;
  }
  gl_FragColor = vec4(col, a*vCol.a);
}`;

const BOLT_VS = `attribute float aU, aV; varying float vU, vV; void main(){ vU=aU; vV=aV; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`;
const BOLT_FS = `uniform float uReveal, uAlpha; uniform vec3 uCol, uCore; varying float vU, vV;
void main(){
  float head = smoothstep(uReveal, uReveal-.07, vU);
  float core = exp(-pow(abs(vV)*4.2,2.)), glow = exp(-pow(abs(vV)*1.5,2.))*.5;
  vec3 c = mix(uCol, uCore, clamp(core*1.3,0.,1.));
  gl_FragColor = vec4(c, clamp((core*1.25+glow)*uAlpha*head,0.,1.));
}`;
const SPRITE_VS = `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`;
const SPRITE_FS = `uniform sampler2D uMap; uniform vec3 uColor; uniform float uOpacity; varying vec2 vUv;
void main(){ vec4 t = texture2D(uMap, vUv); gl_FragColor = vec4(uColor*t.rgb, t.a*uOpacity); }`;

/* ---------- card ---------- */

type Vec2Tuple = [number, number];
export type Color3 = readonly [number, number, number];

let cardGeom: THREE.BufferGeometry | null = null;

/** A card cut into a triangle soup, deformed in the vertex shader (suck, break, wind). Same as the demo. */
function makeCardGeom(nx = 10, ny = 14): THREE.BufferGeometry {
  const r = mulberry(11);
  const P: Vec2Tuple[][] = [];
  for (let j = 0; j <= ny; j += 1) {
    P[j] = [];
    for (let i = 0; i <= nx; i += 1) {
      let x = i / nx - 0.5;
      let y = j / ny - 0.5;
      if (i > 0 && i < nx) x += ((r() - 0.5) * 0.6) / nx;
      if (j > 0 && j < ny) y += ((r() - 0.5) * 0.6) / ny;
      P[j][i] = [x, y];
    }
  }
  const pos: number[] = [];
  const piv: number[] = [];
  const rnd: number[] = [];
  const tri = (a: Vec2Tuple, b: Vec2Tuple, c: Vec2Tuple): void => {
    const px = (a[0] + b[0] + c[0]) / 3;
    const py = (a[1] + b[1] + c[1]) / 3;
    const rr = [r(), r(), r()];
    for (const p of [a, b, c]) {
      pos.push(p[0], p[1], 0);
      piv.push(px, py);
      rnd.push(...rr);
    }
  };
  for (let j = 0; j < ny; j += 1) {
    for (let i = 0; i < nx; i += 1) {
      const a = P[j][i];
      const b = P[j][i + 1];
      const c = P[j + 1][i + 1];
      const d = P[j + 1][i];
      if ((i + j) % 2) {
        tri(a, b, c);
        tri(a, c, d);
      } else {
        tri(a, b, d);
        tri(b, c, d);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("aPivot", new THREE.Float32BufferAttribute(piv, 2));
  g.setAttribute("aRand", new THREE.Float32BufferAttribute(rnd, 3));
  return g;
}

export type WipeCardOpts = { x: number; y: number; rot?: number; w?: number; h?: number; order?: number };

/**
 * A card drawn on the canvas. Same uniforms as the demo `Card` (uSuck, uBreak, uDissolve, uCold, uChar,
 * uSoak, uCrack, uRim...). Positions are world units. `reset()` runs for victim cards before each frame.
 */
export class WipeCard {
  readonly mesh: THREE.Mesh;
  readonly mat: THREE.ShaderMaterial;
  readonly u: Record<string, THREE.IUniform>;
  readonly base: { x: number; y: number; rot: number; order: number };
  readonly w: number;
  readonly h: number;

  constructor(world: THREE.IUniform<THREE.Vector3>, tex: THREE.Texture, o: WipeCardOpts) {
    cardGeom = cardGeom ?? makeCardGeom();
    this.w = o.w ?? DEMO_CW;
    this.h = o.h ?? DEMO_CH;
    const v2 = (x = 0, y = 0) => new THREE.Vector2(x, y);
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        uWorld: world,
        uTex: { value: tex },
        uSuck: { value: 0 },
        uSwirl: { value: 1 },
        uBreak: { value: -1 },
        uPow: { value: 1 },
        uGrav: { value: 600 },
        uStyle: { value: 0 },
        uDelaySpan: { value: 0 },
        uLife: { value: 1 },
        uSpin: { value: 14 },
        uCore: { value: v2() },
        uKick: { value: v2() },
        uDelayDir: { value: v2(1, 0) },
        uWind: { value: v2(1, 0.2) },
        uFlash: { value: 0 },
        uChar: { value: 0 },
        uCold: { value: 0 },
        uDissolve: { value: 0 },
        uOpacity: { value: 1 },
        uRimAmt: { value: 0 },
        uSeed: { value: 0.5 },
        uSoak: { value: 0 },
        uCrack: { value: 0 },
        uFlashCol: { value: new THREE.Color(1, 1, 1) },
        uRim: { value: new THREE.Color(1, 1, 1) },
        uHeatCol: { value: new THREE.Color(0.65, 0.3, 1) },
        uDissCol: { value: new THREE.Color(0.5, 0.9, 1) },
      },
      vertexShader: CARD_VS,
      fragmentShader: CARD_FS,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    this.u = this.mat.uniforms;
    this.mesh = new THREE.Mesh(cardGeom, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = o.order ?? 10;
    this.base = { x: o.x, y: o.y, rot: o.rot ?? 0, order: o.order ?? 10 };
    this.reset();
  }

  reset(): void {
    const u = this.u;
    u.uSuck.value = 0;
    u.uBreak.value = -1;
    u.uDelaySpan.value = 0;
    u.uFlash.value = 0;
    u.uChar.value = 0;
    u.uCold.value = 0;
    u.uDissolve.value = 0;
    u.uOpacity.value = 1;
    u.uRimAmt.value = 0;
    u.uStyle.value = 0;
    u.uSoak.value = 0;
    u.uCrack.value = 0;
    u.uPow.value = 1;
    u.uGrav.value = 600;
    u.uLife.value = 1;
    u.uSpin.value = 14;
    u.uSwirl.value = 1;
    this.mesh.renderOrder = this.base.order;
    this.pose(this.base.x, this.base.y, 1, this.base.rot, 1);
    this.mesh.visible = true;
  }

  /** x, y: world position. s: scale. rot: radians. sx: extra width scale (a card turning over). */
  pose(x: number, y: number, s = 1, rot: number = this.base.rot, sx = 1): void {
    this.mesh.position.set(x, y, 0);
    this.mesh.rotation.z = rot;
    this.mesh.scale.set(this.w * s * sx, this.h * s, 1);
  }

  setTex(t: THREE.Texture): void {
    this.u.uTex.value = t;
  }

  dispose(): void {
    this.mat.dispose();
  }
}

/* ---------- particles ---------- */

export type ParticleSpec = {
  /** Start position (world units). Mode 3: start. */
  p: Vec2Tuple;
  /** Velocity (world units per second). Mode 3: the target position. */
  v?: Vec2Tuple;
  delay?: number;
  life?: number;
  size?: number;
  rot?: number;
  spin?: number;
  stretch?: number;
  seed?: number;
  /** 0 soft dot, 1 streak, 2 diamond, 3 feather, 4 disc, 5 glass shard. */
  shape?: number;
  col?: [number, number, number, number];
};

export type ParticleOpts = {
  /** 0 ballistic (drag, G), 1 spiral to `core`, 2 wave (P.x amplitude, P.y frequency), 3 curve to target `v`. */
  mode?: number;
  drag?: number;
  G?: Vec2Tuple;
  core?: Vec2Tuple;
  /** P = [wave amp, wave freq, fade power, fade-in fraction]. */
  P?: [number, number, number, number];
  normal?: boolean;
  order?: number;
};

export type WipeParticles = { mesh: THREE.Mesh; setT(t: number): void; dispose(): void };

function makeParticles(world: THREE.IUniform<THREE.Vector3>, n: number, gen: (i: number) => ParticleSpec, o: ParticleOpts = {}): WipeParticles {
  const base = new THREE.PlaneGeometry(1, 1);
  const g = new THREE.InstancedBufferGeometry();
  g.index = base.index;
  g.setAttribute("position", base.getAttribute("position"));
  const A = new Float32Array(n * 4);
  const B = new Float32Array(n * 4);
  const C = new Float32Array(n * 4);
  const K = new Float32Array(n * 4);
  for (let i = 0; i < n; i += 1) {
    const d = gen(i);
    const v = d.v ?? [0, 0];
    A.set([d.p[0], d.p[1], v[0], v[1]], i * 4);
    B.set([d.delay ?? 0, d.life ?? 1, d.size ?? 8, d.rot ?? 0], i * 4);
    C.set([d.spin ?? 0, d.stretch ?? 0, d.seed ?? Math.random(), d.shape ?? 0], i * 4);
    K.set(d.col ?? [1, 1, 1, 1], i * 4);
  }
  g.setAttribute("aA", new THREE.InstancedBufferAttribute(A, 4));
  g.setAttribute("aB", new THREE.InstancedBufferAttribute(B, 4));
  g.setAttribute("aC", new THREE.InstancedBufferAttribute(C, 4));
  g.setAttribute("aCol", new THREE.InstancedBufferAttribute(K, 4));
  g.instanceCount = n;
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uWorld: world,
      uT: { value: -9 },
      uMode: { value: o.mode ?? 0 },
      uDrag: { value: o.drag ?? 0 },
      uG: { value: new THREE.Vector2(...(o.G ?? [0, 0])) },
      uCore: { value: new THREE.Vector2(...(o.core ?? [0, 0])) },
      uP: { value: new THREE.Vector4(...(o.P ?? [0, 0, 1, 0.1])) },
    },
    vertexShader: PART_VS,
    fragmentShader: PART_FS,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: o.normal ? THREE.NormalBlending : THREE.AdditiveBlending,
  });
  const mesh = new THREE.Mesh(g, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = o.order ?? 120;
  return {
    mesh,
    setT: (t) => {
      mat.uniforms.uT.value = t;
    },
    dispose: () => {
      g.dispose();
      base.dispose();
      mat.dispose();
    },
  };
}

/* ---------- bolts ---------- */

export type Pt = { x: number; y: number };
export type BoltGeo = { parts: Array<{ pts: Pt[]; u0: number; w: number }>; total: number };

export function jagged(a: Pt, b: Pt, seg: number, amp: number, rand: () => number): Pt[] {
  const pts: Pt[] = [{ x: a.x, y: a.y }];
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  let off = 0;
  for (let i = 1; i < seg; i += 1) {
    const t = i / seg;
    off = off * 0.5 + (rand() - 0.5) * amp;
    pts.push({ x: a.x + dx * t + nx * off, y: a.y + dy * t + ny * off });
  }
  pts.push({ x: b.x, y: b.y });
  return pts;
}

export function forkedBolt(a: Pt, b: Pt, rand: () => number, o: { seg?: number; amp?: number; forks?: number } = {}): BoltGeo {
  const seg = o.seg ?? 14;
  const amp = o.amp ?? 46;
  const forks = o.forks ?? 4;
  const main = jagged(a, b, seg, amp, rand);
  const parts: BoltGeo["parts"] = [{ pts: main, u0: 0, w: 1 }];
  const cum: number[] = [0];
  for (let i = 1; i < main.length; i += 1) cum[i] = cum[i - 1] + Math.hypot(main[i].x - main[i - 1].x, main[i].y - main[i - 1].y);
  const total = cum[cum.length - 1] || 1;
  const mkBranch = (from: Pt, ang0: number, len: number, u0: number, w: number, depth: number): void => {
    const ang = ang0 + (rand() < 0.5 ? -1 : 1) * (0.35 + rand() * 0.55);
    const to = { x: from.x + Math.cos(ang) * len, y: from.y + Math.sin(ang) * len };
    const pts = jagged(from, to, 7, amp * 0.5, rand);
    parts.push({ pts, u0, w });
    if (depth < 1 && rand() < 0.55) {
      const k = 2 + Math.floor(rand() * 3);
      mkBranch(pts[k], ang, len * 0.55, u0 + (len * k) / 7 / total, w * 0.6, depth + 1);
    }
  };
  for (let f = 0; f < forks; f += 1) {
    const k = 2 + Math.floor(rand() * (seg - 4));
    const dir = Math.atan2(b.y - a.y, b.x - a.x);
    mkBranch(main[k], dir, 70 + rand() * 150, cum[k] / total, 0.5, 0);
  }
  return { parts, total };
}

export type WipeBolt = { mesh: THREE.Mesh; set(reveal: number, alpha: number): void; dispose(): void };

export function makeBolt(geo: BoltGeo, width: number, col: Color3, core: Color3): WipeBolt {
  const pos: number[] = [];
  const U: number[] = [];
  const V: number[] = [];
  const idx: number[] = [];
  for (const part of geo.parts) {
    const pts = part.pts;
    const base = pos.length / 3;
    const hw = width * part.w * 3.2;
    let cum = 0;
    for (let i = 0; i < pts.length; i += 1) {
      if (i) cum += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
      const p0 = pts[Math.max(i - 1, 0)];
      const p1 = pts[Math.min(i + 1, pts.length - 1)];
      let nx = -(p1.y - p0.y);
      let ny = p1.x - p0.x;
      const l = Math.hypot(nx, ny) || 1;
      nx /= l;
      ny /= l;
      const taper = part.u0 > 0 ? 1 - 0.7 * (i / (pts.length - 1)) : 1;
      pos.push(pts[i].x + nx * hw * taper, pts[i].y + ny * hw * taper, 0, pts[i].x - nx * hw * taper, pts[i].y - ny * hw * taper, 0);
      const u = part.u0 + cum / geo.total;
      U.push(u, u);
      V.push(1, -1);
      if (i) {
        const a = base + (i - 1) * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("aU", new THREE.Float32BufferAttribute(U, 1));
  g.setAttribute("aV", new THREE.Float32BufferAttribute(V, 1));
  g.setIndex(idx);
  const mat = new THREE.ShaderMaterial({
    uniforms: { uReveal: { value: 0 }, uAlpha: { value: 0 }, uCol: { value: new THREE.Color(...col) }, uCore: { value: new THREE.Color(...core) } },
    vertexShader: BOLT_VS,
    fragmentShader: BOLT_FS,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(g, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 130;
  mesh.visible = false;
  return {
    mesh,
    set(reveal, alpha) {
      mat.uniforms.uReveal.value = reveal;
      mat.uniforms.uAlpha.value = alpha;
      mesh.visible = alpha > 0.003 && reveal > 0;
    },
    dispose() {
      g.dispose();
      mat.dispose();
    },
  };
}

/* ---------- sprites ---------- */

export type WipeSprite = {
  mesh: THREE.Mesh;
  /** x, y: world. w: width (world units). op: opacity. h: height (default w). */
  set(x: number, y: number, w: number, op: number, h?: number): void;
  color(c: Color3): void;
  dispose(): void;
};

function makeSprite(tex: THREE.Texture, color: Color3, o: { normal?: boolean; order?: number } = {}): WipeSprite {
  const geo = new THREE.PlaneGeometry(1, 1);
  const mat = new THREE.ShaderMaterial({
    uniforms: { uMap: { value: tex }, uColor: { value: new THREE.Color(...color) }, uOpacity: { value: 0 } },
    vertexShader: SPRITE_VS,
    fragmentShader: SPRITE_FS,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: o.normal ? THREE.NormalBlending : THREE.AdditiveBlending,
  });
  const m = new THREE.Mesh(geo, mat);
  m.renderOrder = o.order ?? 110;
  m.visible = false;
  m.frustumCulled = false;
  return {
    mesh: m,
    set(x, y, w, op, h = w) {
      m.position.set(x, y, 0);
      m.scale.set(w, h, 1);
      mat.uniforms.uOpacity.value = clamp(op);
      m.visible = op > 0.004 && w > 0;
    },
    color(c) {
      (mat.uniforms.uColor.value as THREE.Color).setRGB(c[0], c[1], c[2]);
    },
    dispose() {
      geo.dispose();
      mat.dispose();
    },
  };
}

/** The soft glow and the ring of the demo (256 px canvas textures). */
function makeSpriteTex(kind: "soft" | "ring"): THREE.Texture {
  const n = 256;
  const cv = document.createElement("canvas");
  cv.width = n;
  cv.height = n;
  const g = cv.getContext("2d");
  if (g) {
    const gr = g.createRadialGradient(n / 2, n / 2, kind === "ring" ? n * 0.3 : 0, n / 2, n / 2, n / 2);
    if (kind === "soft") {
      gr.addColorStop(0, "rgba(255,255,255,1)");
      gr.addColorStop(0.25, "rgba(255,255,255,0.55)");
      gr.addColorStop(0.6, "rgba(255,255,255,0.14)");
      gr.addColorStop(1, "rgba(255,255,255,0)");
    } else {
      gr.addColorStop(0, "rgba(255,255,255,0)");
      gr.addColorStop(0.6, "rgba(255,255,255,0.12)");
      gr.addColorStop(0.86, "rgba(255,255,255,1)");
      gr.addColorStop(0.93, "rgba(255,255,255,0.35)");
      gr.addColorStop(1, "rgba(255,255,255,0)");
    }
    g.fillStyle = gr;
    g.fillRect(0, 0, n, n);
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

/** The card back source: the same SVG the field uses (public/duel/card-back-main.svg), drawn once at this size. */
const BACK_W = 256;
const BACK_H = 373;
const BACK_SRC = "/duel/card-back-main.svg";
let backImage: Promise<HTMLImageElement | null> | null = null;

/** Loads the card back SVG once. Resolves null when it cannot load (the plain fallback stays). */
function loadBackImage(): Promise<HTMLImageElement | null> {
  if (!backImage) {
    backImage = new Promise((resolve) => {
      if (typeof Image === "undefined") return resolve(null);
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = BACK_SRC;
    });
  }
  return backImage;
}

/**
 * A card back, for a card whose art has not arrived (or has no passcode). It draws a plain back at
 * once and swaps in the same design as the field card back when the SVG has loaded.
 */
function makeBackTexture(): THREE.Texture {
  const cv = document.createElement("canvas");
  cv.width = BACK_W;
  cv.height = BACK_H;
  const g = cv.getContext("2d");
  if (g) {
    g.fillStyle = "#160b05";
    g.fillRect(0, 0, BACK_W, BACK_H);
    g.strokeStyle = "#c9a45a";
    g.lineWidth = 12;
    g.strokeRect(6, 6, BACK_W - 12, BACK_H - 12);
    const gr = g.createRadialGradient(BACK_W / 2, BACK_H / 2, 12, BACK_W / 2, BACK_H / 2, 108);
    gr.addColorStop(0, "#9b4a1d");
    gr.addColorStop(1, "#160b05");
    g.fillStyle = gr;
    g.beginPath();
    g.ellipse(BACK_W / 2, BACK_H / 2, 80, 124, 0, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = "#c9a45a";
    g.lineWidth = 6;
    g.stroke();
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.NoColorSpace;
  let disposed = false;
  const dispose = t.dispose.bind(t);
  t.dispose = () => {
    disposed = true;
    dispose();
  };
  void loadBackImage().then((img) => {
    if (!img || disposed || !g) return;
    g.clearRect(0, 0, BACK_W, BACK_H);
    g.drawImage(img, 0, 0, BACK_W, BACK_H);
    t.needsUpdate = true;
  });
  return t;
}

/* ---------- shake ---------- */

/** One shake impulse, in seconds and world units, as in the demo. kind: "decay" starts hard, "swell" rises and falls. */
export type ShakeImpulse = { t: number; dur: number; amp: number; kind?: "decay" | "swell"; freq?: number };

/** Port of the demo `shakeAt`: world units (x, y) and radians (z) at time t. */
export function shakeAt(imps: readonly ShakeImpulse[], t: number): [number, number, number] {
  let x = 0;
  let y = 0;
  let z = 0;
  for (const s of imps) {
    const k = (t - s.t) / s.dur;
    if (k < 0 || k > 1) continue;
    const env = (s.kind === "swell" ? Math.sin(Math.PI * k) : Math.pow(1 - k, 2)) * s.amp;
    const f = s.freq ?? 38;
    const ph = s.t * 7.1;
    x += env * (Math.sin(t * f + ph) + 0.5 * Math.sin(t * f * 2.3 + ph * 2));
    y += env * (Math.cos(t * f * 1.17 + ph) + 0.5 * Math.sin(t * f * 2.9 + ph));
    z += env * 0.0012 * Math.sin(t * f * 0.8 + ph);
  }
  return [x, y, z];
}

/* ---------- the context ---------- */

/** A victim of the wipe: the card on the board that the piece takes. All times are seconds from the start of the piece. */
export type WipeVictim = {
  i: number;
  code: number;
  card: WipeCard;
  /** Position (world units). */
  x: number;
  y: number;
  /** The card lies in Defense Position (rotated a quarter turn). */
  def: boolean;
  /** The card is a Spell or Trap in a spell/trap zone. */
  st: boolean;
  /** Controller side of the card relative to the viewer. */
  side: "you" | "opp";
  /** The art that is on the card now (changes when the full image arrives). */
  tex: THREE.Texture;
  /** The canvas starts to draw the card. Before this nothing is drawn for it. */
  take: number;
  /** The card must be gone from the field here (hide it: `card.mesh.visible = false`). */
  gone: number;
  /** The landing streak leaves (to the pile), and arrives (the page pile shows the card then). */
  land: number;
  end: number;
  /** Where the pile is (world units), or null when the page has no pile to aim at. */
  pile: Pt | null;
};

export type WorldRectU = { minX: number; maxX: number; minY: number; maxY: number };

export type WipeCtx = {
  piece: FxScenePiece;
  /** The plan (times in ms, tint, rects in canvas px). Read-only. */
  scene: FxScene;
  /** Length of the piece in seconds (`scene.totalMs / 1000`). `update(t)` never gets more. */
  duration: number;
  victims: WipeVictim[];
  /** The card that caused the piece (its zone), or null when it is not on the board. */
  source: Pt | null;
  ownerSide: "you" | "opp";
  /** The seeded random generator of the piece (same seed, same look). */
  rand: () => number;
  /** Soft glow and ring textures for sprites. */
  tex: { soft: THREE.Texture; ring: THREE.Texture };
  /** The post pass uniforms, like `c.post` in the demo: `P.uDarken.value = 0.3`. Reset before every frame. */
  post: PostUniforms;
  /** Shared uniform of every shader that reads `modelMatrix` (see WORLD_GLSL). */
  world: THREE.IUniform<THREE.Vector3>;
  /** Canvas px per world unit. */
  u: number;
  /** The part of the world the canvas shows. Fill the whole screen with it: the demo used x +-560, y +-400. */
  bounds: WorldRectU;
  /** Rows of zones in world units per side (null when the board has none). */
  rows: Record<"you" | "opp", { m: WorldRectU | null; st: WorldRectU | null }>;
  /** Cell centres of the monster and spell/trap zones (an estimate from the rows). Use them like ZONE_CENTERS in the demo. */
  zones: Pt[];
  /** World position to uv (0..1, y up) of the canvas: for `P.uCore`, `P.uShock`, `P.uGust`. */
  uv(x: number, y: number): [number, number];
  /** A particle count scaled by the quality of the canvas (fewer on slow machines). */
  count(n: number): number;
  /** Adds a mesh you made yourself (a beam quad...) to the scene. `dispose` runs when the piece ends. */
  addMesh<T extends THREE.Object3D>(mesh: T, dispose?: () => void): T;
  /** Adds an object with `.mesh` and `.dispose()` (sprite, particles, bolt, card) and returns it, like `c.add` in the demo. */
  add<T extends { mesh: THREE.Object3D; dispose?: () => void }>(x: T): T;
  sprite(tex: THREE.Texture, color: Color3, o?: { normal?: boolean; order?: number }): WipeSprite;
  particles(n: number, gen: (i: number) => ParticleSpec, o?: ParticleOpts): WipeParticles;
  bolt(geo: BoltGeo, width: number, col: Color3, core: Color3): WipeBolt;
  /** An extra card (not a victim), for example a copy of the source card. */
  card(tex: THREE.Texture, o: WipeCardOpts): WipeCard;
  /**
   * The landing streaks: ghost cards fly from each victim to its pile, from `victim.land` to `victim.end`.
   * Call `update(t, o)` every frame. The page pile takes the card at `victim.end`, so nothing else is needed.
   */
  landing(o?: LandingOpts): Landing;
  /** Fixed false: wipes never run with reduced motion (the page uses its plain path then). Kept so the demo variants port 1:1. */
  readonly reduced: false;
};

export type LandingOpts = {
  /** Where each streak starts: default is the victim position. */
  from?: (v: WipeVictim) => Pt;
  /** Pulse ring at the pile when the card arrives (default true). */
  pulse?: boolean;
};

export type LandingUpdate = { alpha?: number; col?: Color3; cold?: number; charred?: number; rimAmt?: number };
export type Landing = { update(t: number, o?: LandingUpdate): void };

export type WipeScene = {
  /** Draw the piece at time t (seconds). Pure in t: it is called with any t, in order or not. */
  update(t: number): void;
  /** Board shake impulses, as in the demo. The engine moves the page board and the canvas with them (scaled by the shake preference). */
  shakes?: ShakeImpulse[];
  /** Free what you made outside `ctx.add` / `ctx.addMesh` (rare). */
  dispose?: () => void;
};

export type WipeBuild = (ctx: WipeCtx) => WipeScene;

const rectCentre = (r: { x: number; y: number; w: number; h: number }): Pt => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

/** What the engine runs. `built` is what `build` returned. */
type Made = { ctx: WipeCtx; frame(t: number, wipe: WipeScene): void; dispose(): void; root: THREE.Group };

export function createWipeCtx(env: FxEnv, request: { seed?: number }, scene: FxScene): Made {
  const view = env.view;
  const fallback = scene.field;
  const wd = scene.world ?? { cx: fallback.x + fallback.w / 2, cy: fallback.y + fallback.h / 2, u: 1, vw: view.w, vh: view.h };
  const u = Math.max(0.05, wd.u);
  const ox = wd.cx;
  const oy = view.h - wd.cy;
  const root = new THREE.Group();
  root.position.set(ox, oy, 0);
  root.scale.set(u, u, 1);
  env.group.add(root);
  const world: THREE.IUniform<THREE.Vector3> = { value: new THREE.Vector3(ox, oy, u) };
  env.post.uK.value = view.h / (DEMO_H * u);

  const disposers: Array<() => void> = [];
  const soft = makeSpriteTex("soft");
  const ring = makeSpriteTex("ring");
  const back = makeBackTexture();
  disposers.push(() => soft.dispose(), () => ring.dispose(), () => back.dispose());

  const toWorld = (px: number, py: number): Pt => ({ x: (px - wd.cx) / u, y: (wd.cy - py) / u });
  const rectU = (r: { x: number; y: number; w: number; h: number } | null | undefined): WorldRectU | null => {
    if (!r) return null;
    const a = toWorld(r.x, r.y);
    const b = toWorld(r.x + r.w, r.y + r.h);
    return { minX: Math.min(a.x, b.x), maxX: Math.max(a.x, b.x), minY: Math.min(a.y, b.y), maxY: Math.max(a.y, b.y) };
  };
  const sideRows = (s: "you" | "opp") => ({ m: rectU(scene.rows?.[s].m), st: rectU(scene.rows?.[s].st) });
  const rows = { you: sideRows("you"), opp: sideRows("opp") };
  const bounds: WorldRectU = { minX: (0 - wd.cx) / u, maxX: (view.w - wd.cx) / u, minY: (wd.cy - view.h) / u, maxY: wd.cy / u };
  const zones: Pt[] = [];
  for (const side of ["you", "opp"] as const) {
    for (const row of [rows[side].m, rows[side].st]) {
      if (!row) continue;
      const n = Math.max(1, Math.round((row.maxX - row.minX) / (DEMO_CW * 1.19)));
      const step = (row.maxX - row.minX) / n;
      const y = (row.minY + row.maxY) / 2;
      for (let i = 0; i < n; i += 1) zones.push({ x: row.minX + step * (i + 0.5), y });
    }
  }

  const add: WipeCtx["add"] = (x) => {
    root.add(x.mesh);
    if (x.dispose) disposers.push(() => x.dispose?.());
    return x;
  };
  const addMesh: WipeCtx["addMesh"] = (mesh, dispose) => {
    root.add(mesh);
    if (dispose) disposers.push(dispose);
    return mesh;
  };

  const rand = mulberry(((request.seed ?? 1) * 2654435761) | 0 || 20240615);

  const victims: WipeVictim[] = scene.victims.map((v: FxVictim, i) => {
    const p = toWorld(v.rect.x + v.rect.w / 2, v.rect.y + v.rect.h / 2);
    const cw = Math.max(8, Math.min(v.rect.w, v.rect.h) / u);
    const ch = Math.max(cw, Math.max(v.rect.w, v.rect.h) / u);
    const tex = (v.code > 0 ? env.art.peek(v.code) : null) ?? back;
    const rot = (v.defense ? Math.PI / 2 : 0) + (v.turned ? Math.PI : 0);
    const card = new WipeCard(world, tex, { x: p.x, y: p.y, rot, w: cw, h: ch, order: 10 + i });
    root.add(card.mesh);
    disposers.push(() => card.dispose());
    const pile = v.pile ? toWorld(v.pile.x + v.pile.w / 2, v.pile.y + v.pile.h / 2) : null;
    return {
      i,
      code: v.code,
      card,
      x: p.x,
      y: p.y,
      def: v.defense,
      st: v.st === true,
      side: scene.ownerSide,
      tex,
      take: (v.takeMs ?? 0) / 1000,
      gone: v.atMs / 1000,
      land: (v.landMs ?? v.atMs) / 1000,
      end: (v.endMs ?? v.atMs + 600) / 1000,
      pile,
    };
  });
  // The side of a victim: the owner side is the side of the effect; a card on the other half of the board is the other side.
  const centreY = rows.you.m ? (rows.you.m.minY + rows.you.m.maxY) / 2 : -1;
  victims.forEach((v) => {
    v.side = v.y <= (rows.you.m || rows.opp.m ? (centreY + (rows.opp.m ? (rows.opp.m.minY + rows.opp.m.maxY) / 2 : centreY + 1)) / 2 : 0) ? "you" : "opp";
  });

  const source = scene.source ? (() => { const c = rectCentre(scene.source); return toWorld(c.x, c.y); })() : null;

  const sync = (): void => {
    for (const v of victims) {
      if (v.code <= 0) continue;
      const t = env.art.peek(v.code);
      if (t && t !== v.tex) {
        v.tex = t;
        v.card.setTex(t);
      }
    }
  };

  const ctx: WipeCtx = {
    piece: scene.piece,
    scene,
    duration: scene.totalMs / 1000,
    victims,
    source,
    ownerSide: scene.ownerSide,
    rand,
    tex: { soft, ring },
    post: env.post,
    world,
    u,
    bounds,
    rows,
    zones,
    uv: (x, y) => [(ox + x * u) / view.w, (oy + y * u) / view.h],
    count: (n) => Math.max(6, Math.round(n * env.quality)),
    addMesh,
    add,
    sprite: (tex, color, o) => add(makeSprite(tex, color, o)),
    particles: (n, gen, o) => add(makeParticles(world, n, gen, o)),
    bolt: (geo, width, col, core) => add(makeBolt(geo, width, col, core)),
    card: (tex, o) => add(new WipeCard(world, tex, o)),
    landing: (opts = {}) => makeLanding(ctx, opts),
    reduced: false,
  };

  const frame = (t: number, wipe: WipeScene): void => {
    sync();
    for (const v of victims) v.card.reset();
    wipe.update(t);
    // The page owns the card before `take` and the pile owns it from `end`: the canvas card is never seen outside [take, gone].
    for (const v of victims) {
      if (t < v.take || t >= v.gone) v.card.mesh.visible = false;
    }
  };

  return {
    ctx,
    frame,
    root,
    dispose() {
      env.group.remove(root);
      root.clear();
      for (const d of disposers) {
        try {
          d();
        } catch {
          // a resource that is already gone
        }
      }
      disposers.length = 0;
    },
  };
}

/* ---------- landing ---------- */

function makeLanding(ctx: WipeCtx, opts: LandingOpts): Landing {
  const echoes = 3;
  const items = ctx.victims
    .filter((v) => v.pile != null)
    .map((v) => {
      const ghosts: WipeCard[] = [];
      for (let e = 0; e <= echoes; e += 1) {
        const g = ctx.card(v.tex, { x: 0, y: 0, order: 60 - e, w: v.card.w, h: v.card.h });
        g.mesh.visible = false;
        ghosts.push(g);
      }
      const pulse = opts.pulse === false ? null : ctx.sprite(ctx.tex.ring, [1, 1, 1]);
      return { v, ghosts, pulse };
    });
  const bez = (a: Pt, b: Pt, cp: Pt, k: number): Pt => ({
    x: (1 - k) * (1 - k) * a.x + 2 * (1 - k) * k * cp.x + k * k * b.x,
    y: (1 - k) * (1 - k) * a.y + 2 * (1 - k) * k * cp.y + k * k * b.y,
  });
  return {
    update(t, o = {}) {
      const { alpha = 0.55, col = [1, 1, 1] as Color3, cold = 0, charred = 0, rimAmt = 0.8 } = o;
      items.forEach(({ v, ghosts, pulse }, i) => {
        const pile = v.pile as Pt;
        const from = opts.from ? opts.from(v) : { x: v.x, y: v.y };
        const dur = Math.max(0.2, v.end - v.land);
        const mid = { x: (from.x + pile.x) / 2, y: (from.y + pile.y) / 2 + (pile.y > from.y ? -50 : 50) };
        ghosts.forEach((g, e) => {
          const k = clamp((t - v.land - e * 0.045) / dur);
          const on = k > 0 && k < 1;
          g.mesh.visible = on;
          if (!on) return;
          if (g.u.uTex.value !== v.tex) g.setTex(v.tex);
          const p = bez(from, pile, { x: mid.x + (pile.x - from.x) * 0.1, y: mid.y }, easeInOut(k));
          g.pose(p.x, p.y, lerp(0.95, 0.66, k), 0.5 * Math.sin(k * Math.PI) * (i % 2 ? 1 : -1) * 0.5);
          g.u.uOpacity.value = alpha * (1 - e * 0.24) * Math.min(ramp(k, 0, 0.12), 1 - ramp(k, 0.82, 1));
          (g.u.uRim.value as THREE.Color).setRGB(col[0], col[1], col[2]);
          g.u.uRimAmt.value = rimAmt;
          g.u.uCold.value = cold;
          g.u.uChar.value = charred;
        });
        if (pulse) {
          // The ring lasts up to 0.5 s but never past the end of the piece: nothing stays lit on the last frame.
          const pd = Math.min(0.5, ctx.duration - v.end - 0.01);
          const pk = pd > 0.05 ? 1 - (t - v.end) / pd : 0;
          pulse.color(col);
          pulse.set(pile.x, pile.y, pk > 0 && pk < 1 ? 70 + 240 * (1 - pk) : 0, pk > 0 ? pk * 0.7 : 0);
        }
      });
    },
  };
}

/* ---------- ready-made pieces for the stubs and the lab ---------- */

/**
 * The simplest honest wipe: every card stays whole until `gone - 0.3`, fades away, then streaks to its pile.
 * The stubs return it, so the app works from the first day. A real scene replaces it.
 */
export function basicWipe(ctx: WipeCtx): WipeScene {
  const landing = ctx.landing();
  return {
    update(t) {
      for (const v of ctx.victims) {
        const k = ramp(t, v.gone - 0.3, v.gone);
        v.card.u.uOpacity.value = 1 - k;
        v.card.u.uRimAmt.value = 0.6 * k;
        (v.card.u.uRim.value as THREE.Color).setRGB(ctx.scene.tint.main[0], ctx.scene.tint.main[1], ctx.scene.tint.main[2]);
      }
      landing.update(t, { col: ctx.scene.tint.main });
    },
  };
}

/** Wraps a `WipeBuild` into the factory the engine runs. Used by effects/scene.ts. */
export function wipeFactory(build: WipeBuild): FxFactory {
  return (env, request): FxInstance => {
    const scene = request.scene;
    if (!scene) return { durationMs: 1, update() {}, dispose() {} };
    const made = createWipeCtx(env, request, scene);
    let wipe: WipeScene;
    try {
      wipe = build(made.ctx);
    } catch (error) {
      made.dispose();
      throw error;
    }
    const impulses = wipe.shakes ?? [];
    const duration = made.ctx.duration;
    return {
      durationMs: scene.totalMs,
      usesPost: true,
      shake(sec): FxShake {
        if (impulses.length === 0) return { x: 0, y: 0, rot: 0 };
        const [x, y, z] = shakeAt(impulses, sec);
        return { x: x * made.ctx.u, y: -y * made.ctx.u, rot: z };
      },
      update(sec) {
        made.frame(Math.min(sec, duration), wipe);
      },
      dispose() {
        try {
          wipe.dispose?.();
        } finally {
          made.dispose();
        }
      },
    };
  };
}
