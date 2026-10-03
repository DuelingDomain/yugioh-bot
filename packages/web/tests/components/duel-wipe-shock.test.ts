// @vitest-environment jsdom
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { createPostUniforms } from "../../src/components/duel/fx3d/post";
import { PIECE_TINTS, planScene, type SceneInput } from "../../src/components/duel/fx3d/scene-plan";
import type { FxEnv } from "../../src/components/duel/fx3d/effects/base";
import { wipeFactory } from "../../src/components/duel/fx3d/effects/wipes/common";
import { buildShock } from "../../src/components/duel/fx3d/effects/wipes/shock";

const rectAt = (x: number, y: number) => ({ x, y, w: 96, h: 140 });
const input = (n: number, source: boolean): SceneInput => ({
  piece: "mass-destroy",
  victims: [rectAt(100, 100), rectAt(500, 100), rectAt(900, 500), rectAt(300, 500)].slice(0, n).map((rect, i) => ({ rect, code: 100 + i, defense: false, pile: rectAt(1000, 650) })),
  source: source ? rectAt(480, 600) : null,
  attacker: null,
  field: { x: 100, y: 100, w: 900, h: 140 },
  ownerSide: "you",
  tint: PIECE_TINTS["mass-destroy"],
  attackImpactMs: null,
  world: { cx: 560, cy: 400, u: 1, vw: 1120, vh: 800 },
  rows: { you: { m: { x: 100, y: 500, w: 900, h: 140 }, st: null }, opp: { m: { x: 100, y: 100, w: 900, h: 140 }, st: null } },
});
const env = (): FxEnv =>
  ({ kit: {} as FxEnv["kit"], group: new THREE.Group(), view: { w: 1120, h: 800 }, quality: 1, art: { peek: () => null, prefetch: () => {} } as unknown as FxEnv["art"], post: createPostUniforms() }) as FxEnv;

describe("mass destroy shock wipe", () => {
  for (const [n, source] of [[0, true], [1, true], [4, true], [3, false]] as const) {
    it(`runs with ${n} victims, source ${source}`, () => {
      const { scene } = planScene(input(n, source));
      const e = env();
      const inst = wipeFactory(buildShock)(e, { rect: { x: 0, y: 0, w: 1120, h: 800 }, scene, seed: 5 });
      for (let t = 0; t <= scene.totalMs / 1000; t += 0.05) {
        inst.update(t);
        const s = inst.shake?.(t);
        expect(Number.isFinite(s?.x ?? 0)).toBe(true);
      }
      // later frames and a replay give the same result (pure in t)
      inst.update(1);
      const a = e.post.uShock.value.clone();
      inst.update(2.2);
      inst.update(1);
      expect(e.post.uShock.value.toArray()).toEqual(a.toArray());
      // nothing is left at the end
      inst.update(scene.totalMs / 1000);
      expect(e.post.uFlash.value.w).toBeLessThan(0.01);
      inst.dispose();
      expect(e.group.children.length).toBe(0);
    });
  }
});
