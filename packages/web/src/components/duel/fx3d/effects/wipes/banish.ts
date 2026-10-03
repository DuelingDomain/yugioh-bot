import * as THREE from "three";
import {
  GLSL_COMMON,
  bump,
  clamp,
  decay,
  easeIn3,
  easeOut3,
  mulberry,
  ramp,
  type Color3,
  type ShakeImpulse,
  type WipeBuild,
  type WipeCtx,
  type WipeScene,
} from "./common";

/**
 * Banish all (piece banish-all): one chain link banishes or sends two or more cards from the field.
 * Port of sceneBanish and makeRift of the demo (.fx-demo/js/scenes.js): a dimensional rift opens in the
 * middle of the board, every card goes cold and dissolves into it, the rift slams shut with a shockwave,
 * and the cards streak to their banished pile (or graveyard).
 *
 * Differences from the demo, all forced by the page owning the cards:
 *  - The cards are drawn from `v.take` (= the demo cold start) and are gone at `v.gone` (= dissolve end).
 *    The break time of a card is `v.gone - 0.65`, the demo `o.s`.
 *  - The source card is not lifted (it is a DOM card): its aura and slam ring are drawn on it instead.
 *  - The source card does not fly to the graveyard here (the page moves it).
 */

const RIFT_VS = `varying vec2 vW; varying float vV; attribute float aV; void main(){ vW=position.xy; vV=aV; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`;
const RIFT_FS =
  GLSL_COMMON +
  `uniform float uTime, uOpen; varying vec2 vW; varying float vV;
void main(){
  float e = pow(abs(vV), 4.);
  vec2 q = vW*.22 + vec2(0., uTime*.8);
  float star = step(.987, hash21(floor(q)))*(.5+.5*sin(uTime*9.+hash21(floor(q))*40.));
  float neb = fbm(vW*.012 + uTime*.15);
  vec3 inner = mix(vec3(.02,.03,.11), vec3(.12,.2,.5), neb*.8) + vec3(.8,.95,1.)*star;
  vec3 col = mix(inner, vec3(.85,.98,1.), e*1.5);
  float a = (1. - smoothstep(.9,1.,abs(vV)))*clamp(uOpen*3.,0.,1.);
  gl_FragColor = vec4(col, a);
}`;

type Rift = { mesh: THREE.Mesh; update(open: number, t: number, x0?: number, halfLen?: number, wmax?: number): void; dispose(): void };

/** The jagged vertical rift: a ribbon of `n` segments whose width follows a lens profile. */
function makeRift(n = 44): Rift {
  const g = new THREE.BufferGeometry();
  const pos = new Float32Array((n + 1) * 6);
  const V: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= n; i += 1) {
    V.push(-1, 1);
    if (i) {
      const a = (i - 1) * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("aV", new THREE.Float32BufferAttribute(V, 1));
  g.setIndex(idx);
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uOpen: { value: 0 } },
    vertexShader: RIFT_VS,
    fragmentShader: RIFT_FS,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(g, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 105;
  mesh.visible = false;
  const rr = mulberry(77);
  const jit = Array.from({ length: n + 1 }, () => [rr(), rr() - 0.5]);
  return {
    mesh,
    update(open, t, x0 = 0, halfLen = 380, wmax = 46) {
      const p = g.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i <= n; i += 1) {
        const k = (i / n) * 2 - 1;
        const y = k * halfLen * Math.min(1, open * 1.6);
        const prof = Math.pow(Math.max(0, 1 - k * k), 0.7);
        const hw = wmax * open * prof * (0.55 + 0.6 * jit[i][0]);
        const xj = x0 + jit[i][1] * 30 * open + Math.sin(t * 6 + i) * 2 * open;
        p.setXYZ(i * 2, xj - hw, y, 0);
        p.setXYZ(i * 2 + 1, xj + hw, y, 0);
      }
      p.needsUpdate = true;
      mat.uniforms.uTime.value = t;
      mat.uniforms.uOpen.value = open;
      mesh.visible = open > 0.01;
    },
    dispose() {
      g.dispose();
      mat.dispose();
    },
  };
}

const COL: Color3 = [0.55, 0.85, 1];
/** Seconds a card takes to dissolve (the demo `o.s + 0.65` is the moment it is gone). */
const DISSOLVE = 0.65;

