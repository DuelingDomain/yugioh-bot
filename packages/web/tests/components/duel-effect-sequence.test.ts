import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DuelEvent } from "@yugidraft/shared/duels";
import { chainBeatAt, chainEffectAt, planChainBeats, resetChainBeats } from "@/components/duel/chain-beats";
import { MOVE_TIMING, planMoves, resetMoveSchedule } from "@/components/duel/move-plan";
import { armBattleDestroy, BREAK_SETTLE_MS, clearBattleHolds } from "@/components/duel/battle-hold";
import { CARDS as C } from "@/components/duel/fx-lab/cards";
import { registerDestroyScene } from "@/components/duel/destroy-scene-hold";
import { planScene, PIECE_TINTS } from "@/components/duel/fx3d/scene-plan";
import { findScenario } from "@/components/duel/fx-lab/scenarios";
import { numberSteps } from "@/components/duel/fx-lab/board";

const zone = (controller: number, location: number, sequence = 0) => ({ controller, location, sequence });
const geometry = () => ({ distance: 300 });
const options = (reduced: boolean, now = 1000) => ({ now, reduced, duelKey: "sequence", geometry });

// The engine emits the target MOVE before its deferred destroy marker, after CHAIN_SOLVED.
function sequence(source = C.mst, count = 1, fromHand = true, stays = false): DuelEvent[] {
  let id = 0;
  const event = (kind: DuelEvent["kind"], extra: Partial<DuelEvent> = {}): DuelEvent => ({ id: ++id, kind, text: kind, ...extra });
  const why = { cause: "effect" as const, sourceKind: source.type & 4 ? "trap" as const : "spell" as const, sourceCode: source.code, sourceSeat: 0 };
  return [
    ...(fromHand ? [event("move", { card: source, from: zone(0, 2), zone: zone(0, 8), reason: "activate" })] : []),
    event("activate", { card: source, zone: zone(0, 8), chainIndex: 1 }),
    event("chain-resolving", { card: source, chainIndex: 1 }),
    ...Array.from({ length: count }, (_, i) => event("move", { card: C.celtic, from: zone(1, 4, i), zone: zone(1, 16, i), reason: "destroy", ...why })),
    event("chain-resolved", { card: source, chainIndex: 1 }),
    ...Array.from({ length: count }, (_, i) => event("destroy", { card: C.celtic, zone: zone(1, 4, i), ...why })),
    ...(!stays ? [event("move", { card: source, from: zone(0, 8), zone: zone(0, 16), reason: "send" })] : []),
    event("chain-end"),
    event("activate", { card: C.sangan, zone: zone(1, 16), chainIndex: 1 }),
    event("chain-resolving", { card: C.sangan, chainIndex: 1 }),
    event("move", { card: C.kuriboh, from: zone(1, 1), zone: zone(1, 2), addedToHand: true }),
    event("chain-resolved", { chainIndex: 1 }),
    event("chain-end"),
  ];
}

beforeEach(() => { resetMoveSchedule("sequence"); resetChainBeats("sequence"); clearBattleHolds(); });

