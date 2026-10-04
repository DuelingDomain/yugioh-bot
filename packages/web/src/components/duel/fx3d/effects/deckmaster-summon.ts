import * as THREE from "three";
import { ART_BOX, ART_CENTER_DROP, artCropUv } from "../coords";
import type { FxFactory, FxInstance } from "./base";
import {
  DM_RING_RADII,
  dmBeats,
  dmDurationMs,
  dmReducedBeats,
  tiltRadOf,
} from "./deckmaster-summon-timeline";

/**
 * Effect "summon:deckmaster" (3D mode only): the Deck Master's picture flies from its dock to the
 * zone, three gold rings form on the table, a purple cone lifts, the art builds as a scanline
 * hologram, holds, then sinks onto the card's art window and crossfades into the page card.
 * Ported from the owner-approved demo (.fx-demo/dm-hologram/js/dm-summon.js). The beats live in
 * deckmaster-summon-timeline.ts; this file turns them into meshes.
 *
 * The camera is orthographic with y UP, so rects (CSS, y down) are converted with `V`. The rings
 * lie in the table plane: they sit in a group rotated about X by the table tilt, and the hologram
 * leans into the same plane as it lands. The shaders are the demo's, own materials (the kit's ring
 * has no dashes or fill); reduced motion reuses the kit's ring and glow.
 */

const GOLD: Rgb3 = [0.93, 0.8, 0.52];
const GOLD_DEEP: Rgb3 = [0.8, 0.64, 0.36];
const PURPLE: Rgb3 = [0.55, 0.44, 0.96];
type Rgb3 = readonly [number, number, number];

/** Above the other effects' render orders (a Rig counts up from 0). */
const ORDER = 200;

