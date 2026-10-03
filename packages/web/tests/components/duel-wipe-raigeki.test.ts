// @vitest-environment jsdom
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { createPostUniforms, resetPostUniforms } from "../../src/components/duel/fx3d/post";
import { PIECE_TINTS, planScene, type SceneInput } from "../../src/components/duel/fx3d/scene-plan";
import type { FxEnv } from "../../src/components/duel/fx3d/effects/base";
import { wipeFactory } from "../../src/components/duel/fx3d/effects/wipes/common";
import { buildRaigeki } from "../../src/components/duel/fx3d/effects/wipes/raigeki";

const rectAt = (x: number, y: number) => ({ x, y, w: 96, h: 140 });
const world = { cx: 560, cy: 400, u: 1, vw: 1120, vh: 800 };

const input = (n: number, withSource = true): SceneInput => ({
  piece: "raigeki",
  victims: [100, 300, 500, 700, 900].slice(0, n).map((x, i) => ({ rect: rectAt(x, 100), code: 100 + i, defense: i === 1, pile: rectAt(1000, 20) })),
  source: withSource ? rectAt(480, 600) : null,
  attacker: null,
  field: { x: 100, y: 100, w: 900, h: 140 },
  ownerSide: "you",
  tint: PIECE_TINTS.raigeki,
  attackImpactMs: null,
  world,
  rows: { you: { m: { x: 100, y: 500, w: 900, h: 140 }, st: null }, opp: { m: { x: 100, y: 100, w: 900, h: 140 }, st: null } },
});

const env = (): FxEnv =>
  ({
    kit: {} as FxEnv["kit"],
    group: new THREE.Group(),
    view: { w: 1120, h: 800 },
    quality: 1,
    art: { peek: () => null, prefetch: () => {} } as unknown as FxEnv["art"],
    post: createPostUniforms(),
  }) as FxEnv;

function run(n: number, seed: number, withSource = true) {
  const { scene } = planScene(input(n, withSource));
  const e = env();
  const instance = wipeFactory(buildRaigeki)(e, { rect: { x: 0, y: 0, w: 1120, h: 800 }, scene, seed });
  const root = e.group.children[0];
  return { scene, e, instance, root };
}

/** The visible-state signature of every mesh and uniform for a frame. */
function snapshot(root: THREE.Object3D): string {
  const out: string[] = [];
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || !m.visible) return;
    const mat = m.material as THREE.ShaderMaterial;
    const u = mat.uniforms ?? {};
    const vals = Object.keys(u)
      .filter((k) => typeof u[k].value === "number")
      .map((k) => `${k}=${(u[k].value as number).toFixed(4)}`);
    const attr = (m.geometry.getAttribute("aA") ?? m.geometry.getAttribute("position")) as THREE.BufferAttribute;
    let sum = 0;
    for (let i = 0; i < attr.array.length; i += 1) sum += attr.array[i] * (1 + (i % 7));
    out.push(`${sum.toFixed(2)}|${m.visible ? 1 : 0}|${m.position.x.toFixed(2)},${m.position.y.toFixed(2)}|${m.scale.x.toFixed(2)}|${vals.join(",")}`);
  });
  return out.join("\n");
}

