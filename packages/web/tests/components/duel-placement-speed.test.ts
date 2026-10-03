import { beforeEach, describe, expect, it } from "vitest";
import type { DuelEvent } from "@yugidraft/shared/duels";
import { baseDuration, planMoves, resetMoveSchedule } from "@/components/duel/move-plan";
import { resetChainBeats, chainEffectAt, planChainBeats } from "@/components/duel/chain-beats";
import { clearBattleHolds } from "@/components/duel/battle-hold";
import { ATTACK_PACE, BANNER_TIMING, CARD_FX, MOVE_PACE, PHASE_TIMING } from "@/components/duel/duel-timing";
import { HEAVY_TIMELINE, TYPED_SCALE } from "@/components/duel/summon-fx";
import { fieldPlacementMs, isFlipSummonPlacement } from "@/components/duel/placement-timing";
import { SUMMON3D_TIMELINE } from "@/components/duel/fx3d/timeline";
import { createDuelFxClock } from "@/components/duel/fx-clock";

const zone = (location: number, sequence = 0) => ({ controller: 0, location, sequence });
const card = { code: 123, name: "Test card", type: 1, description: "", attack: 1000, defense: 1000, level: 4, race: "Warrior", attribute: 1 };
const options = { now: 1000, reduced: false, duelKey: "placement-speed", geometry: () => ({ distance: 300 }) };
beforeEach(() => { resetMoveSchedule(options.duelKey); resetChainBeats(options.duelKey); clearBattleHolds(); });

describe("field placement baseline", () => {
  it.each([1, 2, 16, 32, 64])("makes field arrivals from location %s exactly five percent shorter", (from) => {
    for (const [to, sequence] of [[4, 0], [8, 0], [8, 5], [8, 6], [8, 7], [256, 0], [512, 0]]) {
      resetMoveSchedule(options.duelKey);
      const event: DuelEvent = { id: 1, kind: "move", text: "Place", card, from: zone(from), zone: zone(to, sequence) };
      const [plan] = planMoves([event], options);
      expect(plan.durationMs).toBeCloseTo(742 * 0.95);
    }
  });
  it.each(["summon", "set", "activate"] as const)("keeps %s paired to its faster field arrival", (kind) => {
    const events: DuelEvent[] = [
      { id: 1, kind: "move", text: "Place", card, from: zone(2), zone: zone(kind === "activate" ? 8 : 4) },
      { id: 2, kind, text: kind, card, zone: zone(kind === "activate" ? 8 : 4) },
    ];
    const [plan] = planMoves(events, options);
    expect(plan.pairedIds).toContain(2);
    expect(plan.durationMs).toBeCloseTo(742 * 0.95);
  });
  it("speeds up heavy, typed and flip placement beats by 5%", () => {
    expect(HEAVY_TIMELINE.handOver).toBeCloseTo(890 * 0.95);
    expect(TYPED_SCALE).toBe(0.95);
    expect(fieldPlacementMs(CARD_FX.flipRevealMs)).toBeCloseTo(820 * 0.95);
    expect(fieldPlacementMs(CARD_FX.flipFaceAtMs)).toBeCloseTo(560 * 0.95);
    for (const [key, original] of Object.entries({ fusion: 1340, synchro: 1360, xyz: 1380, link: 1280, ritual: 1360, pendulum: 1380, heavy: 1180 })) {
      expect(SUMMON3D_TIMELINE[key as keyof typeof SUMMON3D_TIMELINE].handOver).toBeCloseTo(original * 0.95);
    }
  });
  it("speeds up only a Flip Summon's position reveal", () => {
    const position: DuelEvent = { id: 1, kind: "position", text: "Reveal", zone: zone(4), card };
    const flip: DuelEvent = { id: 2, kind: "summon", text: "Flip", zone: zone(4), card, summonKind: "flip" };
    expect(isFlipSummonPlacement(position, [position, flip])).toBe(true);
    expect(isFlipSummonPlacement(position, [position])).toBe(false);
    expect(isFlipSummonPlacement(position, [{ ...flip, zone: zone(4, 1) }])).toBe(false);
    expect(CARD_FX.flipRevealMs).toBe(820);
    expect(CARD_FX.turnMs).toBe(600);
    expect(baseDuration("place", 300, false, false)).toBe(742);
  });
  it("retains the existing hand-entry, battle and phase timing baselines and reduced fade", () => {
    expect(MOVE_PACE.drawMs).toBe(667);
    expect(MOVE_PACE.handMinGapMs).toBe(252);
    expect(ATTACK_PACE).toBe(1.4);
    expect(PHASE_TIMING.beatMs).toBe(900);
    expect(BANNER_TIMING.eventMs).toBe(1600);
    const [plan] = planMoves([{ id: 1, kind: "move", text: "Place", card, from: zone(2), zone: zone(4) }], { ...options, reduced: true });
    expect(plan.durationMs).toBe(MOVE_PACE.reducedMs);
  });
});

describe("scaled effect sequence", () => {
  it.each([0.5, 1, 2])("preserves activation → destroy → GY at %sx using the real move and chain planners", (speed) => {
    const spell = { ...card, code: 456, type: 2 };
    const events: DuelEvent[] = [
      { id: 1, kind: "move", text: "Place", card: spell, from: zone(2), zone: zone(8), reason: "activate" },
      { id: 2, kind: "activate", text: "Activate", card: spell, zone: zone(8), chainIndex: 1 },
      { id: 3, kind: "chain-resolving", text: "Resolve", card: spell, chainIndex: 1 },
      { id: 4, kind: "move", text: "Destroy", card, from: zone(4), zone: zone(16), reason: "destroy", cause: "effect", sourceKind: "spell", sourceSeat: 0, sourceCode: spell.code },
      { id: 5, kind: "chain-resolved", text: "Resolved", chainIndex: 1 },
      { id: 6, kind: "destroy", text: "Break", card, zone: zone(4), cause: "effect", sourceKind: "spell", sourceSeat: 0, sourceCode: spell.code },
      { id: 7, kind: "move", text: "Send", card: spell, from: zone(8), zone: zone(16), reason: "send" },
      { id: 8, kind: "chain-end", text: "End" },
    ];
    planChainBeats(events, options);
    const plans = planMoves(events, options);
    const fx = createDuelFxClock(() => speed, () => 0);
    const [incoming, victim, cleanup] = plans;
    const activateAt = chainEffectAt(2);
    const destroyAt = chainEffectAt(6);
    expect(activateAt).toBeGreaterThanOrEqual(incoming.landAt);
    expect(destroyAt).toBeGreaterThanOrEqual(activateAt + CARD_FX.activationMs);
    expect(victim.startAt).toBeGreaterThan(destroyAt);
    expect(cleanup.startAt).toBeGreaterThanOrEqual(victim.landAt);
    expect(plans.map((p) => p.event.id)).toEqual([1, 4, 7]);
    expect(events.map((e) => e.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    for (const plan of plans) expect(fx.realMs(plan.durationMs)).toBeCloseTo(plan.durationMs / speed);
    const realBeats = [incoming.landAt, activateAt, destroyAt, victim.startAt, victim.landAt, cleanup.startAt].map((at) => fx.realMs(at));
    expect(realBeats).toEqual([...realBeats].sort((a, b) => a - b));
  });
});
