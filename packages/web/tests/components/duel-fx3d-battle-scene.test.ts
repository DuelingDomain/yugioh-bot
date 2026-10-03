import { beforeEach, describe, expect, it } from "vitest";
import type { DuelEvent, DuelZoneRef } from "@yugidraft/shared/duels";
import { armBattleDestroy, attackImpactAt, battleBreakIs3d, battleDestroyAt, BREAK_SETTLE_MS, clearBattleHolds, HELD_CRACK_MS, noteAttackImpact } from "../../src/components/duel/battle-hold";
import { STYLE_IDS, battleKind, battleTiming, attackStyleFor } from "../../src/components/duel/attack-styles";
import { hexToRgb, planBattle, SHARD_TAIL_MS } from "../../src/components/duel/fx3d/battle-plan";
import { groupScenes, pieceOf, planScene, sceneCapMs } from "../../src/components/duel/fx3d/scene-plan";
import { pickBattleRoute } from "../../src/components/duel/fx3d/routing";
import { layoutShards, totalArea, type CutKind } from "../../src/components/duel/fx3d/shard-layout";
import { shardAt, shardMotion } from "../../src/components/duel/fx3d/shard-motion";
import { pairedMovePlan, planMoves, resetMoveSchedule } from "../../src/components/duel/move-plan";
import { holdPromptReveal, clearPromptRevealHold, waitForReveal } from "../../src/components/duel/prompt-reveal";

const MZONE = 0x04;
const GRAVE = 0x10;
const z = (controller: number, location: number, sequence: number): DuelZoneRef => ({ controller, location, sequence });
const card = { code: 1234, name: "Test", level: 4, type: 1 } as unknown as DuelEvent["card"];
const rect = (x: number, y: number) => ({ x, y, w: 60, h: 88 });
const tint = { main: [1, 0, 0] as [number, number, number], alt: [0, 0, 1] as [number, number, number], accent: [1, 1, 1] as [number, number, number] };

const destroy = (id: number, extra: Partial<DuelEvent>): DuelEvent =>
  ({ id, kind: "destroy", text: "d", seat: 0, zone: z(0, MZONE, id % 5), card, cause: "effect", ...extra }) as DuelEvent;

beforeEach(() => {
  clearBattleHolds();
  resetMoveSchedule("t");
  clearPromptRevealHold();
});

describe("scene routing by cause and source", () => {
  it("picks the named piece for each known source card", () => {
    const pieces: Record<number, string> = {
      44095762: "mirror-force", 56120475: "sakuretsu", 53582587: "torrential", 53129443: "dark-hole",
      12580477: "raigeki", 29401950: "bottomless", 4206964: "trap-hole",
    };
    for (const [code, piece] of Object.entries(pieces)) {
      expect(pieceOf(destroy(1, { sourceCode: Number(code), sourceKind: "trap" }))).toBe(piece);
    }
  });

  it("falls back by source kind and ignores battle and rule destroys", () => {
    expect(pieceOf(destroy(1, { sourceCode: 99, sourceKind: "trap" }))).toBe("trap");
    expect(pieceOf(destroy(1, { sourceCode: 99, sourceKind: "spell" }))).toBe("spell");
    expect(pieceOf(destroy(1, { sourceCode: 99, sourceKind: "monster" }))).toBe("monster");
    expect(pieceOf(destroy(1, { sourceKind: undefined }))).toBeNull();
    expect(pieceOf(destroy(1, { cause: "battle", sourceCode: 44095762 }))).toBeNull();
    expect(pieceOf(destroy(1, { cause: "rule", sourceKind: "trap" }))).toBeNull();
  });

  it("groups destroys of the same source in one snapshot into one piece", () => {
    const events = [
      destroy(1, { sourceCode: 53129443, sourceSeat: 0, sourceKind: "spell" }),
      destroy(2, { sourceCode: 53129443, sourceSeat: 0, sourceKind: "spell" }),
      destroy(3, { sourceCode: 12580477, sourceSeat: 1, sourceKind: "spell" }),
      destroy(4, { cause: "battle" }),
      destroy(5, { sourceCode: 53129443, sourceSeat: 0, sourceKind: "spell" }),
    ];
    const groups = groupScenes(events);
    expect(groups.map((g) => g.piece)).toEqual(["dark-hole", "raigeki"]);
    expect(groups[0].events.map((e) => e.id)).toEqual([1, 2, 5]);
  });
});

