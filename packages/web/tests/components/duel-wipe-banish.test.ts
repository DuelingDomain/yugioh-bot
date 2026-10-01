// @vitest-environment jsdom
import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { createPostUniforms, resetPostUniforms } from "../../src/components/duel/fx3d/post";
import { PIECE_TINTS, planScene, type SceneInput } from "../../src/components/duel/fx3d/scene-plan";
import type { FxEnv } from "../../src/components/duel/fx3d/effects/base";
import { wipeFactory } from "../../src/components/duel/fx3d/effects/wipes/common";
import { buildBanish } from "../../src/components/duel/fx3d/effects/wipes/banish";

const rectAt = (x: number, y: number) => ({ x, y, w: 96, h: 140 });
const world = { cx: 560, cy: 400, u: 1, vw: 1120, vh: 800 };
const input = (n: number, source: boolean): SceneInput => ({
  piece: "banish-all",
  victims: Array.from({ length: n }, (_, i) => ({ rect: rectAt(80 + i * 85, i % 2 ? 120 : 520), code: 100 + i, defense: i === 1, pile: rectAt(1000, i % 2 ? 80 : 600) })),
  source: source ? rectAt(480, 600) : null,
  attacker: null,
  field: { x: 100, y: 100, w: 900, h: 140 },
  ownerSide: "you",
  tint: PIECE_TINTS["banish-all"],
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

describe("banish-all wipe", () => {
  for (const [n, source] of [[0, false], [1, true], [2, true], [12, false]] as const) {
    it(`plays ${n} victims${source ? " with" : " without"} a source and ends clean`, () => {
      const { scene } = planScene(input(n, source));
      const e = env();
      const inst = wipeFactory(buildBanish)(e, { rect: { x: 0, y: 0, w: 1120, h: 800 }, scene, seed: 5 });
      const dur = scene.totalMs / 1000;
      for (let t = 0; t <= dur; t += 0.05) {
        resetPostUniforms(e.post);
        inst.update(t);
      }
      resetPostUniforms(e.post);
      inst.update(dur);
      expect(e.post.uTintAmt.value).toBeCloseTo(0, 5);
      expect(e.post.uDarken.value).toBeCloseTo(0, 5);
      expect(e.post.uDesat.value).toBeCloseTo(0, 5);
      expect(e.post.uFlash.value.w).toBeLessThan(0.01);
      expect(e.post.uLens.value.y).toBeCloseTo(0, 5);
      expect(e.post.uShock2.value.x).toBeCloseTo(0, 5);
      expect(e.post.uAberr.value).toBeCloseTo(0, 5);
      // the rift (order 105) and every victim card (order 10 to 30) are hidden at the last frame
      e.group.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh && (m.renderOrder === 105 || (m.renderOrder >= 10 && m.renderOrder < 30))) expect(m.visible).toBe(false);
      });
      inst.dispose();
      expect(e.group.children.length).toBe(0);
    });
  }

  it("is deterministic in t and for the same seed", () => {
    const { scene } = planScene(input(5, true));
    const sample = (order: number[]) => {
      const e = env();
      const inst = wipeFactory(buildBanish)(e, { rect: { x: 0, y: 0, w: 1120, h: 800 }, scene, seed: 9 });
      const out: number[] = [];
      for (const t of order) {
        resetPostUniforms(e.post);
        inst.update(t);
        out.push(e.post.uTintAmt.value, e.post.uFlash.value.w, e.post.uAberr.value);
      }
      inst.dispose();
      return out;
    };
    const a = sample([0.3, 0.9, 1.7, 2.1]);
    const b = sample([2.1, 1.7, 0.9, 0.3]).reverse();
    // each triple is (tint, flash, aberr) for one time; compare per time
    const trip = (arr: number[]) => [0, 1, 2, 3].map((i) => arr.slice(i * 3, i * 3 + 3));
    const ta = trip(a);
    const tb = [3, 2, 1, 0].map((i) => sample([2.1, 1.7, 0.9, 0.3]).slice(i * 3, i * 3 + 3));
    expect(tb).toEqual(ta);
    expect(b.length).toBe(a.length);
  });

  it("frees every geometry and material it makes", () => {
    const geos = new Set<THREE.BufferGeometry>();
    const mats = new Set<THREE.Material>();
    const gd = vi.spyOn(THREE.BufferGeometry.prototype, "dispose");
    const md = vi.spyOn(THREE.Material.prototype, "dispose");
    const { scene } = planScene(input(4, true));
    const e = env();
    const inst = wipeFactory(buildBanish)(e, { rect: { x: 0, y: 0, w: 1120, h: 800 }, scene, seed: 1 });
    e.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        geos.add(m.geometry);
        mats.add(m.material as THREE.Material);
      }
    });
    inst.dispose();
    const disposedG = new Set(gd.mock.contexts as THREE.BufferGeometry[]);
    const disposedM = new Set(md.mock.contexts as THREE.Material[]);
    gd.mockRestore();
    md.mockRestore();
    expect(geos.size).toBeGreaterThan(5);
    // the shared card geometry is module-level on purpose; everything else must be freed
    for (const m of mats) expect(disposedM.has(m)).toBe(true);
    const undisposed = [...geos].filter((g) => !disposedG.has(g));
    expect(undisposed.length).toBeLessThanOrEqual(1);
  });
});
