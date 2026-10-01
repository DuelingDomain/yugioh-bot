// @vitest-environment jsdom
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { createPostUniforms, resetPostUniforms } from "../../src/components/duel/fx3d/post";
import { PIECE_TINTS, planScene, type SceneInput } from "../../src/components/duel/fx3d/scene-plan";
import type { FxScenePiece } from "../../src/components/duel/fx3d/types";
import type { FxEnv } from "../../src/components/duel/fx3d/effects/base";
import { wipeFactory } from "../../src/components/duel/fx3d/effects/wipes/common";
import { buildStorm } from "../../src/components/duel/fx3d/effects/wipes/storm";

const rectAt = (x: number, y: number) => ({ x, y, w: 96, h: 140 });
const world = { cx: 560, cy: 400, u: 1, vw: 1120, vh: 800 };
const input = (piece: FxScenePiece, n: number, source = true): SceneInput => ({
  piece,
  victims: [rectAt(100, 40), rectAt(500, 40), rectAt(900, 40), rectAt(300, 620), rectAt(700, 620)].slice(0, n).map((rect, i) => ({ rect, code: 100 + i, defense: false, st: true, pile: rectAt(1000, 650) })),
  source: source ? rectAt(480, 400) : null,
  attacker: null,
  field: { x: 100, y: 100, w: 900, h: 140 },
  ownerSide: "you",
  tint: PIECE_TINTS[piece],
  attackImpactMs: null,
  world,
  rows: { you: { m: null, st: { x: 100, y: 620, w: 900, h: 140 } }, opp: { m: null, st: { x: 100, y: 40, w: 900, h: 140 } } },
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

describe("storm wipe", () => {
  for (const piece of ["feather-duster", "heavy-storm"] as const) {
    for (const n of [0, 1, 5]) {
      it(`${piece} with ${n} victims runs, ends clean and disposes`, () => {
        const { scene } = planScene(input(piece, n, n !== 1));
        const e = env();
        const disposed: string[] = [];
        const origGeo = THREE.BufferGeometry.prototype.dispose;
        const origMat = THREE.Material.prototype.dispose;
        THREE.BufferGeometry.prototype.dispose = function () { disposed.push("g"); origGeo.call(this); };
        THREE.Material.prototype.dispose = function () { disposed.push("m"); origMat.call(this); };
        try {
          const inst0 = wipeFactory(buildStorm)(e, { rect: { x: 0, y: 0, w: 1120, h: 800 }, scene, seed: 3 });
          const instance = { ...inst0, update: (t: number) => { resetPostUniforms(e.post); inst0.update(t); } };
          const dur = scene.totalMs / 1000;
          // pure in t: the same t gives the same uniforms in any order
          instance.update(1.0);
          const g1 = e.post.uGust.value.clone();
          const d1 = e.post.uDarken.value;
          instance.update(dur);
          instance.update(1.0);
          expect(e.post.uGust.value.equals(g1)).toBe(true);
          expect(e.post.uDarken.value).toBe(d1);
          expect(d1).toBeGreaterThan(0);
          for (let t = 0; t <= dur; t += 0.05) instance.update(t);
          instance.update(dur);
          expect(e.post.uDarken.value).toBeCloseTo(0, 5);
          expect(e.post.uTintAmt.value).toBeCloseTo(0, 5);
          expect(e.post.uClouds.value).toBeCloseTo(0, 5);
          expect(e.post.uGust.value.y).toBe(0);
          expect(e.post.uLens.value.y).toBeCloseTo(0, 6);
          const vis = e.group.children[0].children.filter((c) => c.visible && (c as THREE.Mesh).isMesh && !((c as THREE.Mesh).material as THREE.ShaderMaterial).uniforms?.uT);
          expect(vis.length).toBe(0);
          const sh = inst0.shake?.(1.0);
          expect(Math.abs(sh!.x) + Math.abs(sh!.y)).toBeGreaterThan(0);
          { const z = inst0.shake?.(dur); expect(Math.abs(z!.x) + Math.abs(z!.y) + Math.abs(z!.rot)).toBe(0); }
          inst0.dispose();
          expect(e.group.children.length).toBe(0);
          expect(disposed.length).toBeGreaterThan(0);
        } finally {
          THREE.BufferGeometry.prototype.dispose = origGeo;
          THREE.Material.prototype.dispose = origMat;
        }
      });
    }
  }
});