const RING_VS = /* glsl */ `varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const RING_FS = /* glsl */ `uniform vec3 uColor; uniform float uAlpha, uR, uW, uSoft, uDash, uRot, uFill; varying vec2 vP;
  void main(){
    float r = length(vP);
    float a = 1.0 - smoothstep(uW * 0.5, uW * 0.5 + uSoft, abs(r - uR));
    if (uDash > 0.0) { float f = fract((atan(vP.y, vP.x) + uRot) / 6.2831853 * uDash); a *= smoothstep(0.36, 0.42, f) * (1.0 - smoothstep(0.94, 1.0, f)); }
    a += uFill * pow(1.0 - clamp(r / uR, 0.0, 1.0), 1.7);
    gl_FragColor = vec4(uColor, a * uAlpha);
  }`;
const CONE_VS = /* glsl */ `uniform float uBW, uTW, uH; varying vec2 vUv;
  void main(){ float y01 = position.y + 0.5; float w = mix(uBW, uTW, y01); vUv = vec2(position.x + 0.5, y01);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position.x * w, y01 * uH, 0.0, 1.0); }`;
const CONE_FS = /* glsl */ `uniform vec3 uColor; uniform float uAlpha, uTime; varying vec2 vUv;
  void main(){
    float edge = smoothstep(0.0, 0.3, vUv.x) * (1.0 - smoothstep(0.7, 1.0, vUv.x));
    float fall = pow(1.0 - vUv.y, 0.75);
    float streak = 0.76 + 0.24 * sin(vUv.x * 46.0 + uTime * 3.0) * sin(vUv.x * 11.0 - uTime * 1.7);
    float core = 1.0 - smoothstep(0.0, 0.2, abs(vUv.x - 0.5));
    gl_FragColor = vec4(uColor, (edge * fall * streak * 0.55 + core * fall * 0.2) * uAlpha);
  }`;
const QUAD_VS = /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
// uCrop = [u0, v0, u1, v1]: the art window of the full card image (v runs up).
const HOLO_FS = /* glsl */ `uniform sampler2D uMap; uniform vec4 uCrop; uniform float uTime, uReveal, uAlpha, uGlitch; uniform vec3 uGold, uTint; varying vec2 vUv;
  vec4 tex(vec2 p){ return texture2D(uMap, mix(uCrop.xy, uCrop.zw, clamp(p, 0.0, 1.0))); }
  void main(){
    vec2 uv = vUv;
    float bandY = fract(uTime * 0.7 + 0.15);
    float band = 1.0 - smoothstep(0.0, 0.045, abs(uv.y - bandY));
    uv.x += band * 0.01 * sin(uTime * 90.0) + uGlitch * 0.016 * sin(uv.y * 150.0 + uTime * 70.0);
    float off = 0.0022 + band * 0.004 + uGlitch * 0.004;
    vec3 c = vec3(tex(uv + vec2(off, 0.0)).r, tex(uv).g, tex(uv - vec2(off, 0.0)).b);
    c = mix(c, c * vec3(0.92, 0.88, 1.08) + uTint * 0.05, 0.5);
    c *= 0.8 + 0.2 * sin(gl_FragCoord.y * 1.6 - uTime * 26.0);
    c += uTint * (band * 0.14 + (1.0 - vUv.y) * 0.1);
    float ex = min(vUv.x, 1.0 - vUv.x), ey = min(vUv.y, 1.0 - vUv.y);
    float frame = (1.0 - smoothstep(0.0, 0.011, min(ex, ey))) * smoothstep(0.0, 0.22, vUv.y);
    float fade = smoothstep(0.0, 0.03, ex) * smoothstep(0.0, 0.16, vUv.y) * smoothstep(0.0, 0.03, 1.0 - vUv.y);
    float below = 1.0 - smoothstep(uReveal - 0.025, uReveal, vUv.y);
    float line = (1.0 - smoothstep(0.0, 0.014, abs(vUv.y - uReveal))) * (1.0 - step(0.995, uReveal));
    vec3 col = c + uGold * (frame * 0.8 + line * 1.3);
    float a = max(fade * 0.9, frame * 0.9) * below + line;
    gl_FragColor = vec4(col, clamp(a * uAlpha, 0.0, 1.0));
  }`;
const FLY_FS = /* glsl */ `uniform sampler2D uMap; uniform float uAlpha; uniform vec3 uGold, uTint; varying vec2 vUv;
  void main(){
    vec3 c = texture2D(uMap, vUv).rgb;
    c = mix(c, c * vec3(0.92, 0.88, 1.08) + uTint * 0.08, 0.3);
    float rim = 1.0 - smoothstep(0.0, 0.025, min(min(vUv.x, 1.0 - vUv.x), min(vUv.y, 1.0 - vUv.y)));
    gl_FragColor = vec4(c + uGold * rim * 0.7, uAlpha);
  }`;

// Vector3 colours: THREE.Color would convert sRGB to linear, and the shaders work in display space.
const vec = (c: Rgb3): THREE.Vector3 => new THREE.Vector3(c[0], c[1], c[2]);
const mat = (vs: string, fs: string, uniforms: Record<string, THREE.IUniform>, additive = false): THREE.ShaderMaterial =>
  new THREE.ShaderMaterial({
    uniforms, vertexShader: vs, fragmentShader: fs, transparent: true, depthWrite: false, depthTest: false,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  });

/** Dark placeholder for the picture until the art arrives (a sampler must never be null). */
let fallback: THREE.DataTexture | null = null;
function fallbackTexture(): THREE.DataTexture {
  if (!fallback) {
    fallback = new THREE.DataTexture(new Uint8Array([24, 20, 44, 255]), 1, 1);
    fallback.colorSpace = THREE.NoColorSpace;
    fallback.needsUpdate = true;
  }
  return fallback;
}

function ringMaterial(color: Rgb3, o: { r: number; w: number; soft?: number; dash?: number; fill?: number }): THREE.ShaderMaterial {
  return mat(RING_VS, RING_FS, {
    uColor: { value: vec(color) }, uAlpha: { value: 0 }, uR: { value: o.r }, uW: { value: o.w },
    uSoft: { value: o.soft ?? 1.2 }, uDash: { value: o.dash ?? 0 }, uRot: { value: 0 }, uFill: { value: o.fill ?? 0 },
  }, true);
}
const coneMaterial = (): THREE.ShaderMaterial => mat(CONE_VS, CONE_FS, {
  uColor: { value: vec(PURPLE) }, uAlpha: { value: 0 }, uTime: { value: 0 }, uBW: { value: 1 }, uTW: { value: 1 }, uH: { value: 0 },
}, true);
const holoMaterial = (tex: THREE.Texture): THREE.ShaderMaterial => {
  const [u0, v0, u1, v1] = artCropUv();
  return mat(QUAD_VS, HOLO_FS, {
    uMap: { value: tex }, uCrop: { value: new THREE.Vector4(u0, v0, u1, v1) }, uTime: { value: 0 }, uReveal: { value: 0 },
    uAlpha: { value: 0 }, uGlitch: { value: 0 }, uGold: { value: vec(GOLD) }, uTint: { value: vec(PURPLE) },
  });
};
const flyMaterial = (tex: THREE.Texture, additive: boolean): THREE.ShaderMaterial => mat(QUAD_VS, FLY_FS, {
  uMap: { value: tex }, uAlpha: { value: 0 }, uGold: { value: vec(GOLD) }, uTint: { value: vec(PURPLE) },
}, additive);

/**
 * Compiles the five materials of this effect with the engine's start-up warm-up, so the first Deck
 * Master summon has no shader hitch. Returns the cleanup (call it after the warm-up render).
 */
export function warmDeckMaster(scene: THREE.Scene): () => void {
  const tex = fallbackTexture();
  const materials = [
    ringMaterial(GOLD, { r: 1, w: 1, dash: 4, fill: 1 }), coneMaterial(), holoMaterial(tex), flyMaterial(tex, false), flyMaterial(tex, true),
  ];
  const geometry = new THREE.PlaneGeometry(1, 1);
  const meshes = materials.map((material) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    scene.add(mesh);
    return mesh;
  });
  return () => {
    for (const mesh of meshes) scene.remove(mesh);
    geometry.dispose();
    for (const material of materials) material.dispose();
  };
}

type Box = { x: number; y: number; w: number; h: number };
/** A DOM rectangle (y down) as centre and size. */
const boxOf = (r: { x: number; y: number; w: number; h: number }): Box => ({ x: r.x + r.w / 2, y: r.y + r.h / 2, w: r.w, h: r.h });

export const deckMasterFactory: FxFactory = (env, request) => {
  const dm = request.deckmaster;
  if (!dm) throw new Error("summon:deckmaster needs request.deckmaster");
  return dm.reduced ? reducedInstance(env, request) : fullInstance(env, request);
};

function fullInstance(env: Parameters<FxFactory>[0], request: Parameters<FxFactory>[1]): FxInstance {
  const dm = request.deckmaster!;
  const { group, view, art } = env;
  const Z = boxOf(request.rect);
  const card = boxOf(dm.card ?? request.rect);
  const from = boxOf(dm.from);
  const tilt = tiltRadOf(dm.tiltDeg);
  const s = Math.max(8, Math.min(Z.w, Z.h));
  const bw = Math.max(70, Math.min(240, s * 1.5)); // hologram side at its peak
  const peakBottom = Z.y - s * 0.64;
  const win = { cx: card.x, cy: card.y + ART_CENTER_DROP * card.h, size: card.w * (ART_BOX.right - ART_BOX.left) };
  const code = request.artCode ?? 0;
  const initial = (code > 0 ? art.peek(code) : null) ?? fallbackTexture();
  let bound: THREE.Texture = initial;

  const owned: THREE.Object3D[] = [];
  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.ShaderMaterial[] = [];
  const mesh = (geometry: THREE.BufferGeometry, material: THREE.ShaderMaterial, order: number, parent: THREE.Object3D = group): THREE.Mesh => {
    const m = new THREE.Mesh(geometry, material);
    m.frustumCulled = false;
    m.renderOrder = ORDER + order;
    parent.add(m);
    owned.push(m);
    geometries.push(geometry);
    materials.push(material);
    return m;
  };
  // World position: x right, y up from the bottom-left of the canvas.
  const place = (obj: THREE.Object3D, x: number, y: number, z = 0): void => { obj.position.set(x, view.h - y, z); };

  // The table plane: the rings lie in it, tilted like the CSS table.
  const plane = new THREE.Group();
  plane.rotation.x = -tilt;
  place(plane, Z.x, Z.y);
  group.add(plane);
  owned.push(plane);
  const rings = DM_RING_RADII.map((f, i) => {
    const r = s * f;
    const size = (r + 2 + 1.2 + 6) * 2;
    const material = ringMaterial(i === 1 ? GOLD_DEEP : GOLD, { r, w: i === 1 ? 1.2 : 2, dash: i === 2 ? 40 : 0 });
    return mesh(new THREE.PlaneGeometry(size, size), material, 1 + i, plane);
  });
  const disc = mesh(new THREE.PlaneGeometry((s * 0.62 + 8) * 2, (s * 0.62 + 8) * 2), ringMaterial(PURPLE, { r: s * 0.62, w: 0.4, soft: 0.6, fill: 1 }), 0, plane);

  const cone = mesh(new THREE.PlaneGeometry(1, 1), coneMaterial(), 4);
  place(cone, Z.x, Z.y, 0.5);
  const holo = mesh(new THREE.PlaneGeometry(1, 1), holoMaterial(initial), 5);
  // Trail ghosts first (they draw under the lead picture).
  const fliers = [0, 1, 2].map((i) => mesh(new THREE.PlaneGeometry(1, 1), flyMaterial(initial, i < 2), 6 + i));

  let settled = false;
  const settle = (): void => {
    if (settled) return;
    settled = true;
    dm.onSettle?.();
  };

  return {
    durationMs: dmDurationMs(false),
    update(t) {
      // Take the sharper image when it lands.
      const best = code > 0 ? art.peek(code) : null;
      if (best && best !== bound) {
        bound = best;
        for (const m of [holo, ...fliers]) (m.material as THREE.ShaderMaterial).uniforms.uMap!.value = best;
      }
      const b = dmBeats(t);

      b.fliers.forEach((f, i) => {
        const m = fliers[i]!;
        const x = from.x + (card.x - from.x) * f.p;
        const y = from.y + (card.y - from.y) * f.p;
        const lift = 1 + 0.1 * Math.sin(Math.PI * f.p);
        place(m, x, y, 80 * Math.sin(Math.PI * f.p));
        m.scale.set((from.w + (card.w - from.w) * f.p) * lift, (from.h + (card.h - from.h) * f.p) * lift, 1);
        m.rotation.x = -tilt * f.p * f.p;
        (m.material as THREE.ShaderMaterial).uniforms.uAlpha!.value = f.alpha;
        m.visible = f.alpha > 0.002;
      });

      rings.forEach((r, i) => {
        const ring = b.rings[i]!;
        r.scale.setScalar(ring.scale);
        const u = (r.material as THREE.ShaderMaterial).uniforms;
        u.uAlpha!.value = ring.alpha;
        u.uRot!.value = ring.rot;
      });
      (disc.material as THREE.ShaderMaterial).uniforms.uAlpha!.value = b.disc;

      const cu = (cone.material as THREE.ShaderMaterial).uniforms;
      cu.uBW!.value = s * 0.66;
      cu.uTW!.value = bw * 1.7;
      cu.uH!.value = (Z.y - (peakBottom - bw)) * b.cone.grow;
      cu.uAlpha!.value = b.cone.alpha;
      cu.uTime!.value = t;
      cone.visible = b.cone.alpha > 0.002;

      // The hologram rises and grows, then sinks onto the card's art window.
      const { rise, sink } = b.holo;
      const start = Z.y - s * 0.12;
      let cy = start + (peakBottom - bw / 2 - start) * rise;
      cy += (win.cy - cy) * sink;
      const side = bw * b.holo.scale + (win.size - bw * b.holo.scale) * sink;
      place(holo, Z.x + (win.cx - Z.x) * sink, cy, 90 * rise * (1 - sink));
      holo.rotation.x = -tilt * sink; // lies in the table plane as it lands
      holo.scale.set(side, side, 1);
      const hu = (holo.material as THREE.ShaderMaterial).uniforms;
      hu.uReveal!.value = b.holo.reveal;
      hu.uAlpha!.value = b.holo.alpha;
      hu.uTime!.value = t;
      hu.uGlitch!.value = b.holo.glitch;
      holo.visible = b.holo.alpha > 0.002;

      if (b.settled) settle();
    },
    dispose() {
      settle();
      for (const o of owned) o.parent?.remove(o);
      for (const g of geometries) g.dispose();
      for (const m of materials) m.dispose();
    },
  };
}

/** prefers-reduced-motion: one gold ring and a purple glow fade in and out; the card fades in. */
function reducedInstance(env: Parameters<FxFactory>[0], request: Parameters<FxFactory>[1]): FxInstance {
  const dm = request.deckmaster!;
  const { kit, group, view } = env;
  const Z = boxOf(request.rect);
  const s = Math.max(8, Math.min(Z.w, Z.h));
  const plane = new THREE.Group();
  plane.rotation.x = -tiltRadOf(dm.tiltDeg);
  plane.position.set(Z.x, view.h - Z.y, 0);
  group.add(plane);
  const ring = kit.mesh("ring");
  const glow = kit.mesh("glow");
  for (const [m, order] of [[glow, 0], [ring, 1]] as const) {
    m.renderOrder = ORDER + order;
    plane.add(m);
  }
  ring.scale.set(s * 1.3, s * 1.3, 1);
  ring.material.uniforms.uColor!.value.set(GOLD[0], GOLD[1], GOLD[2]);
  ring.material.uniforms.uRadius!.value = 0.8;
  ring.material.uniforms.uWidth!.value = 0.05;
  glow.scale.set(s * 1.4, s * 1.4, 1);
  glow.material.uniforms.uColor!.value.set(PURPLE[0], PURPLE[1], PURPLE[2]);
  glow.material.uniforms.uPow!.value = 1.7;
  let settled = false;
  const settle = (): void => {
    if (settled) return;
    settled = true;
    dm.onSettle?.();
  };
  return {
    durationMs: dmDurationMs(true),
    update(t) {
      const b = dmReducedBeats(t);
      ring.scale.setScalar(s * 1.3 * b.scale);
      ring.material.uniforms.uAlpha!.value = b.ring;
      glow.material.uniforms.uAlpha!.value = (b.glow / 0.3) * 0.45;
      if (b.settled) settle();
    },
    dispose() {
      settle();
      plane.remove(ring, glow);
      group.remove(plane);
      kit.releaseMesh("ring", ring);
      kit.releaseMesh("glow", glow);
    },
  };
}