describe("raigeki wipe", () => {
  for (const n of [0, 1, 3, 5]) {
    it(`plays ${n} victims over the whole plan and disposes every GPU resource`, () => {
      const { scene, e, instance, root } = run(n, 3);
      const geos = new Set<THREE.BufferGeometry>();
      const mats = new Set<THREE.Material>();
      root.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        geos.add(m.geometry);
        mats.add(m.material as THREE.Material);
      });
      const gd = new Set<THREE.BufferGeometry>();
      const md = new Set<THREE.Material>();
      for (const g of geos) g.addEventListener("dispose", () => gd.add(g));
      for (const m of mats) m.addEventListener("dispose", () => md.add(m));
      const total = scene.totalMs / 1000;
      expect(instance.usesPost).toBe(true);
      for (let t = 0; t <= total + 0.2; t += 1 / 30) instance.update(t);
      instance.dispose();
      expect(e.group.children.length).toBe(0);
      // the card cut-up geometry is one shared instance for all cards: it is not freed per piece
      const shared = [...geos].filter((g) => g.getAttribute("aPivot") != null);
      expect(shared.length).toBeLessThanOrEqual(1);
      for (const g of geos) if (!shared.includes(g)) expect(gd.has(g)).toBe(true);
      for (const m of mats) expect(md.has(m)).toBe(true);
    });
  }

  it("keeps victim cards off the canvas before take and after gone, and whole at take", () => {
    const { scene, instance, root } = run(3, 1);
    const victims = scene.victims;
    const cards = root.children.filter((c): c is THREE.Mesh => (c as THREE.Mesh).isMesh && (c as THREE.Mesh).geometry.getAttribute("aPivot") != null).slice(0, victims.length);
    expect(cards.length).toBe(3);
    instance.update(0.2);
    for (const c of cards) expect(c.visible).toBe(false);
    instance.update(0.45);
    for (const c of cards) {
      expect(c.visible).toBe(true);
      const u = (c.material as THREE.ShaderMaterial).uniforms;
      expect(u.uBreak.value).toBe(-1);
      expect(u.uChar.value).toBe(0);
      expect(u.uDissolve.value).toBe(0);
      expect(c.scale.x).toBeCloseTo(96, 5);
    }
    const gone = Math.max(...victims.map((v) => (v.atMs ?? 0) / 1000));
    instance.update(gone + 0.01);
    for (const c of cards) expect(c.visible).toBe(false);
    instance.dispose();
  });

  it("is pure in t and seeded: the same seed and time give the same frame, in any order", () => {
    const a = run(3, 7);
    const b = run(3, 7);
    const c = run(3, 8);
    a.instance.update(1.0);
    a.instance.update(2.3);
    a.instance.update(1.5);
    const s1 = snapshot(a.root);
    b.instance.update(1.5);
    expect(snapshot(b.root)).toBe(s1);
    c.instance.update(1.5);
    expect(snapshot(c.root)).not.toBe(s1);
    a.instance.dispose();
    b.instance.dispose();
    c.instance.dispose();
  });

  it("leaves nothing but the faint pile pulse in the last frame, and no post grade", () => {
    const { scene, instance, root, e } = run(3, 2);
    const total = scene.totalMs / 1000;
    resetPostUniforms(e.post);
    instance.update(total);
    const P = e.post;
    expect(P.uDarken.value).toBeCloseTo(0, 5);
    expect(P.uTintAmt.value).toBeCloseTo(0, 5);
    expect(P.uVig.value).toBeCloseTo(0.25, 5);
    expect(P.uFlash.value.w).toBeLessThan(0.01);
    const visible: string[] = [];
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && m.visible) visible.push(`${m.geometry.type}@${m.renderOrder}:${(m.material as THREE.ShaderMaterial).uniforms.uOpacity?.value}`);
    });
    // particles draw nothing after their life, so only instanced meshes may stay "visible".
    // The only other thing is the last, faint (< 0.25) pulse ring that the shared landing draws at each pile.
    const others = visible.filter((g) => !g.startsWith("InstancedBufferGeometry"));
    for (const g of others) {
      expect(g.startsWith("PlaneGeometry@110:")).toBe(true);
      expect(Number(g.split(":")[1])).toBeLessThan(0.25);
    }
    instance.dispose();
  });

  it("shakes: strong at the strike, calm at the start and the end", () => {
    const { scene, instance } = run(3, 1);
    const mag = (s: { x: number; y: number }) => Math.hypot(s.x, s.y);
    expect(mag(instance.shake?.(0.05) ?? { x: 0, y: 0 })).toBe(0);
    expect(mag(instance.shake?.(0.96) ?? { x: 0, y: 0 })).toBeGreaterThan(3);
    expect(mag(instance.shake?.(scene.totalMs / 1000) ?? { x: 0, y: 0 })).toBe(0);
    instance.dispose();
  });

  it("works with no source card on the board", () => {
    const { instance } = run(2, 4, false);
    for (let t = 0; t < 3; t += 0.1) instance.update(t);
    instance.dispose();
  });
});
