import { beforeEach, describe, expect, it } from "vitest";
import type { DuelEvent, DuelZoneRef } from "@yugidraft/shared/duels";
import { BIG_HOLD_CAP_MS, hiddenHoldMs, playsBigSummon } from "../../src/components/duel/big-summon";
import { baseDuration, pairedMovePlan, planMoves, resetMoveSchedule } from "../../src/components/duel/move-plan";

const HAND = 0x02;
const MZONE = 0x04;
const EXTRA = 0x40;
const z = (controller: number, location: number, sequence: number): DuelZoneRef => ({ controller, location, sequence });
const monster = (level: number, attack = 1800) => ({ code: 1234, name: "Test", level, type: 1, attack }) as unknown as DuelEvent["card"];
const geometry = () => ({ distance: 300 });

function summon(id: number, card: DuelEvent["card"], summonKind: string, zone = z(0, MZONE, 1)): DuelEvent {
  return { id, kind: "summon", text: "s", zone, card, summonKind } as unknown as DuelEvent;
}
function move(id: number, from: DuelZoneRef, zone: DuelZoneRef, card: DuelEvent["card"]): DuelEvent {
  return { id, kind: "move", text: "m", seat: 0, from, zone, card };
}

beforeEach(() => resetMoveSchedule("t"));

describe("playsBigSummon", () => {
  it("is true for heavy, tribute and typed summons", () => {
    expect(playsBigSummon(summon(1, monster(8), "normal"), HAND, false)).toBe(true);
    expect(playsBigSummon(summon(1, monster(5), "tribute"), HAND, false)).toBe(true);
    for (const kind of ["fusion", "synchro", "xyz", "link", "ritual", "pendulum"]) {
      expect(playsBigSummon(summon(1, monster(4), kind), EXTRA, false)).toBe(true);
    }
  });
  it("is false for a light summon, a non-summon and reduced motion", () => {
    expect(playsBigSummon(summon(1, monster(4), "normal"), HAND, false)).toBe(false);
    expect(playsBigSummon(summon(1, monster(8), "synchro"), EXTRA, true)).toBe(false);
    expect(playsBigSummon(move(1, z(0, HAND, 0), z(0, MZONE, 0), monster(8)), HAND, false)).toBe(false);
  });
});

describe("hiddenHoldMs", () => {
  it("covers the wait and the hand-over beat", () => {
    expect(hiddenHoldMs(0, 1180)).toBe(1180);
    expect(hiddenHoldMs(1400, 1180)).toBe(2580);
  });
  it("never goes past the safety cap, below zero or to NaN", () => {
    expect(hiddenHoldMs(100000, 1180)).toBe(BIG_HOLD_CAP_MS);
    expect(hiddenHoldMs(-50, 1180)).toBe(1180);
    expect(hiddenHoldMs(Number.NaN, Number.POSITIVE_INFINITY)).toBe(0);
    expect(hiddenHoldMs(10, 10, 5)).toBe(5);
  });
});

describe("the flight of a big summon", () => {
  it("is silent and lands the moment it starts, so the effect begins at once", () => {
    const events = [move(1, z(0, EXTRA, 0), z(0, MZONE, 1), monster(8)), summon(2, monster(8), "synchro")];
    const [plan] = planMoves(events, { now: 1000, reduced: false, duelKey: "t", geometry });
    expect(plan.silent).toBe(true);
    expect(plan.landAt).toBe(plan.startAt);
    expect(plan.landAt).toBe(1000);
    expect(pairedMovePlan(2)?.id).toBe(1);
  });
  it("keeps the flight of a light summon", () => {
    const events = [move(1, z(0, HAND, 0), z(0, MZONE, 1), monster(4)), summon(2, monster(4), "normal")];
    const [plan] = planMoves(events, { now: 1000, reduced: false, duelKey: "t", geometry });
    expect(plan.silent).toBe(false);
    expect(plan.landAt).toBeCloseTo(1000 + baseDuration("place", 300));
  });
  it("keeps the short fade flight in reduced motion, so the card shows at once", () => {
    const events = [move(1, z(0, EXTRA, 0), z(0, MZONE, 1), monster(8)), summon(2, monster(8), "synchro")];
    const [plan] = planMoves(events, { now: 1000, reduced: true, duelKey: "t", geometry });
    expect(plan.silent).toBe(false);
    expect(plan.style).toBe("fade");
  });
  it("still queues behind the flights before it (the Tribute material goes to the Graveyard first)", () => {
    const events = [
      move(1, z(0, MZONE, 0), z(0, 0x10, 0), monster(4)),
      move(2, z(0, HAND, 0), z(0, MZONE, 1), monster(8)),
      summon(3, monster(8), "tribute"),
    ];
    const plans = planMoves(events, { now: 1000, reduced: false, duelKey: "t", geometry });
    expect(plans[1].silent).toBe(true);
    expect(plans[1].landAt).toBeGreaterThan(1000);
  });
});
