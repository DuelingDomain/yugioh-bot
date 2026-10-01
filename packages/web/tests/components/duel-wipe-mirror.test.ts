// @vitest-environment jsdom
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { createPostUniforms } from "../../src/components/duel/fx3d/post";
import { MIRROR, mirrorAt, mirrorDemoTime, mirrorGeo, mirrorHitSec, mirrorSceneTime, mirrorWorld } from "../../src/components/duel/fx3d/mirror-math";
import { PIECE_TINTS, planScene, type SceneInput } from "../../src/components/duel/fx3d/scene-plan";
import type { FxEnv } from "../../src/components/duel/fx3d/effects/base";
import { wipeFactory } from "../../src/components/duel/fx3d/effects/wipes/common";
import { buildMirror } from "../../src/components/duel/fx3d/effects/wipes/mirror";

const rectAt = (x: number, y: number) => ({ x, y, w: 96, h: 140 });
const world = { cx: 560, cy: 400, u: 1, vw: 1120, vh: 800 };
// The attacker's side is the top row (opp); the caster is "you" at the bottom.
const XS = [100, 280, 460, 640, 820];
const input = (n: number, o: { impact?: number | null; caster?: "you" | "opp"; source?: boolean; defense?: number[] } = {}): SceneInput => {
  const caster = o.caster ?? "you";
  const row = caster === "you" ? 100 : 500;
  const victims = XS.slice(0, n).map((x, i) => ({ rect: rectAt(x, row), code: 100 + i, defense: false, pile: rectAt(1000, row) }));
  return {
    piece: "mirror-force",
    victims,
    source: o.source === false ? null : rectAt(480, caster === "you" ? 600 : 60),
    attacker: rectAt(XS[Math.min(1, n - 1)] ?? 100, row),
    field: { x: 100, y: row, w: 900, h: 140 },
    ownerSide: caster,
    tint: PIECE_TINTS["mirror-force"],
    attackImpactMs: o.impact ?? null,
    world,
    rows: { you: { m: { x: 100, y: 500, w: 900, h: 140 }, st: null }, opp: { m: { x: 100, y: 100, w: 900, h: 140 }, st: null } },
  };
};
const env = (): FxEnv =>
  ({ kit: {} as FxEnv["kit"], group: new THREE.Group(), view: { w: 1120, h: 800 }, quality: 1, art: { peek: () => null, prefetch: () => {} } as unknown as FxEnv["art"], post: createPostUniforms() }) as FxEnv;

describe("mirror clock", () => {
  it("is the demo clock when no attack is incoming", () => {
    expect(mirrorHitSec(null)).toBe(MIRROR.th);
    expect(mirrorDemoTime(1.2, MIRROR.th)).toBeCloseTo(1.2);
    expect(mirrorSceneTime(1.2, MIRROR.th)).toBeCloseTo(1.2);
  });

  it("keeps the impact of an incoming attack inside the bounds", () => {
    expect(mirrorHitSec(900)).toBeCloseTo(0.9);
    expect(mirrorHitSec(10)).toBe(MIRROR.hitMin);
    expect(mirrorHitSec(99999)).toBe(MIRROR.hitMax);
  });

  it("maps scene time to demo time and back", () => {
    for (const hit of [0.4, 0.6, 0.9, 2.2]) {
      // a late impact idles the scene until demo time 0, so only times from there on map back
      for (const ts of [Math.max(0, hit - MIRROR.th), hit - 0.01, hit, hit + 0.5, hit + 2]) {
        const back = mirrorSceneTime(mirrorDemoTime(ts, hit), hit);
        expect(back).toBeCloseTo(ts, 6);
      }
      expect(mirrorDemoTime(hit, hit)).toBeCloseTo(MIRROR.th, 6);
    }
  });

  it("runs the world clock at a crawl through the time-stop", () => {
    const a = mirrorWorld(MIRROR.th);
    const b = mirrorWorld(MIRROR.th + 0.1);
    expect(b - a).toBeLessThan(0.1 * 0.2);
    expect(mirrorAt(MIRROR.tr, 0.6)).toBeGreaterThan(0.6);
  });
});