describe("scene timing", () => {
  const base = { victims: [rect(0, 0), rect(100, 0), rect(200, 0)].map((r) => ({ rect: r, code: 1, defense: false })), source: null, attacker: rect(100, -300), field: { x: 0, y: 0, w: 260, h: 88 }, ownerSide: "you" as const, tint, attackImpactMs: null };

  it("breaks every victim inside the life cap, with a tail after the last", () => {
    for (const piece of ["mirror-force", "sakuretsu", "torrential", "dark-hole", "raigeki", "bottomless", "trap-hole", "trap", "spell", "monster"] as const) {
      const { scene, cues } = planScene({ ...base, piece });
      expect(scene.victims).toHaveLength(3);
      expect(scene.totalMs).toBeLessThanOrEqual(sceneCapMs(piece));
      expect(scene.totalMs).toBeGreaterThan(Math.max(...scene.victims.map((v) => v.atMs)));
      expect(cues.length).toBeGreaterThan(0);
    }
  });

  it("Mirror Force meets an incoming attack exactly at its impact", () => {
    const plain = planScene({ ...base, piece: "mirror-force" }).scene;
    expect(plain.incoming).toBe(false);
    const { scene } = planScene({ ...base, piece: "mirror-force", attackImpactMs: 900 });
    expect(scene.incoming).toBe(true);
    expect(scene.hitMs).toBe(900);
    for (const v of scene.victims) expect(v.atMs).toBeGreaterThan(900);
  });

  it("Torrential Tribute takes all cards in one flood, inside 0.1 s of each other", () => {
    const { scene } = planScene({ ...base, piece: "torrential" });
    const times = scene.victims.map((v) => v.atMs);
    expect(Math.max(...times) - Math.min(...times)).toBeLessThanOrEqual(100);
  });
});

describe("battle plan", () => {
  it("uses battleTiming for every strike and break", () => {
    for (const a of STYLE_IDS) {
      for (const d of STYLE_IDS) {
        const timing = battleTiming("lose", a, d);
        const side = (style: typeof a, x: number) => ({ rect: rect(x, 0), code: 0, style, tint: attackStyleFor({}).tint, signature: null, defense: false });
        const plan = planBattle({ kind: "lose", timing, attacker: side(a, 0), defender: side(d, 200), hit: rect(200, 0) });
        expect(plan.strikes[0].impactMs).toBe(timing.impactMs);
        expect(plan.strikes[1].impactMs).toBe(timing.attackerDamageMs);
        expect(plan.breaks).toHaveLength(1);
        expect(plan.breaks[0].atMs).toBe(timing.attackerBreakMs);
        expect(plan.totalMs).toBeGreaterThanOrEqual(Math.min(timing.totalMs, (timing.attackerBreakMs as number) + SHARD_TAIL_MS));
      }
    }
  });

  it("strikes back after a tie and a bounce too, and breaks both cards together on a tie", () => {
    const tint0 = attackStyleFor({}).tint;
    const s = (x: number) => ({ rect: rect(x, 0), code: 5, style: "slash" as const, tint: tint0, signature: null, defense: false });
    for (const kind of ["tie", "bounce"] as const) {
      const timing = battleTiming(kind, "slash", "beam");
      const plan = planBattle({ kind, timing, attacker: s(0), defender: { ...s(200), style: "beam" }, hit: rect(200, 0) });
      expect(plan.strikes).toHaveLength(2);
      expect(plan.strikes[1].startMs).toBeGreaterThan(timing.impactMs);
      expect(plan.strikes[1].impactMs).toBe(timing.attackerDamageMs);
      // every break comes after the counter strike landed
      for (const entry of plan.breaks) expect(entry.atMs).toBeGreaterThan(timing.attackerDamageMs);
      expect(plan.breaks).toHaveLength(kind === "tie" ? 2 : 0);
    }
  });

  it("breaks the target on a win and nothing on a held fight", () => {
    const tint0 = attackStyleFor({}).tint;
    const s = (x: number) => ({ rect: rect(x, 0), code: 5, style: "slash" as const, tint: tint0, signature: null, defense: false });
    const win = planBattle({ kind: "win", timing: battleTiming("win", "slash", "slash"), attacker: s(0), defender: s(200), hit: rect(200, 0) });
    expect(win.breaks.map((b) => b.rect.x)).toEqual([200]);
    const held = planBattle({ kind: "held", timing: battleTiming("held", "slash", "slash"), attacker: s(0), defender: s(200), hit: rect(200, 0) });
    expect(held.breaks).toHaveLength(0);
    expect(battleKind(true, { target: false, attacker: false } as never)).toBeDefined();
  });

  it("parses hex colours", () => {
    expect(hexToRgb("#ff0000")).toEqual([1, 0, 0]);
    expect(hexToRgb("0f0")).toEqual([0, 1, 0]);
    expect(hexToRgb("zzz")).toEqual([1, 1, 1]);
  });

  it("chooses the layer once by motion and readiness", () => {
    expect(pickBattleRoute({ reduced: false, ready: true })).toBe("three");
    expect(pickBattleRoute({ reduced: true, ready: true })).toBe("dom");
    expect(pickBattleRoute({ reduced: false, ready: false })).toBe("dom");
  });
});

