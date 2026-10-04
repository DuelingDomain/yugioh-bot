import { describe, expect, it, vi } from "vitest";

vi.mock("next/font/google", () => {
  // ./fonts loads every duel family; the LP digits use Oxanium.
  const font = () => ({ className: "font", variable: "font-var", style: {} });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});

import { battleTiming, MAX_BATTLE_MS, STYLE_IDS, STYLE_TIMING } from "../../src/components/duel/attack-styles";
import {
  ADD_TO_HAND,
  ATTACK_PACE,
  ATTACK_TIMING,
  BANNER_TIMING,
  CARD_FX,
  CHAIN_TIMING,
  GATE_TIMING,
  LP_TIMING,
  MIN_VISIBLE_MS,
  MOVE_PACE,
  PHASE_TIMING,
  VISIBLE_EFFECT_MS,
} from "../../src/components/duel/duel-timing";
import { rollDurationMs } from "../../src/components/duel/life-points";
import { MOVE_TIMING } from "../../src/components/duel/move-plan";
import { showcasePhases } from "../../src/components/duel/add-to-hand";
import { RESULT_TIMING } from "../../src/components/duel/result-reveal";
import { REVEAL_TIMING } from "../../src/components/duel/prompt-reveal";

// The pace of the duel board: nothing may skip by too fast. These are the minimums, not exact values.
describe("duel pace minimums", () => {
  it("lets no visible effect run shorter than 400 ms", () => {
    expect(MIN_VISIBLE_MS).toBe(400);
    for (const [name, ms] of Object.entries(VISIBLE_EFFECT_MS)) {
      expect(ms, name).toBeGreaterThanOrEqual(MIN_VISIBLE_MS);
    }
  });

  it("plays every attack at least 1.3 times as long as the first pace", () => {
    expect(ATTACK_PACE).toBeGreaterThanOrEqual(1.3);
    const first: Record<string, number> = { slash: 520, claw: 500, beam: 440, arcane: 560, lightning: 450, flame: 540, impact: 470 };
    for (const id of STYLE_IDS) {
      expect(STYLE_TIMING[id].impact, id).toBeGreaterThanOrEqual(Math.round(first[id] * 1.3));
      expect(STYLE_TIMING[id].impact, id).toBeGreaterThanOrEqual(600);
      expect(STYLE_TIMING[id].total, id).toBeGreaterThanOrEqual(1500);
    }
  });

  it("gives a direct attack a longer finish than the strike alone (the plate takes the blow)", () => {
    for (const id of STYLE_IDS) {
      const direct = battleTiming("direct", id, null);
      expect(direct.totalMs, id).toBeGreaterThanOrEqual(STYLE_TIMING[id].total + ATTACK_TIMING.directTailMs);
      expect(direct.totalMs, id).toBeGreaterThanOrEqual(1700);
    }
  });

  it("keeps a beat between the hit and the break, and between the hit and the counter", () => {
    expect(ATTACK_TIMING.destroyBeatMs).toBeGreaterThanOrEqual(400);
    expect(ATTACK_TIMING.counterGapMs).toBeGreaterThanOrEqual(180);
    expect(ATTACK_TIMING.lpAfterHitMs).toBeGreaterThanOrEqual(100);
  });

  it("keeps the battle ceiling above the slowest fight", () => {
    let slowest = 0;
    for (const a of STYLE_IDS) {
      for (const d of STYLE_IDS) {
        for (const kind of ["win", "lose", "tie", "held", "bounce"] as const) slowest = Math.max(slowest, battleTiming(kind, a, d).totalMs);
      }
      slowest = Math.max(slowest, battleTiming("direct", a, null).totalMs);
    }
    expect(MAX_BATTLE_MS).toBeGreaterThanOrEqual(slowest);
  });

  it("rolls the life points at least 1.2 s, and up to 1.8 s for a large change", () => {
    expect(rollDurationMs(1)).toBeGreaterThanOrEqual(1200);
    expect(rollDurationMs(8000)).toBeGreaterThanOrEqual(1200);
    expect(rollDurationMs(8000)).toBeLessThanOrEqual(1800);
    expect(LP_TIMING.rollMinMs).toBeGreaterThanOrEqual(1200);
    expect(LP_TIMING.chipInMs).toBeGreaterThanOrEqual(MIN_VISIBLE_MS);
  });

  it("keeps every card flight at least 400 ms, even when a long queue is squeezed", () => {
    const shortest = Math.min(MOVE_PACE.placeMinMs, MOVE_PACE.tossMinMs, MOVE_PACE.drawMs);
    // A squeezed showcase keeps every leg: travel at least 400 ms, the hold at least 540 ms.
    const squeezed = showcasePhases(MOVE_TIMING.minSpeed, false);
    expect(squeezed.riseMs).toBeGreaterThanOrEqual(MIN_VISIBLE_MS);
    expect(squeezed.flyMs).toBeGreaterThanOrEqual(MIN_VISIBLE_MS);
    expect(squeezed.holdMs).toBeGreaterThanOrEqual(ADD_TO_HAND.holdMinMs);
    expect(ADD_TO_HAND.holdMinMs).toBeGreaterThanOrEqual(540);
    expect(ADD_TO_HAND.holdMs).toBeGreaterThanOrEqual(700);
    expect(ADD_TO_HAND.holdMs).toBeLessThanOrEqual(900);
    expect(shortest * MOVE_TIMING.minSpeed).toBeGreaterThanOrEqual(MIN_VISIBLE_MS);
    expect(MOVE_TIMING.minGapMs).toBeGreaterThanOrEqual(250);
    expect(MOVE_TIMING.handMinGapMs).toBeGreaterThanOrEqual(250);
  });

  it("keeps banners and chain beats readable, also when squeezed by a backlog", () => {
    expect(BANNER_TIMING.minCueMs).toBeGreaterThanOrEqual(MIN_VISIBLE_MS);
    expect(CHAIN_TIMING.floorMs).toBeGreaterThanOrEqual(300);
    for (const floor of Object.values(CHAIN_TIMING.readableFloorMs)) expect(floor).toBeGreaterThanOrEqual(500);
  });

  it("shows the face of an activated card for about 600 to 900 ms before its link may resolve", () => {
    expect(CARD_FX.activationFaceMs).toBeGreaterThanOrEqual(600);
    expect(CARD_FX.activationFaceMs).toBeLessThanOrEqual(900);
    expect(CARD_FX.activationMs).toBe(CARD_FX.activationFlipMs + CARD_FX.activationFaceMs);
    // One length for the ghost, the chain's activate beat and the banner: the banner ends as the link resolves.
    expect(CHAIN_TIMING.activateMs).toBe(CARD_FX.activationMs);
    expect(BANNER_TIMING.activateMs).toBe(CARD_FX.activationMs);
    // The effect of a resolving link starts after its resolving label has had time to read.
    expect(CHAIN_TIMING.effectLeadMs).toBeGreaterThanOrEqual(MIN_VISIBLE_MS);
  });

  it("lets the result and the prompt wait for a full life roll before their cap", () => {
    expect(RESULT_TIMING.capMs).toBeGreaterThanOrEqual(RESULT_TIMING.pauseMs + LP_TIMING.rollMaxMs + ATTACK_TIMING.maxBattleMs);
    expect(REVEAL_TIMING.capMs).toBeGreaterThanOrEqual(REVEAL_TIMING.beatMs + LP_TIMING.rollMaxMs + REVEAL_TIMING.settleMs);
    expect(GATE_TIMING.resultCapMs).toBe(RESULT_TIMING.capMs);
  });

  it("keeps the holds under reduced motion, with no long motion", () => {
    expect(ATTACK_TIMING.reducedImpactMs).toBeGreaterThanOrEqual(MIN_VISIBLE_MS);
    expect(ATTACK_TIMING.reducedBreakMs).toBeGreaterThan(ATTACK_TIMING.reducedImpactMs);
    expect(ATTACK_TIMING.reducedTotalMs).toBeGreaterThan(ATTACK_TIMING.reducedBreakMs);
    expect(RESULT_TIMING.reducedPauseMs).toBeGreaterThan(0);
    expect(REVEAL_TIMING.reducedMs).toBeGreaterThan(0);
    expect(REVEAL_TIMING.reducedMs).toBeLessThan(REVEAL_TIMING.beatMs);
    expect(MOVE_TIMING.reduced).toBeLessThan(MIN_VISIBLE_MS);
  });
});

describe("phase beats", () => {
  it("shows an empty phase for 0.8 to 1.2 seconds", () => {
    expect(PHASE_TIMING.beatMs).toBeGreaterThanOrEqual(800);
    expect(PHASE_TIMING.beatMs).toBeLessThanOrEqual(1200);
    expect(VISIBLE_EFFECT_MS["phase ribbon"]).toBe(PHASE_TIMING.beatMs);
  });
});