describe("mirror geometry", () => {
  const base = { wx: [-300, 0, 300], wy: [150, 150, 150], attacker: { x: 0, y: 150 }, rowYou: -150, rowOpp: 150, incoming: false };

  it("picks the victim nearest the attacker and puts the wall in front of the caster", () => {
    const g = mirrorGeo({ ...base, ownerSide: "you" });
    expect(g.attacker).toBe(1);
    expect(g.cs).toBe(-1);
    expect(g.cyM).toBeLessThan(g.mid);
    expect(g.yI).toBeGreaterThan(g.cyM);
    const o = mirrorGeo({ ...base, ownerSide: "opp", wy: [-150, -150, -150], attacker: { x: 0, y: -150 } });
    expect(o.cs).toBe(1);
    expect(o.cyM).toBeGreaterThan(o.mid);
  });

  it("hits the beams in order of distance from the impact", () => {
    const g = mirrorGeo({ ...base, ownerSide: "you" });
    expect(g.tb[1]).toBeLessThan(g.tb[0]);
    expect(g.tb[0]).toBeCloseTo(g.tb[2], 6);
    expect(g.tbMin).toBe(g.tb[1]);
  });

  it("does not lean an incoming attacker", () => {
    const lean = mirrorGeo({ ...base, ownerSide: "you" });
    const flat = mirrorGeo({ ...base, ownerSide: "you", incoming: true });
    expect(flat.at[1].y).toBe(150);
    expect(lean.at[1].y).not.toBe(150);
  });

  it("falls back when the board has no rows and no victims", () => {
    const g = mirrorGeo({ wx: [], wy: [], attacker: null, ownerSide: "you", rowYou: null, rowOpp: null, incoming: false });
    expect(g.attacker).toBe(-1);
    expect(Number.isFinite(g.cyM)).toBe(true);
    expect(Number.isFinite(g.tbMin)).toBe(true);
  });
});

describe("mirror plan", () => {
  for (const n of [1, 3, 5]) {
    it(`plans ${n} victims: each breaks after the impact, inside the cap`, () => {
      const { scene, cues } = planScene(input(n));
      expect(scene.victims).toHaveLength(n);
      expect(scene.incoming).toBe(false);
      expect(scene.hitMs).toBe(600);
      for (const v of scene.victims) {
        expect(v.atMs).toBeGreaterThan(scene.hitMs);
        expect(v.atMs).toBeLessThan(scene.totalMs);
      }
      expect(scene.totalMs).toBeLessThanOrEqual(6000);
      expect(cues.map((c) => c.cue)).toEqual(expect.arrayContaining(["mirror-rise", "mirror-reflect", "glass-break"]));
    });
  }

  it("breaks the nearer cards first", () => {
    const { scene } = planScene(input(5));
    // the attacker is XS[1]; the card at XS[1] breaks no later than the far end
    expect(scene.victims[1].atMs).toBeLessThanOrEqual(scene.victims[4].atMs);
    expect(scene.victims[1].atMs).toBeLessThanOrEqual(scene.victims[0].atMs);
  });

  it("meets an incoming attack at its impact and shifts the rest", () => {
    const a = planScene(input(3)).scene;
    const b = planScene(input(3, { impact: 1400 })).scene;
    expect(b.incoming).toBe(true);
    expect(b.hitMs).toBe(1400);
    for (const v of b.victims) expect(v.atMs).toBeGreaterThan(1400);
    expect(b.totalMs).toBeGreaterThan(a.totalMs);
  });

  it("still plays the piece for one victim with an incoming attack", () => {
    const { scene } = planScene(input(1, { impact: 800 }));
    expect(scene.victims).toHaveLength(1);
    expect(scene.incoming).toBe(true);
    expect(scene.victims[0].atMs).toBeGreaterThan(800);
  });

  it("plans the opponent as the caster", () => {
    const { scene } = planScene(input(3, { caster: "opp" }));
    expect(scene.ownerSide).toBe("opp");
    expect(scene.victims).toHaveLength(3);
    for (const v of scene.victims) expect(v.atMs).toBeGreaterThan(scene.hitMs);
  });
});

describe("mirror wipe", () => {
  const cases: [string, SceneInput][] = [
    ["1 victim", input(1)],
    ["3 victims", input(3)],
    ["5 victims", input(5)],
    ["incoming attack", input(3, { impact: 1100 })],
    ["incoming, early", input(3, { impact: 300 })],
    ["opponent casts", input(3, { caster: "opp" })],
    ["no source", input(3, { source: false })],
    ["no victims", input(0)],
  ];
  for (const [name, inp] of cases) {
    it(`runs the whole plan: ${name}`, () => {
      const { scene } = planScene(inp);
      const e = env();
      const inst = wipeFactory(buildMirror)(e, { rect: { x: 0, y: 0, w: 1120, h: 800 }, scene, seed: 4 });
      expect(inst.usesPost).toBe(true);
      for (let t = 0; t <= scene.totalMs / 1000 + 0.2; t += 0.04) {
        inst.update(t);
        const s = inst.shake?.(t);
        expect(Number.isFinite(s?.x ?? 0)).toBe(true);
      }
      // pure in t
      inst.update(1.3);
      const a = e.post.uFlash.value.toArray();
      inst.update(2.6);
      inst.update(1.3);
      expect(e.post.uFlash.value.toArray()).toEqual(a);
      // clean at the end
      inst.update(scene.totalMs / 1000);
      expect(e.post.uFlash.value.w).toBeLessThan(0.01);
      expect(e.post.uInvert.value).toBe(0);
      const end = inst.shake?.(scene.totalMs / 1000) ?? { x: 0, y: 0, rot: 0 };
      expect(Math.hypot(end.x, end.y)).toBeLessThan(0.5);
      inst.dispose();
      expect(e.group.children.length).toBe(0);
    });
  }
});