describe("spell/trap destruction presentation", () => {
  it("keeps a batch idempotent and restarts its complete sequence on replay", () => {
    const events = sequence(C.darkHole, 5);
    planChainBeats(events, options(false));
    const first = planMoves(events, options(false)).map((p) => [p.id, p.startAt, p.landAt]);
    expect(planMoves(events, options(false))).toEqual([]);
    resetMoveSchedule("replay"); resetChainBeats("replay");
    const replayOptions = { ...options(false), duelKey: "replay" };
    planChainBeats(events, replayOptions);
    expect(planMoves(events, replayOptions).map((p) => [p.id, p.startAt, p.landAt])).toEqual(first);
  });

  it("reconciles a draw spell with the complete activation clock too", () => {
    const events: DuelEvent[] = [
      { id: 1, kind: "move", text: "m", card: C.potOfGreed, from: zone(0, 2), zone: zone(0, 8), reason: "activate" },
      { id: 2, kind: "activate", text: "a", card: C.potOfGreed, zone: zone(0, 8), chainIndex: 1 },
      { id: 3, kind: "chain-resolving", text: "r", chainIndex: 1 },
      { id: 4, kind: "move", text: "draw", card: C.kuriboh, from: zone(0, 1), zone: zone(0, 2), reason: "draw" },
      { id: 5, kind: "chain-resolved", text: "r", chainIndex: 1 },
      { id: 6, kind: "move", text: "cleanup", card: C.potOfGreed, from: zone(0, 8), zone: zone(0, 16), reason: "send" },
      { id: 7, kind: "chain-end", text: "end" },
    ];
    planChainBeats(events, options(false));
    const plans = planMoves(events, options(false));
    expect(plans[1].startAt).toBeGreaterThanOrEqual(chainEffectAt(2) + 800);
    expect(plans[1].startAt).toBeGreaterThanOrEqual(chainEffectAt(4));
    expect(plans[2].startAt).toBeGreaterThanOrEqual(plans[1].landAt);
  });

  it("preserves a later battle's killing-strike hold when leaving a spell destruction sequence", () => {
    const events = sequence(C.sakuretsu, 1, false).slice(0, 7);
    const from = zone(0, 4, 1);
    armBattleDestroy("later-battle", from, 9000, 1000, true);
    events.push({ id: 20, kind: "move", text: "battle move", card: C.celtic, from, zone: zone(0, 16, 1), reason: "destroy", cause: "battle" },
      { id: 21, kind: "destroy", text: "battle destroy", card: C.celtic, zone: from, cause: "battle" });
    planChainBeats(events, options(false));
    const later = planMoves(events, options(false)).find((p) => p.id === 20)!;
    expect(later.startAt).toBeGreaterThanOrEqual(10000 + BREAK_SETTLE_MS);
  });

  it.each(["spell-destroy-sequence", "trap-destroy-sequence", "mass-destroy-sequence"])("presents the engine-shaped %s lab batch in order", (id) => {
    const script = findScenario(id)!.build();
    const events = numberSteps(script.steps, 0).flatMap((step) => step.events);
    planChainBeats(events, options(false));
    const plans = planMoves(events, options(false));
    const targets = plans.filter((p) => p.event.reason === "destroy");
    const cleanup = plans.find((p) => p.event.reason === "send")!;
    expect(targets.length).toBeGreaterThan(0);
    expect(cleanup.startAt).toBe(Math.max(...targets.map((p) => p.landAt + p.holdMs)));
    const later = plans.find((p) => p.event.reason === "draw" || p.event.addedToHand)!;
    expect(later.startAt).toBeGreaterThanOrEqual(cleanup.landAt);
    const resolved = events.find((e) => e.kind === "chain-resolved")!;
    expect(events.filter((e) => e.kind === "destroy").every((e) => e.id > resolved.id)).toBe(true);
  });

  it.each(["dark-hole", "raigeki", "torrential", "mirror-force", "mass-destroy"] as const)("finishes all %s breaks before its first canvas flight", (piece) => {
    const rect = { x: 0, y: 0, w: 96, h: 140 };
    const { scene } = planScene({ piece, sequential: true, victims: Array.from({ length: 10 }, (_, i) =>
      ({ code: C.celtic.code, rect: { ...rect, x: i * 100 }, defense: false, pile: rect })),
      source: rect, attacker: null, field: { ...rect, w: 1000 }, ownerSide: "you", tint: PIECE_TINTS[piece], attackImpactMs: null });
    expect(Math.min(...scene.victims.map((v) => v.landMs!))).toBeGreaterThanOrEqual(Math.max(...scene.victims.map((v) => v.atMs)));
  });

  it.each([false, true])("reschedules a render-captured scene before target flights and source cleanup (wipe=%s)", (wipe) => {
    const events = sequence(C.mst, 1);
    planChainBeats(events, options(false));
    const marker = events.find((e) => e.kind === "destroy")!;
    const victim = marker.zone!;
    const reschedule = vi.fn((at: number) => armBattleDestroy(`test:${at}`, victim, 1200, at, true,
      wipe ? { moveAfterMs: 1900 } : undefined));
    reschedule(1000);
    const scene = { startAt: 1000, handoffMs: wipe ? 1200 : 2200, totalMs: 2200, reschedule };
    const release = registerDestroyScene([marker.id], scene);
    try {
      const plans = planMoves(events, options(false));
      const activation = events.find((e) => e.kind === "activate")!;
      const target = plans.find((p) => p.event.reason === "destroy")!;
      const cleanup = plans.find((p) => p.event.reason === "send")!;
      expect(scene.startAt).toBeGreaterThanOrEqual(chainEffectAt(activation.id) + 800);
      expect(chainEffectAt(marker.id)).toBe(scene.startAt);
      expect(target.startAt).toBeGreaterThanOrEqual(scene.startAt + scene.handoffMs);
      expect(cleanup.startAt).toBeGreaterThanOrEqual(scene.startAt + scene.totalMs);
      expect(cleanup.startAt).toBeGreaterThanOrEqual(target.landAt);
      expect(reschedule).toHaveBeenCalledTimes(2);
    } finally { release(); }
  });

  for (const reduced of [false, true]) {
    it.each([
      { name: "spell from hand", source: C.mst, count: 1, fromHand: true, stays: false },
      { name: "set trap", source: C.sakuretsu, count: 1, fromHand: false, stays: false },
      { name: "mass destruction", source: C.darkHole, count: 5, fromHand: true, stays: false },
      { name: "continuous trap", source: { ...C.sakuretsu, type: 4 | 0x20000 }, count: 2, fromHand: false, stays: true },
    ])("orders all phases for $name (reduced=" + reduced + ")", ({ source, count, fromHand, stays }) => {
      const events = sequence(source, count, fromHand, stays);
      planChainBeats(events, options(reduced));
      const plans = planMoves(events, options(reduced));
      const activate = events.find((e) => e.kind === "activate")!;
      const incoming = plans.find((p) => p.event.reason === "activate");
      const targets = plans.filter((p) => p.event.reason === "destroy");
      const cleanup = plans.find((p) => p.event.reason === "send");
      const later = events.find((e) => e.kind === "activate" && e.card?.code === C.sangan.code)!;
      const activationAt = chainEffectAt(activate.id);
      if (incoming) expect(activationAt).toBeGreaterThanOrEqual(incoming.landAt);
      const activationEnd = activationAt + (reduced ? 320 : 800);
      for (const target of targets) {
        const destroy = events.find((e) => e.kind === "destroy" && e.zone?.sequence === target.event.from?.sequence)!;
        const destroyAt = chainEffectAt(destroy.id);
        expect(destroyAt).toBeGreaterThanOrEqual(activationEnd);
        expect(target.startAt).toBeGreaterThanOrEqual(destroyAt + (reduced ? 320 : target.leadMs));
      }
      const targetsEnd = Math.max(...targets.map((p) => p.landAt + p.holdMs));
      expect(new Set(targets.map((p) => p.startAt)).size).toBe(1);
      if (cleanup) expect(cleanup.startAt).toBe(targetsEnd);
      expect(chainBeatAt(later.id)).toBeGreaterThanOrEqual(cleanup ? cleanup.landAt : targetsEnd);
      expect(chainEffectAt(later.id)).toBeGreaterThanOrEqual(cleanup ? cleanup.landAt : targetsEnd);
      const added = plans.find((p) => p.event.addedToHand)!;
      expect(added.startAt).toBeGreaterThanOrEqual(cleanup ? cleanup.landAt : targetsEnd);
      expect(cleanup == null).toBe(stays);
    });
  }

  it.each(["draw", "destroy"] as const)("keeps a later %s batch behind the existing move queue", kind => {
    const earlier: DuelEvent[] = Array.from({ length: 8 }, (_, i) => ({ id: i + 1, kind: "move", text: "mill",
      card: C.celtic, from: zone(0, 1), zone: zone(0, 16, i), reason: "send" }));
    const first = planMoves(earlier, options(false));
    const last = first.at(-1)!;
    const queueStart = last.startAt + Math.max(last.durationMs * MOVE_TIMING.overlap, MOVE_TIMING.minGapMs);
    const batch: DuelEvent[] = kind === "draw" ? [
      { id: 20, kind: "activate", text: "Pot of Greed", card: C.potOfGreed, zone: zone(0, 8), chainIndex: 1 },
      { id: 21, kind: "chain-resolving", text: "resolve", chainIndex: 1 },
      { id: 22, kind: "move", text: "draw", card: C.kuriboh, from: zone(0, 1), zone: zone(0, 2), reason: "draw" },
      { id: 23, kind: "chain-resolved", text: "resolved", chainIndex: 1 },
      { id: 24, kind: "move", text: "cleanup", card: C.potOfGreed, from: zone(0, 8), zone: zone(0, 16), reason: "send" },
      { id: 25, kind: "chain-end", text: "end" },
    ] : sequence(C.mst, 3, false).slice(0, 10).map((event, i) => ({ ...event, id: i + 20 }));
    planChainBeats(batch, options(false, 1100));
    const second = planMoves(batch, options(false, 1100));
    for (const move of second) expect(move.startAt).toBeGreaterThanOrEqual(queueStart);
    if (kind === "destroy") {
      for (const marker of batch.filter(event => event.kind === "destroy")) {
        expect(chainEffectAt(marker.id)).toBeGreaterThanOrEqual(queueStart);
      }
    }
    const [next] = planMoves([{ ...earlier[0], id: 100 }], options(false, 1200));
    expect(next.startAt).toBeGreaterThanOrEqual(second.at(-1)!.startAt);
  });

  it.each([false, true])("preserves capped, overlapping mill flights between activation and cleanup (reduced=%s)", reduced => {
    const batch: DuelEvent[] = [
      { id: 1, kind: "activate", text: "spell", card: C.potOfGreed, zone: zone(0, 8), chainIndex: 1 },
      { id: 2, kind: "chain-resolving", text: "resolve", chainIndex: 1 },
      ...Array.from({ length: 10 }, (_, i): DuelEvent => ({ id: i + 3, kind: "move", text: "mill", card: C.celtic,
        from: zone(0, 1), zone: zone(0, 16, i), reason: "send" })),
      { id: 13, kind: "chain-resolved", text: "resolved", chainIndex: 1 },
      { id: 14, kind: "move", text: "cleanup", card: C.potOfGreed, from: zone(0, 8), zone: zone(0, 16, 10), reason: "send" },
      { id: 15, kind: "chain-end", text: "end" },
      { id: 16, kind: "activate", text: "later", card: C.sangan, zone: zone(0, 16), chainIndex: 1 },
    ];
    planChainBeats(batch, options(reduced));
    const plans = planMoves(batch, options(reduced));
    const mill = plans.filter(move => move.id < 14);
    for (let i = 1; i < mill.length; i++) {
      expect(mill[i].startAt - mill[i - 1].startAt).toBeCloseTo(Math.max(mill[i - 1].durationMs * MOVE_TIMING.overlap, MOVE_TIMING.minGapMs));
    }
    expect(mill.at(-1)!.landAt - mill[0].startAt).toBeLessThanOrEqual(MOVE_TIMING.queueCapMs);
    const cleanup = plans.find(move => move.id === 14)!;
    expect(cleanup.startAt).toBeGreaterThanOrEqual(Math.max(...mill.map(move => move.landAt + move.holdMs)));
    expect(chainBeatAt(16)).toBeGreaterThanOrEqual(cleanup.landAt);
  });

  it("preserves the later effect's queue layout after target destruction and source cleanup", () => {
    const batch = sequence(C.mst);
    const addedIndex = batch.findIndex(event => event.addedToHand);
    batch.splice(addedIndex, 1, ...Array.from({ length: 10 }, (_, i): DuelEvent => ({ id: 0, kind: "move", text: "mill",
      card: C.celtic, from: zone(1, 1), zone: zone(1, 16, i), reason: "send" })));
    batch.forEach((event, i) => { event.id = i + 1; });
    planChainBeats(batch, options(false));
    const plans = planMoves(batch, options(false));
    const cleanup = plans.find(move => move.event.card?.code === C.mst.code && move.event.reason === "send")!;
    const mill = plans.filter(move => move.event.text === "mill");
    expect(mill[0].startAt).toBeGreaterThanOrEqual(cleanup.landAt);
    for (let i = 1; i < mill.length; i++) {
      expect(mill[i].startAt - mill[i - 1].startAt).toBeCloseTo(Math.max(mill[i - 1].durationMs * MOVE_TIMING.overlap, MOVE_TIMING.minGapMs));
    }
  });

  it("keeps an activation's complete hold when resolution arrives in a later batch", () => {
    const events = sequence(C.mst);
    planChainBeats(events.slice(0, 2), options(false));
    const [incoming] = planMoves(events.slice(0, 2), options(false));
    planChainBeats(events.slice(2), options(false, 1100));
    const plans = planMoves(events.slice(2), options(false, 1100));
    const target = plans.find((p) => p.event.reason === "destroy")!;
    expect(target.startAt - target.leadMs).toBeGreaterThanOrEqual(incoming.landAt + 800);
  });
});