export const buildBanish: WipeBuild = (ctx: WipeCtx): WipeScene => {
  const r = ctx.rand;
  const P = ctx.post;
  const { bounds, victims } = ctx;
  const D = Math.max(0.5, Math.min(2.85, ctx.duration));
  // Break time of each card: the demo `o.s`. Taken from the plan.
  const info = victims.map((v) => ({ v, s: v.gone - DISSOLVE }));
  const tEnd = Math.max(1.3, ...info.map((o) => o.s + DISSOLVE));
  const tClose = tEnd + 0.05;
  const tCloseEnd = tClose + 0.38;
  const shockEnd = Math.max(tClose + 0.3, Math.min(tClose + 0.95, ctx.duration));

  // The rift fills the height of the canvas like the demo's (380 of a 400 half height).
  const halfH = Math.max(Math.abs(bounds.minY), Math.abs(bounds.maxY), 400);
  const hs = halfH / 400;
  const halfLen = 380 * hs;
  const [cu, cv] = ctx.uv(0, 0);

  const rift = makeRift();
  ctx.addMesh(rift.mesh, () => rift.dispose());
  const beam = ctx.sprite(ctx.tex.soft, [0.6, 0.9, 1]);
  const halo = ctx.sprite(ctx.tex.soft, [0.4, 0.7, 1]);
  const pulse = ctx.sprite(ctx.tex.ring, [0.85, 0.97, 1]);
  const aura = ctx.sprite(ctx.tex.soft, COL);
  const slam = ctx.sprite(ctx.tex.ring, COL);

  const per = ctx.count(55);
  const motes = ctx.particles(
    info.length * per + 1,
    (i) => {
      const o = info[Math.floor(i / per)];
      if (!o) return { p: [0, 0], v: [0, 0], delay: 99, life: 1 };
      const px = o.v.x + (r() - 0.5) * o.v.card.w * 0.9;
      const py = o.v.y + (r() - 0.5) * o.v.card.h * 0.9;
      return {
        p: [px, py],
        v: [(r() - 0.5) * 18, py + (r() - 0.5) * 50],
        delay: o.s + r() * 0.3,
        life: 0.55 + r() * 0.35,
        size: 5 + r() * 8,
        seed: r(),
        spin: 1 + Math.floor(r() * 3),
        shape: r() < 0.3 ? 2 : 0,
        col: r() < 0.5 ? [0.7, 0.92, 1, 1] : [1, 1, 1, 1],
      };
    },
    { mode: 3, P: [0, 0, 0.4, 0.1] },
  );
  const area = clamp(((bounds.maxX - bounds.minX) * (bounds.maxY - bounds.minY)) / (1120 * 800), 0.5, 3);
  const frost = ctx.particles(
    ctx.count(170 * area),
    () => ({
      p: [bounds.minX * 0.96 + r() * (bounds.maxX - bounds.minX) * 0.96, bounds.minY * 0.975 + r() * (bounds.maxY - bounds.minY) * 0.975],
      v: [(r() - 0.5) * 24, 12 + r() * 30],
      delay: 0.1 + r() * 1.7,
      life: 1.0 + r() * 1.1,
      size: 3 + r() * 5,
      shape: 4,
      col: [0.8, 0.95, 1, 0.9],
    }),
    { drag: 0.2, P: [0, 0, 1, 0.3] },
  );
  const burst = ctx.particles(
    ctx.count(90),
    () => {
      const a = (r() < 0.5 ? 0 : Math.PI) + (r() - 0.5) * 0.5;
      const sp = 400 + r() * 900;
      return {
        p: [(r() - 0.5) * 20, (r() * 2 - 1) * 300 * hs],
        v: [Math.cos(a) * sp, Math.sin(a) * sp * 0.3],
        delay: 0.78 + r() * 0.12,
        life: 0.5 + r() * 0.4,
        size: 30 + r() * 60,
        stretch: 0.5,
        shape: 1,
        col: [0.8, 0.97, 1, 0.8],
      };
    },
    { drag: 3, P: [0, 0, 1, 0.05] },
  );

  // The cards leave the middle of the rift (the demo: a point 10 units from the centre on their own side).
  const land = ctx.landing({ from: (v) => ({ x: Math.sign(v.x || 1) * 10, y: v.y }) });

  const shakes: ShakeImpulse[] = [
    { t: 0.55, dur: 0.3, amp: 3, kind: "decay" },
    { t: 0.78, dur: tClose - 0.78, amp: 2, kind: "swell", freq: 22 },
    { t: tClose, dur: 0.45, amp: 9, kind: "decay", freq: 30 },
  ];

  const src = ctx.source;
  const rimEnd = 1.4;

  return {
    shakes,
    update(t) {
      // The source card: its aura and slam ring (the card itself stays on the page).
      if (src) {
        const lift = easeOut3(ramp(t, 0, 0.22));
        const slamAt = 0.5;
        const slamIn = easeIn3(ramp(t, slamAt, slamAt + 0.09));
        const up = lift * (1 - slamIn);
        const fade = 1 - ramp(t, rimEnd, rimEnd + 0.4);
        aura.set(src.x, src.y, 330 * (0.5 + up), (0.75 * up + 0.35 * ramp(t, slamAt, slamAt + 0.1) * (1 - ramp(t, slamAt + 0.1, slamAt + 0.7))) * fade);
        const rr = ramp(t, slamAt + 0.04, slamAt + 0.5);
        slam.set(src.x, src.y, 90 + 380 * easeOut3(rr), rr > 0 ? (1 - rr) * 0.9 : 0);
      }

      const chill = ramp(t, 0.1, 0.7) * (1 - ramp(t, tCloseEnd, D));
      const open = easeOut3(ramp(t, 0.72, 1.25)) * (1 - easeIn3(ramp(t, tClose, tCloseEnd)));
      P.uCore.value.set(cu, cv);
      P.uTint.value.setRGB(0.76, 0.92, 1.16);
      P.uTintAmt.value = 0.7 * chill;
      P.uDesat.value = 0.5 * chill;
      P.uDarken.value = 0.2 * chill;
      P.uVig.value = 0.25 + 0.35 * chill;
      P.uLens.value.set(0.5, 0.2 * open, 0, 0.25 * open);
      P.uAberr.value = 0.2 * open + 0.7 * bump(t, tClose, tClose + 0.4);
      P.uFlash.value.set(0.82, 0.96, 1, 0.3 * decay(t, 0.78, 0.12) + 0.3 * decay(t, tClose + 0.28, 0.1) * (t >= tClose + 0.28 ? 1 : 0));
      const k = ramp(t, tClose + 0.2, shockEnd);
      if (k > 0 && k < 1) {
        P.uShock.value.set(cu, cv, 1.0 * easeOut3(k), 0.1);
        P.uShock2.value.set(0.022 * (1 - k), 0.9 * (1 - k), 0);
        P.uShockCol.value.setRGB(0.7, 0.92, 1);
      }

      rift.update(open, t, 0, halfLen);
      beam.set(0, 0, 90 + 90 * open, 0.55 * open, 920 * hs);
      halo.set(0, 0, 340 * open, 0.35 * open, 880 * hs);
      pulse.set(0, 0, 80 + 1900 * easeOut3(k), k > 0 && k < 1 ? 0.5 * (1 - k) : 0);
      motes.setT(t);
      frost.setT(t);
      burst.setT(t);

      for (const o of info) {
        const ck = o.v.card;
        const cold = ramp(t, o.s - 0.3, o.s);
        const dis = ramp(t, o.s, o.s + DISSOLVE);
        if (dis >= 1) {
          ck.mesh.visible = false;
          continue;
        }
        ck.u.uCold.value = cold;
        ck.u.uDissolve.value = Math.pow(dis, 1.2);
        ck.u.uDissCol.value.setRGB(0.55, 0.92, 1);
        ck.u.uRim.value.setRGB(COL[0], COL[1], COL[2]);
        ck.u.uRimAmt.value = cold * 0.7;
        const e3 = easeIn3(dis);
        ck.pose(o.v.x - o.v.x * 0.16 * e3, o.v.y + 12 * dis, 1 - 0.1 * dis);
      }

      land.update(t, { alpha: 0.6, col: COL, cold: 1 });
    },
  };
};
