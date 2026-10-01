// @vitest-environment jsdom
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { createPostUniforms, resetPostUniforms } from "../../src/components/duel/fx3d/post";
import { PIECE_TINTS, planScene, type SceneInput } from "../../src/components/duel/fx3d/scene-plan";
import type { FxEnv } from "../../src/components/duel/fx3d/effects/base";
import { shakeAt, wipeFactory } from "../../src/components/duel/fx3d/effects/wipes/common";
import { buildDarkHole } from "../../src/components/duel/fx3d/effects/wipes/darkhole";

const rectAt = (x: number, y: number) => ({ x, y, w: 96, h: 140 });
const world = { cx: 560, cy: 400, u: 1, vw: 1120, vh: 800 };
const input = (n: number, withSource = true): SceneInput => ({
  piece: "dark-hole",
  victims: [rectAt(100, 100), rectAt(500, 100), rectAt(900, 500), rectAt(300, 500), rectAt(700, 100)].slice(0, n).map((rect, i) => ({ rect, code: 100 + i, defense: i === 1, pile: rectAt(1000, 650) })),
  source: withSource ? rectAt(480, 600) : null,
  attacker: null,
  field: { x: 100, y: 100, w: 900, h: 140 },
  ownerSide: "you",
  tint: PIECE_TINTS["dark-hole"],
  attackImpactMs: null,
  world,
  rows: { you: { m: { x: 100, y: 500, w: 900, h: 140 }, st: null }, opp: { m: { x: 100, y: 100, w: 900, h: 140 }, st: null } },
});

const makeEnv = (): FxEnv =>
  ({ kit: {} as FxEnv["kit"], group: new THREE.Group(), view: { w: 1120, h: 800 }, quality: 1, art: { peek: () => null, prefetch: () => {} } as unknown as FxEnv["art"], post: createPostUniforms() }) as FxEnv;

const run = (n: number, withSource = true, seed = 3) => {
  const { scene } = planScene(input(n, withSource));
  const env = makeEnv();
  const instance = wipeFactory(buildDarkHole)(env, { rect: { x: 0, y: 0, w: 1120, h: 800 }, scene, seed });
  return { scene, env, instance, dur: scene.totalMs / 1000 };
};

describe("dark hole", () => {
  for (const n of [0, 1, 3, 5]) {
    it(`plays ${n} victims over the whole plan and ends clean`, () => {
      const { scene, env, instance, dur } = run(n);
      const shakes = instance.shake?.(1.8);
      expect(Math.hypot(shakes?.x ?? 0, shakes?.y ?? 0)).toBeGreaterThan(0);
      for (let t = 0; t <= dur; t += 0.05) {
        resetPostUniforms(env.post);
        instance.update(t);
      }
      resetPostUniforms(env.post);
      instance.update(dur);
      expect(env.post.uDarken.value).toBeCloseTo(0, 5);
      expect(env.post.uTintAmt.value).toBeCloseTo(0, 5);
      expect(env.post.uFlash.value.w).toBeCloseTo(0, 5);
      expect(env.post.uShock2.value.y).toBeCloseTo(0, 5);
      const root = env.group.children[0] as THREE.Group;
      for (const m of root.children) {
        const mesh = m as THREE.Mesh;
        const mat = mesh.material as THREE.ShaderMaterial;
        if (mat.uniforms?.uOpacity && !mat.uniforms.uSuck && mesh.visible) throw new Error(`visible at end: ${mesh.renderOrder} ${mat.uniforms.uOpacity.value}`);
        if (mat.uniforms?.uSuck) expect(mesh.visible).toBe(false);
      }
      expect(scene.victims.length).toBe(n);
      instance.dispose();
      expect(env.group.children.length).toBe(0);
    });
  }

  it("runs without a source card", () => {
    const { env, instance, dur } = run(3, false);
    for (let t = 0; t <= dur; t += 0.1) instance.update(t);
    instance.dispose();
    expect(env.group.children.length).toBe(0);
  });

  it("keeps a victim whole until take, hides it from gone, and moves nothing before take", () => {
    const { scene, env, instance } = run(3);
    const root = env.group.children[0] as THREE.Group;
    const cards = root.children.filter((c) => (c as THREE.Mesh).material && ((c as THREE.Mesh).material as THREE.ShaderMaterial).uniforms?.uSuck) as THREE.Mesh[];
    const victimCards = cards.slice(0, 3);
    scene.victims.forEach((v, i) => {
      const take = (v.takeMs ?? 0) / 1000;
      const gone = v.atMs / 1000;
      const mesh = victimCards[i];
      const mat = mesh.material as THREE.ShaderMaterial;
      instance.update(take - 0.01);
      expect(mesh.visible).toBe(false);
      instance.update(take);
      expect(mesh.visible).toBe(true);
      expect(mat.uniforms.uSuck.value).toBe(0);
      expect(mat.uniforms.uRimAmt.value).toBeCloseTo(0, 6);
      expect(mesh.scale.x).toBeCloseTo(96, 5);
      instance.update(gone);
      expect(mesh.visible).toBe(false);
    });
    instance.dispose();
  });

  it("is pure in t and seeded", () => {
    const a = run(3, true, 9);
    const b = run(3, true, 9);
    const sample = (r: ReturnType<typeof run>, t: number) => {
      resetPostUniforms(r.env.post);
      r.instance.update(t);
      const root = r.env.group.children[0] as THREE.Group;
      return JSON.stringify(root.children.map((c) => (c.visible ? [c.position.toArray(), c.scale.toArray()] : 0)));
    };
    const s1 = sample(a, 2.4);
    sample(a, 0.3);
    sample(a, 3.0);
    expect(sample(a, 2.4)).toBe(s1);
    expect(sample(b, 2.4)).toBe(s1);
    a.instance.dispose();
    b.instance.dispose();
  });

  it("frees every geometry, material and texture it made", () => {
    const geoms = new Set<THREE.BufferGeometry>();
    const mats = new Set<THREE.Material>();
    const gDone = new Set<unknown>();
    const mDone = new Set<unknown>();
    const og = THREE.BufferGeometry.prototype.dispose;
    const om = THREE.Material.prototype.dispose;
    THREE.BufferGeometry.prototype.dispose = function (this: THREE.BufferGeometry) {
      gDone.add(this);
      og.call(this);
    };
    THREE.Material.prototype.dispose = function (this: THREE.Material) {
      mDone.add(this);
      om.call(this);
    };
    try {
      const { env, instance } = run(3);
      instance.update(1);
      (env.group.children[0] as THREE.Group).traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          geoms.add(m.geometry);
          mats.add(m.material as THREE.Material);
        }
      });
      instance.dispose();
      expect(mats.size).toBeGreaterThan(10);
      for (const m of mats) expect(mDone.has(m)).toBe(true);
      // the card geometry is one module-level soup shared by every wipe: it is never freed
      for (const g of geoms) if (g.getAttribute("aPivot") == null) expect(gDone.has(g)).toBe(true);
    } finally {
      THREE.BufferGeometry.prototype.dispose = og;
      THREE.Material.prototype.dispose = om;
    }
  });

  it("shake list matches the demo", () => {
    const { instance } = run(2);
    expect(shakeAt([{ t: 0.5, dur: 0.3, amp: 5, kind: "decay" }], 0.6)[0]).not.toBe(0);
    expect(instance.shake?.(0.1)?.x).toBeCloseTo(0, 9);
    instance.dispose();
  });
});
