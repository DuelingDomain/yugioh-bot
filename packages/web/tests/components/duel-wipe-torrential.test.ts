// @vitest-environment jsdom
import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { createPostUniforms } from "../../src/components/duel/fx3d/post";
import { PIECE_TINTS, planScene, type SceneInput } from "../../src/components/duel/fx3d/scene-plan";
import type { FxEnv } from "../../src/components/duel/fx3d/effects/base";
import { wipeFactory } from "../../src/components/duel/fx3d/effects/wipes/common";
import { buildTorrential } from "../../src/components/duel/fx3d/effects/wipes/torrential";

const rectAt = (x: number, y: number) => ({ x, y, w: 96, h: 140 });
const world = { cx: 560, cy: 400, u: 1, vw: 1120, vh: 800 };
const input = (n: number): SceneInput => ({
  piece: "torrential",
  victims: [rectAt(100, 100), rectAt(500, 100), rectAt(900, 500), rectAt(300, 500)].slice(0, n).map((rect, i) => ({ rect, code: 100 + i, defense: i === 1, pile: rectAt(1000, 650) })),
  source: rectAt(480, 600),
  attacker: null,
  field: { x: 100, y: 100, w: 900, h: 140 },
  ownerSide: "you",
  tint: PIECE_TINTS.torrential,
  attackImpactMs: null,
  world,
  rows: { you: { m: { x: 100, y: 500, w: 570, h: 140 }, st: null }, opp: { m: { x: 100, y: 100, w: 570, h: 140 }, st: null } },
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

describe("torrential wipe", () => {
  for (const n of [0, 1, 3, 4]) {
    it(`plays ${n} victims, ends clean and frees the GPU resources`, () => {
      const { scene } = planScene(input(n));
      const e = env();
      const mats = new Set<THREE.Material>();
      const geos = new Set<THREE.BufferGeometry>();
      const instance = wipeFactory(buildTorrential)(e, { rect: { x: 0, y: 0, w: 1120, h: 800 }, scene, seed: 3 });
      const root = e.group.children[0];
      root.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        mats.add(m.material as THREE.Material);
        if (!m.geometry.getAttribute("aPivot")) geos.add(m.geometry);
      });
      const mdisp = [...mats].map((m) => vi.spyOn(m, "dispose"));
      const gdisp = [...geos].map((g) => vi.spyOn(g, "dispose"));
      const dur = scene.totalMs / 1000;
      for (let t = 0; t <= dur; t += 0.05) instance.update(t);
      instance.update(dur);
      // the last frame shows nothing
      root.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh && m.visible) {
          const mat = m.material as THREE.ShaderMaterial;
          const op = mat.uniforms?.uOpacity?.value ?? mat.uniforms?.uAlpha?.value;
          const inten = mat.uniforms?.uInt?.value;
          // particles clip themselves by age; cards, sprites, bolts, jets and the surge must be off
          if (!(m.geometry as THREE.InstancedBufferGeometry).isInstancedBufferGeometry) {
            expect(op === undefined ? inten : op, `order ${m.renderOrder} dur ${dur}`).toBeCloseTo(0, 2);
          }
        }
      });
      expect(e.post.uFlash.value.w).toBeCloseTo(0, 3);
      expect(e.post.uTintAmt.value).toBeCloseTo(0, 3);
      expect(e.post.uWet.value.w).toBeCloseTo(0, 3);
      instance.dispose();
      for (const s of [...mdisp, ...gdisp]) expect(s).toHaveBeenCalled();
      expect(e.group.children.length).toBe(0);
    });
  }

  it("is pure in t and seeded", () => {
    const run = (order: number[]) => {
      const { scene } = planScene(input(3));
      const e = env();
      const instance = wipeFactory(buildTorrential)(e, { rect: { x: 0, y: 0, w: 1120, h: 800 }, scene, seed: 5 });
      const out: number[] = [];
      for (const t of order) {
        instance.update(t);
        out.push(e.post.uFlash.value.w, e.post.uWet.value.x);
      }
      instance.dispose();
      return out;
    };
    const a = run([0.5, 0.9, 1.4, 2.2]);
    const b = run([0.1, 2.2, 0.9, 0.3, 0.5, 0.9, 1.4, 2.2]);
    expect(b.slice(-8)).toEqual(a);
  });

  it("shakes only inside its impulses", () => {
    const { scene } = planScene(input(3));
    const instance = wipeFactory(buildTorrential)(env(), { rect: { x: 0, y: 0, w: 1120, h: 800 }, scene, seed: 1 });
    expect(Math.hypot(instance.shake?.(0.8)?.x ?? 0, instance.shake?.(0.8)?.y ?? 0)).toBeGreaterThan(1);
    const end = instance.shake?.(scene.totalMs / 1000);
    expect(Math.abs(end?.x ?? 1) + Math.abs(end?.y ?? 1) + Math.abs(end?.rot ?? 1)).toBe(0);
    instance.dispose();
  });
});
