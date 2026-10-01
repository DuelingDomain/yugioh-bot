import { describe, expect, it } from "vitest";
import type { DuelEvent, DuelZoneRef } from "@yugidraft/shared/duels";
import { PIECE_TINTS, SOURCE_PIECES, WIPE, groupScenes, isWipePiece, pieceOf, planScene, sceneCapMs, type SceneInput } from "../../src/components/duel/fx3d/scene-plan";
import type { FxScenePiece } from "../../src/components/duel/fx3d/types";
import { timeWarp } from "../../src/components/duel/fx3d/wipe-math";

const MZONE = 0x04;
const SZONE = 0x08;
const z = (controller: number, location: number, sequence: number): DuelZoneRef => ({ controller, location, sequence });
const card = { code: 1234, name: "Test", level: 4, type: 1 } as unknown as DuelEvent["card"];

const destroy = (id: number, extra: Partial<DuelEvent> = {}): DuelEvent =>
  ({ id, kind: "destroy", text: "d", seat: 0, zone: z(0, MZONE, id % 5), card, cause: "effect", ...extra }) as DuelEvent;
const move = (id: number, extra: Partial<DuelEvent> = {}): DuelEvent =>
  ({ id, kind: "move", text: "m", seat: 0, zone: z(0, 0x20, 0), from: z(0, MZONE, id % 5), card, reason: "banish", sourceCode: 777, sourceSeat: 0, ...extra }) as DuelEvent;
const link = (id: number, kind: "chain-resolving" | "chain-resolved"): DuelEvent => ({ id, kind, text: "c", seat: 0 }) as DuelEvent;

describe("wipe routing", () => {
  it("knows the passcodes of the five wipe cards", () => {
    expect(SOURCE_PIECES[53129443]).toBe("dark-hole");
    expect(SOURCE_PIECES[12580477]).toBe("raigeki");
    expect(SOURCE_PIECES[53582587]).toBe("torrential");
    expect(SOURCE_PIECES[18144506]).toBe("feather-duster");
    expect(SOURCE_PIECES[19613556]).toBe("heavy-storm");
    expect(pieceOf(destroy(1, { sourceCode: 18144506, sourceKind: "spell", zone: z(0, SZONE, 1) }))).toBe("feather-duster");
  });

  it("flags every wipe piece and no old piece", () => {
    const wipes: FxScenePiece[] = ["dark-hole", "raigeki", "torrential", "feather-duster", "heavy-storm", "banish-all", "mass-destroy"];
    for (const piece of wipes) expect(isWipePiece(piece)).toBe(true);
    for (const piece of ["mirror-force", "sakuretsu", "bottomless", "trap-hole", "trap", "spell", "monster"] as const) expect(isWipePiece(piece)).toBe(false);
  });

  it("gives wipes a longer life cap than the old pieces", () => {
    expect(sceneCapMs("dark-hole")).toBeGreaterThan(sceneCapMs("trap"));
    expect(sceneCapMs("mass-destroy")).toBeGreaterThanOrEqual(5000);
  });

  it("routes a banish or send from the field to banish-all, and nothing else", () => {
    expect(pieceOf(move(1))).toBe("banish-all");
    expect(pieceOf(move(1, { reason: "send" }))).toBe("banish-all");
    expect(pieceOf(move(1, { from: z(0, 0x02, 0) }))).toBeNull();
    expect(pieceOf(move(1, { reason: "draw" as never }))).toBeNull();
    expect(pieceOf(move(1, { sourceCode: undefined }))).toBeNull();
  });

  it("plays banish-all only for two or more cards of one link", () => {
    expect(groupScenes([move(1)])).toEqual([]);
    const groups = groupScenes([move(1), move(2), move(3)]);
    expect(groups.map((g) => g.piece)).toEqual(["banish-all"]);
    expect(groups[0].events).toHaveLength(3);
  });

  it("splits two links of one source into two groups", () => {
    const groups = groupScenes([move(1), move(2), link(3, "chain-resolved"), link(4, "chain-resolving"), move(5), move(6)]);
    expect(groups).toHaveLength(2);
    expect(groups[1].key.endsWith("#2")).toBe(true);
  });

  it("turns 2+ unnamed effect destroys of one link into mass-destroy", () => {
    const groups = groupScenes([destroy(1, { sourceCode: 99, sourceKind: "monster" }), destroy(2, { sourceCode: 99, sourceKind: "monster" })]);
    expect(groups.map((g) => g.piece)).toEqual(["mass-destroy"]);
  });

  it("also does it when the source kind is unknown", () => {
    const groups = groupScenes([destroy(1, { sourceCode: 99 }), destroy(2, { sourceCode: 99 })]);
    expect(groups.map((g) => g.piece)).toEqual(["mass-destroy"]);
  });

  it("keeps a lone unnamed destroy on its trap, spell or monster piece", () => {
    expect(groupScenes([destroy(1, { sourceCode: 99, sourceKind: "trap" })]).map((g) => g.piece)).toEqual(["trap"]);
    expect(groupScenes([destroy(1, { sourceCode: 99, sourceKind: "spell" })]).map((g) => g.piece)).toEqual(["spell"]);
    expect(groupScenes([destroy(1, { sourceCode: 99 })])).toEqual([]);
  });

  it("keeps a named piece even for one victim, and never merges it into mass-destroy", () => {
    const one = groupScenes([destroy(1, { sourceCode: 12580477, sourceKind: "spell" })]);
    expect(one.map((g) => g.piece)).toEqual(["raigeki"]);
    const many = groupScenes([destroy(1, { sourceCode: 19613556, sourceKind: "spell" }), destroy(2, { sourceCode: 19613556, sourceKind: "spell" })]);
    expect(many.map((g) => g.piece)).toEqual(["heavy-storm"]);
  });

  it("ignores battle destroys", () => {
    expect(groupScenes([destroy(1, { cause: "battle", sourceCode: 99 }), destroy(2, { cause: "battle", sourceCode: 99 })])).toEqual([]);
  });
});