describe("shards", () => {
  it("covers the whole card exactly once for every cut", () => {
    const kinds: CutKind[] = ["slash", "claw", "beam", "arcane", "lightning", "flame", "impact", "shatter"];
    for (const kind of kinds) {
      for (const seed of [1, 7, 99]) expect(totalArea(layoutShards(kind, seed))).toBeCloseTo(1, 3);
    }
  });

  it("moves shards down under gravity and fades them out", () => {
    const piece = layoutShards("impact", 3)[0];
    const m = shardMotion(piece, { kind: "impact", w: 60, h: 88, dir: { x: 0, y: 1 }, seed: 3 }, 0);
    const early = shardAt(m, 0.05);
    const late = shardAt(m, m.life + m.delay + 0.01);
    expect(early.alpha).toBe(1);
    expect(late.alpha).toBe(0);
    expect(shardAt(m, 0.6).dy).toBeLessThan(shardAt(m, 0.2).dy);
  });
});

describe("holds and claims", () => {
  it("keeps the hold, the claim and the impact note per key", () => {
    armBattleDestroy("a", z(0, MZONE, 1), 800, 100, true);
    expect(battleDestroyAt(z(0, MZONE, 1), 200)).toBe(900);
    expect(battleBreakIs3d(z(0, MZONE, 1), 200)).toBe(true);
    expect(battleBreakIs3d(z(0, MZONE, 2), 200)).toBe(false);
    // passed: the claim goes with the hold
    expect(battleBreakIs3d(z(0, MZONE, 1), 1000)).toBe(false);
    noteAttackImpact(5, 1234);
    expect(attackImpactAt(5)).toBe(1234);
    expect(attackImpactAt(6)).toBe(0);
  });

  it("a claimed destroy sends the card to the Graveyard after the shards settled, without a flight", () => {
    const events: DuelEvent[] = [
      destroy(1, { zone: z(0, MZONE, 2) }),
      { id: 2, kind: "move", text: "m", seat: 0, from: z(0, MZONE, 2), zone: z(0, GRAVE, 0), card, reason: "destroy" } as DuelEvent,
    ];
    armBattleDestroy("s", z(0, MZONE, 2), 900, 100, true);
    const [plan] = planMoves(events, { now: 100, reduced: false, duelKey: "t", geometry: () => ({ distance: 300 }) });
    expect(plan.style).toBe("fade");
    expect(plan.startAt).toBeGreaterThanOrEqual(1000 + BREAK_SETTLE_MS);
    expect(plan.leadMs).toBe(0);
    expect(pairedMovePlan(1)?.id).toBe(2);
  });

  it("an unclaimed hold keeps the flight and the short crack", () => {
    const events: DuelEvent[] = [
      destroy(1, { zone: z(0, MZONE, 2) }),
      { id: 2, kind: "move", text: "m", seat: 0, from: z(0, MZONE, 2), zone: z(0, GRAVE, 0), card, reason: "destroy" } as DuelEvent,
    ];
    armBattleDestroy("s", z(0, MZONE, 2), 900, 100);
    const [plan] = planMoves(events, { now: 100, reduced: false, duelKey: "t", geometry: () => ({ distance: 300 }) });
    expect(plan.style).not.toBe("fade");
    // the card cracks at the hold; the flight waits for the DOM halves to be seen, so the lead grows by that wait
    expect(plan.leadMs).toBe(HELD_CRACK_MS + BREAK_SETTLE_MS);
    expect(plan.startAt - plan.leadMs).toBe(900 + 100 - HELD_CRACK_MS);
  });

  it("a scene hold keeps the prompt panel hidden until the piece is done", async () => {
    holdPromptReveal(160);
    holdPromptReveal(40);
    const start = Date.now();
    const ok = await waitForReveal({ source: null, reducedMotion: false, timing: { beatMs: 0, settleMs: 0, capMs: 2000 } });
    expect(ok).toBe(true);
    expect(Date.now() - start).toBeGreaterThanOrEqual(140);
  });
});
