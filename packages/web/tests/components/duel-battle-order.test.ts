import { beforeEach, describe, expect, it } from "vitest";
import type { DuelEvent, DuelZoneRef } from "@yugidraft/shared/duels";
import { armBattleDestroy, battleDestroyAt, clearBattleHolds, HELD_CRACK_MS } from "../../src/components/duel/battle-hold";
import { battleTiming, COUNTER_GAP_MS, DESTROY_BEAT_MS, STYLE_IDS, STYLE_TIMING } from "../../src/components/duel/attack-styles";
import { MOVE_TIMING, pairedMovePlan, planMoves, resetMoveSchedule } from "../../src/components/duel/move-plan";

const MZONE = 0x04;
const GRAVE = 0x10;
const z = (controller: number, location: number, sequence: number): DuelZoneRef => ({ controller, location, sequence });
const card = { code: 1234, name: "Test", level: 4, type: 1 } as unknown as DuelEvent["card"];
const geometry = () => ({ distance: 300 });

beforeEach(() => {
  clearBattleHolds();
  resetMoveSchedule("t");
});

describe("battle timing order", () => {
  it("breaks a destroyed card only after the strike that killed it landed, and after its LP roll started", () => {
    for (const a of STYLE_IDS) {
      const win = battleTiming("win", a, "impact");
      expect(win.targetBreakMs).toBe(win.impactMs + DESTROY_BEAT_MS);
      expect(win.targetBreakMs).toBeGreaterThan(win.impactMs);
      expect(win.attackerBreakMs).toBeNull();
      expect(win.totalMs).toBeGreaterThan(win.targetBreakMs as number);

      for (const d of STYLE_IDS) {
        const lose = battleTiming("lose", a, d);
        const counterStart = STYLE_TIMING[a].impact + COUNTER_GAP_MS;
        // the attacker breaks after the COUNTER strike lands, never while it is still travelling
        expect(lose.attackerDamageMs).toBeGreaterThan(counterStart);
        expect(lose.attackerBreakMs).toBe(lose.attackerDamageMs + DESTROY_BEAT_MS);
        expect(lose.attackerBreakMs).toBeGreaterThan(counterStart + STYLE_TIMING[d].impact * 0.7);
        expect(lose.targetBreakMs).toBeNull();
      }

      const tie = battleTiming("tie", a, "slash");
      expect(tie.targetBreakMs).toBeGreaterThan(tie.impactMs);
      expect(tie.attackerBreakMs).toBeGreaterThan(tie.impactMs);
    }
  });

  it("breaks nothing when the defender holds or the attack is direct", () => {
    for (const kind of ["held", "direct"] as const) {
      const t = battleTiming(kind, "beam", kind === "held" ? "impact" : null);
      expect(t.targetBreakMs).toBeNull();
      expect(t.attackerBreakMs).toBeNull();
    }
  });
});

describe("battle hold", () => {
  it("is idempotent per key, reads without consuming, and fades once its time has passed", () => {
    const zone = z(0, MZONE, 1);
    armBattleDestroy("9:attacker", zone, 900, 1000);
    armBattleDestroy("9:attacker", zone, 5000, 1000);
    expect(battleDestroyAt(zone, 1100)).toBe(1900);
    expect(battleDestroyAt(zone, 1500)).toBe(1900);
    expect(battleDestroyAt(z(0, MZONE, 2), 1100)).toBe(0);
    expect(battleDestroyAt(zone, 1900)).toBe(0);
    expect(battleDestroyAt(zone, 1100)).toBe(0);
  });
});

describe("destroy flights wait for the battle", () => {
  const events = (): DuelEvent[] => [
    { id: 1, kind: "destroy", text: "d", zone: z(0, MZONE, 2), card, cause: "battle" },
    { id: 2, kind: "move", text: "m", seat: 0, from: z(0, MZONE, 2), zone: z(0, GRAVE, 0), card, reason: "destroy" },
  ];

  it("sends the card to the Graveyard only after the counter strike has landed", () => {
    // the attacker (zone 0:4:2) loses; the counter lands 1000 ms in, the break is due at 1120 ms
    armBattleDestroy("7:attacker", z(0, MZONE, 2), 1120, 100);
    const [plan] = planMoves(events(), { now: 100, reduced: false, duelKey: "t", geometry });
    expect(plan.startAt).toBeGreaterThanOrEqual(1220);
    expect(plan.leadMs).toBe(HELD_CRACK_MS);
    // the crack begins no earlier than the hit (100 ms + 1000 ms), and the destroy effect follows the flight
    expect(plan.startAt - plan.leadMs).toBeGreaterThanOrEqual(100 + 1000);
    expect(pairedMovePlan(1)?.id).toBe(2);
    expect(plan.landAt).toBeGreaterThan(plan.startAt);
  });

  it("keeps the old timing when no battle holds the destroy", () => {
    const [plan] = planMoves(events(), { now: 100, reduced: false, duelKey: "t", geometry });
    expect(plan.leadMs).toBe(MOVE_TIMING.destroyBreakBattleMs);
    expect(plan.startAt).toBe(100 + MOVE_TIMING.destroyBreakBattleMs);
  });

  it("keeps the order under reduced motion", () => {
    armBattleDestroy("7:attacker", z(0, MZONE, 2), 620, 100);
    const [plan] = planMoves(events(), { now: 100, reduced: true, duelKey: "t", geometry });
    expect(plan.startAt).toBeGreaterThanOrEqual(720);
  });

  it("does not squeeze the flight speed because of the time spent waiting", () => {
    armBattleDestroy("7:attacker", z(0, MZONE, 2), 1500, 100);
    const [plan] = planMoves(events(), { now: 100, reduced: false, duelKey: "t", geometry });
    expect(plan.durationMs).toBeGreaterThanOrEqual(MOVE_TIMING.tossMin);
  });
});