const tint = PIECE_TINTS["mass-destroy"];
const rectAt = (x: number, y: number) => ({ x, y, w: 96, h: 140 });
const world = { cx: 560, cy: 400, u: 1, vw: 1120, vh: 800 };
const input = (piece: FxScenePiece, extra: Partial<SceneInput> = {}): SceneInput => ({
  piece,
  victims: [rectAt(100, 100), rectAt(300, 100), rectAt(500, 100), rectAt(700, 500), rectAt(900, 500)].map((rect, i) => ({ rect, code: 100 + i, defense: false, pile: rectAt(1000, 650) })),
  source: rectAt(480, 600),
  attacker: null,
  field: { x: 100, y: 100, w: 900, h: 140 },
  ownerSide: "you",
  tint,
  attackImpactMs: null,
  world,
  ...extra,
});

const WIPES: FxScenePiece[] = ["dark-hole", "raigeki", "torrential", "feather-duster", "heavy-storm", "banish-all", "mass-destroy"];

describe("wipe plans", () => {
  it("keeps the time order take < gone < land < end < total for every victim", () => {
    for (const piece of WIPES) {
      const { scene } = planScene(input(piece));
      expect(scene.victims).toHaveLength(5);
      for (const v of scene.victims) {
        expect(v.takeMs).toBeDefined();
        expect(v.takeMs as number).toBeGreaterThanOrEqual(0);
        expect(v.takeMs as number).toBeLessThan(v.atMs);
        expect(v.endMs as number).toBeGreaterThan(v.atMs);
        expect(v.endMs as number).toBeGreaterThan(v.landMs as number);
        expect(v.endMs as number).toBeLessThan(scene.totalMs);
      }
      expect(scene.totalMs).toBeLessThanOrEqual(sceneCapMs(piece));
    }
  });

  it("gives the demo lengths", () => {
    expect(planScene(input("dark-hole")).scene.totalMs).toBeGreaterThanOrEqual(WIPE.darkHole.d * 1000);
    expect(planScene(input("raigeki")).scene.totalMs).toBeGreaterThanOrEqual(WIPE.raigeki.d * 1000);
    expect(planScene(input("torrential")).scene.totalMs).toBeGreaterThanOrEqual(WIPE.torrential.d * 1000);
  });

  it("puts the Dark Hole cue after the time freeze and keeps the blast in the plan", () => {
    const { scene, cues } = planScene(input("dark-hole"));
    const tw = timeWarp(WIPE.darkHole.tf, WIPE.darkHole.fd, WIPE.darkHole.rate);
    expect(scene.marks?.strike).toBe(Math.round(tw.inv(WIPE.darkHole.blast) * 1000));
    expect(cues.map((c) => c.cue)).toContain("black-hole");
    expect(cues.map((c) => c.cue)).toContain("shock-boom");
  });

  it("keeps Raigeki cards whole until the bolt, then breaks them together", () => {
    const { scene } = planScene(input("raigeki"));
    for (const v of scene.victims) {
      expect(v.atMs).toBeGreaterThan(WIPE.raigeki.th * 1000);
      expect(v.takeMs as number).toBeLessThan(WIPE.raigeki.th * 1000);
    }
  });

  it("sweeps the storm from the left to the right", () => {
    const { scene } = planScene(input("heavy-storm"));
    const byX = [...scene.victims].sort((a, b) => (a.wx as number) - (b.wx as number));
    for (let i = 1; i < byX.length; i += 1) expect(byX[i].atMs).toBeGreaterThanOrEqual(byX[i - 1].atMs);
  });

  it("sends the landing streaks from the left to the right", () => {
    for (const piece of WIPES) {
      const { scene } = planScene(input(piece));
      const byX = [...scene.victims].sort((a, b) => (a.wx as number) - (b.wx as number));
      for (let i = 1; i < byX.length; i += 1) expect(byX[i].landMs as number).toBeGreaterThanOrEqual(byX[i - 1].landMs as number);
    }
  });

  it("maps a victim to world units with y up", () => {
    const { scene } = planScene(input("raigeki"));
    const first = scene.victims[0];
    expect(first.wx).toBeCloseTo(100 + 48 - 560);
    expect(first.wy).toBeCloseTo(400 - (100 + 70));
    expect(scene.world).toEqual(world);
  });

  it("derives a world when none is given", () => {
    const { scene } = planScene(input("raigeki", { world: undefined }));
    expect(scene.world?.u).toBeGreaterThan(0);
  });

  it("plans an empty wipe without throwing", () => {
    for (const piece of WIPES) {
      const { scene } = planScene(input(piece, { victims: [] }));
      expect(scene.victims).toEqual([]);
      expect(scene.totalMs).toBeGreaterThan(0);
    }
  });

  it("plans spell and trap victims like any other card", () => {
    const { scene } = planScene(input("feather-duster", { victims: [{ rect: rectAt(200, 600), code: 5, defense: false, st: true, pile: null }] }));
    expect(scene.victims[0].st).toBe(true);
    expect(scene.victims[0].pile).toBeNull();
  });

  it("is stable: the same input gives the same plan", () => {
    for (const piece of WIPES) expect(planScene(input(piece))).toEqual(planScene(input(piece)));
  });

  it("gives every wipe at least one sound cue", () => {
    for (const piece of WIPES) expect(planScene(input(piece)).cues.length).toBeGreaterThan(0);
  });
});
