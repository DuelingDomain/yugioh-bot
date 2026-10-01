// @vitest-environment jsdom
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { createPostUniforms } from "../../src/components/duel/fx3d/post";
import { PIECE_TINTS, planScene, type SceneInput } from "../../src/components/duel/fx3d/scene-plan";
import type { FxScenePiece } from "../../src/components/duel/fx3d/types";
import type { FxEnv } from "../../src/components/duel/fx3d/effects/base";
import { sceneEffect } from "../../src/components/duel/fx3d/effects/scene";
import { shakeAt, wipeFactory } from "../../src/components/duel/fx3d/effects/wipes/common";
import { buildBanish } from "../../src/components/duel/fx3d/effects/wipes/banish";
import { buildDarkHole } from "../../src/components/duel/fx3d/effects/wipes/darkhole";
import { buildRaigeki } from "../../src/components/duel/fx3d/effects/wipes/raigeki";
import { buildShock } from "../../src/components/duel/fx3d/effects/wipes/shock";
import { buildStorm } from "../../src/components/duel/fx3d/effects/wipes/storm";
import { buildTorrential } from "../../src/components/duel/fx3d/effects/wipes/torrential";

const rectAt = (x: number, y: number) => ({ x, y, w: 96, h: 140 });
const world = { cx: 560, cy: 400, u: 1, vw: 1120, vh: 800 };
const input = (piece: FxScenePiece): SceneInput => ({
  piece,
  victims: [rectAt(100, 100), rectAt(500, 100), rectAt(900, 500)].map((rect, i) => ({ rect, code: 100 + i, defense: i === 1, pile: rectAt(1000, 650) })),
  source: rectAt(480, 600),
  attacker: null,
  field: { x: 100, y: 100, w: 900, h: 140 },
  ownerSide: "you",
  tint: PIECE_TINTS[piece],
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

const BUILDS = { "dark-hole": buildDarkHole, raigeki: buildRaigeki, "feather-duster": buildStorm, "heavy-storm": buildStorm, "banish-all": buildBanish, "mass-destroy": buildShock, torrential: buildTorrential } as const;

describe("wipe stubs", () => {
  for (const [piece, build] of Object.entries(BUILDS)) {
    it(`${piece} builds, updates over the whole plan and disposes`, () => {
      const { scene } = planScene(input(piece as FxScenePiece));
      const e = env();
      const instance = wipeFactory(build)(e, { rect: { x: 0, y: 0, w: 1120, h: 800 }, scene, seed: 3 });
      expect(instance.usesPost).toBe(true);
      expect(instance.durationMs).toBe(scene.totalMs);
      expect(e.group.children.length).toBe(1);
      for (let t = 0; t <= scene.totalMs / 1000 + 0.2; t += 0.1) instance.update(t);
      // A piece may shake the board while it plays, but the board is still when the piece ends.
      const mid = instance.shake?.(1) ?? { x: 0, y: 0, rot: 0 };
      expect([mid.x, mid.y, mid.rot].every(Number.isFinite)).toBe(true);
      const end = instance.shake?.(scene.totalMs / 1000) ?? { x: 0, y: 0, rot: 0 };
      expect(Math.hypot(end.x, end.y)).toBeLessThan(0.5);
      expect(Math.abs(end.rot)).toBeLessThan(1e-3);
      instance.dispose();
      expect(e.group.children.length).toBe(0);
    });
  }

  it("routes every wipe piece through the scene effect without the old stage", () => {
    for (const piece of Object.keys(BUILDS)) {
      const { scene } = planScene(input(piece as FxScenePiece));
      const instance = sceneEffect(env(), { rect: { x: 0, y: 0, w: 1120, h: 800 }, scene });
      expect(instance.usesPost).toBe(true);
      instance.dispose();
    }
  });

  it("shakes: zero outside an impulse, decays inside", () => {
    expect(shakeAt([{ t: 1, dur: 0.5, amp: 10 }], 0.5)).toEqual([0, 0, 0]);
    expect(shakeAt([{ t: 1, dur: 0.5, amp: 10 }], 2)).toEqual([0, 0, 0]);
    const [x, y] = shakeAt([{ t: 1, dur: 0.5, amp: 10 }], 1.05);
    expect(Math.hypot(x, y)).toBeGreaterThan(0);
  });
});
