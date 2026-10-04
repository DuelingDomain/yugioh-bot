import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { battleTiming } from "@/components/duel/attack-styles";
import { fieldPlacementMs } from "@/components/duel/placement-timing";
import { DEFAULT_TINT, groundTiltRad, PALETTES, Rig, type FxEnv } from "@/components/duel/fx3d/effects/base";
import { summonFactory, SUMMON_TINTS } from "@/components/duel/fx3d/effects/summon";
import { FxKit } from "@/components/duel/fx3d/kit";
import { setFx3dLook, setSharedFx3d } from "@/components/duel/fx3d/shared";
import { SUMMON3D_AUTHORED, type Summon3dKey } from "@/components/duel/fx3d/timeline";
import type { Fx3dApi, Fx3dPalette, FxRequest } from "@/components/duel/fx3d/types";

const REQUEST: FxRequest = { rect: { x: 600, y: 300, w: 90, h: 130 }, seed: 3 };

function envOf(extra: Partial<FxEnv> = {}): FxEnv {
  return {
    kit: new FxKit(),
    group: new THREE.Group(),
    view: { w: 1440, h: 900 },
    quality: 1,
    art: { peek: () => null, prefetch: () => undefined } as unknown as FxEnv["art"],
    post: {} as FxEnv["post"],
    ...extra,
  };
}

const KEYS = Object.keys(SUMMON3D_AUTHORED) as Summon3dKey[];

describe("fx3d table tilt", () => {
  it("lays ground rings and circles into the table plane and leaves billboards alone", () => {
    const rig = new Rig(envOf({ tilt: 15 }), REQUEST);
    expect(rig.mesh("ring", { w: 100 }).rotation.x).toBeCloseTo(-(15 * Math.PI) / 180, 6);
    expect(rig.mesh("rune", { w: 100 }).rotation.x).toBeCloseTo(-(15 * Math.PI) / 180, 6);
    expect(rig.mesh("vortex", { w: 100 }).rotation.x).toBeCloseTo(-(15 * Math.PI) / 180, 6);
    expect(rig.mesh("glow", { w: 100 }).rotation.x).toBe(0);
    expect(rig.mesh("pillar", { w: 100 }).rotation.x).toBe(0);
    rig.dispose();
  });

  it("builds the same meshes as V1 with tilt 0 and no palette", () => {
    const plain = new Rig(envOf(), REQUEST);
    const flat = new Rig(envOf({ tilt: 0, palette: "v1" }), REQUEST);
    for (const name of ["ring", "ripple", "rune", "glow"] as const) {
      const a = plain.mesh(name, { x: 4, y: -6, w: 80, h: 50, rot: 0.3 });
      const b = flat.mesh(name, { x: 4, y: -6, w: 80, h: 50, rot: 0.3 });
      expect(b.rotation.toArray()).toEqual(a.rotation.toArray());
      expect(b.position.toArray()).toEqual(a.position.toArray());
      expect(b.scale.toArray()).toEqual(a.scale.toArray());
      expect(a.rotation.x).toBe(0);
    }
    expect(flat.tint).toBe(DEFAULT_TINT);
    expect(plain.tint).toBe(DEFAULT_TINT);
  });

  it("ignores a tilt that is not a finite number", () => {
    expect(groundTiltRad(undefined)).toBe(0);
    expect(groundTiltRad(Number.NaN)).toBe(0);
    expect(groundTiltRad(0)).toBe(0);
  });

  it("solid palette uses the table gold and purple", () => {
    const solid = PALETTES.solid;
    expect(solid.gold.map((v) => Math.round(v * 255))).toEqual([0xc8, 0xa5, 0x5f]);
    expect(solid.goldHi.map((v) => Math.round(v * 255))).toEqual([0xe8, 0xcf, 0x94]);
    expect(solid.purple.map((v) => Math.round(v * 255))).toEqual([0x8f, 0x76, 0xf2]);
    expect(solid.purpleHi.map((v) => Math.round(v * 255))).toEqual([0xb8, 0xa8, 0xff]);
    expect(solid.loss.map((v) => Math.round(v * 255))).toEqual([0xf2, 0x7a, 0x6b]);
    expect(new Rig(envOf({ palette: "solid" }), REQUEST).tint).toBe(solid.tint);
    expect(PALETTES.v1.tint).toBe(DEFAULT_TINT);
  });
});

describe("fx3d durations do not depend on tilt or palette", () => {
  const looks: Array<{ tilt: number; palette: Fx3dPalette }> = [
    { tilt: 0, palette: "v1" },
    { tilt: 15, palette: "solid" },
    { tilt: 8, palette: "solid" },
  ];
  for (const key of KEYS) {
    it(`summon ${key} keeps SUMMON3D_AUTHORED timing`, () => {
      const expected = fieldPlacementMs(SUMMON3D_AUTHORED[key].total);
      for (const look of looks) {
        const instance = summonFactory(key)(envOf(look), { ...REQUEST, tint: key === "heavy" ? undefined : SUMMON_TINTS[key] });
        expect(instance.durationMs).toBe(expected);
        instance.dispose();
      }
    });
  }

  it("battleTiming is a pure function of the fight, not of the look", () => {
    const first = battleTiming("lose", "slash", "claw");
    expect(battleTiming("lose", "slash", "claw")).toEqual(first);
    expect(first.totalMs).toBeGreaterThan(first.impactMs);
  });
});

describe("shared look", () => {
  it("reaches the canvas now and when it is rebuilt, and resets", () => {
    const calls: string[] = [];
    const api = {
      ready: true,
      play: async () => undefined,
      prefetchArt: () => undefined,
      cancelAll: () => undefined,
      setTableTilt: (deg: number) => calls.push(`tilt:${deg}`),
      setPalette: (p: Fx3dPalette) => calls.push(`palette:${p}`),
    } as Fx3dApi;
    const host = {} as HTMLElement;
    setSharedFx3d({ api, host });
    setFx3dLook({ tilt: 15, palette: "solid" });
    setSharedFx3d(null);
    setSharedFx3d({ api, host });
    setFx3dLook({ tilt: 0, palette: "v1" });
    setSharedFx3d(null);
    expect(calls).toEqual(["tilt:0", "palette:v1", "tilt:15", "palette:solid", "tilt:15", "palette:solid", "tilt:0", "palette:v1"]);
  });
});
