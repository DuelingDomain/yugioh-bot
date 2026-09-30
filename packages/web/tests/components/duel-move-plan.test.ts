import { beforeEach, describe, expect, it } from "vitest";
import type { DuelEvent, DuelZoneRef } from "@yugidraft/shared/duels";
import { buildFlight } from "../../src/components/duel/move-fx";
import {
  baseDuration,
  MOVE_TIMING,
  pairedMovePlan,
  planMoves,
  resetMoveSchedule,
} from "../../src/components/duel/move-plan";

const HAND = 0x02;
const MZONE = 0x04;
const GRAVE = 0x10;

const z = (controller: number, location: number, sequence: number): DuelZoneRef => ({ controller, location, sequence });

const card = { code: 1234, name: "Test", level: 4, type: 1 } as unknown as DuelEvent["card"];

function move(id: number, from: DuelZoneRef, zone: DuelZoneRef, extra: Partial<DuelEvent> = {}): DuelEvent {
  return { id, kind: "move", text: "move", seat: zone.controller, from, zone, card, ...extra };
}

const geometry = () => ({ distance: 300 });

beforeEach(() => resetMoveSchedule("t"));

describe("baseDuration", () => {
  it("keeps placements between 420 and 560 ms", () => {
    expect(baseDuration("place", 0)).toBe(420);
    expect(baseDuration("place", 200)).toBeGreaterThan(420);
    expect(baseDuration("place", 5000)).toBe(560);
  });
  it("keeps tosses between 360 and 450 ms and draws at 380 ms", () => {
    expect(baseDuration("toss", 0)).toBe(360);
    expect(baseDuration("toss", 5000)).toBe(450);
    expect(baseDuration("draw", 300)).toBe(380);
    expect(baseDuration("fade", 300)).toBe(150);
  });
});

describe("planMoves", () => {
  it("styles moves by destination and pairs a summon with its flight", () => {
    const events: DuelEvent[] = [
      move(1, z(0, HAND, 2), z(0, MZONE, 1)),
      { id: 2, kind: "summon", text: "s", zone: z(0, MZONE, 1), card, summonKind: "normal" },
      move(3, z(0, MZONE, 4), z(0, GRAVE, 0), { reason: "send" }),
    ];
    const plans = planMoves(events, { now: 1000, reduced: false, duelKey: "t", geometry });
    expect(plans.map((p) => p.style)).toEqual(["place", "toss"]);
    expect(pairedMovePlan(2)?.id).toBe(1);
    expect(pairedMovePlan(2)?.landAt).toBeCloseTo(1000 + baseDuration("place", 300));
  });

  it("starts the next move when the previous is 60% through", () => {
    const events = [move(1, z(0, HAND, 0), z(0, MZONE, 0)), move(2, z(0, HAND, 0), z(0, MZONE, 1))];
    const [a, b] = planMoves(events, { now: 0, reduced: false, duelKey: "t", geometry });
    expect(b.startAt).toBeCloseTo(a.startAt + a.durationMs * MOVE_TIMING.overlap);
  });

  it("speeds a long burst up so it finishes within the queue cap", () => {
    const events = Array.from({ length: 12 }, (_, i) => move(i + 1, z(0, HAND, 0), z(0, MZONE, i % 5)));
    const plans = planMoves(events, { now: 0, reduced: false, duelKey: "t", geometry });
    const last = plans[plans.length - 1];
    expect(last.landAt).toBeLessThanOrEqual(MOVE_TIMING.queueCapMs + 1);
    expect(plans[0].durationMs).toBeLessThan(baseDuration("place", 300));
    expect(plans[0].durationMs).toBeGreaterThanOrEqual(baseDuration("place", 300) * MOVE_TIMING.minSpeed - 1);
  });

  it("is idempotent and skips moves without a board anchor", () => {
    const events = [move(1, z(0, HAND, 0), z(0, MZONE, 0)), move(2, z(0, HAND, 0), z(0, MZONE, 1))];
    const first = planMoves(events, { now: 0, reduced: false, duelKey: "t", geometry });
    expect(first).toHaveLength(2);
    expect(planMoves(events, { now: 5, reduced: false, duelKey: "t", geometry })).toHaveLength(0);
    resetMoveSchedule("t");
    const some = planMoves(events, { now: 0, reduced: false, duelKey: "t", geometry: (e) => (e.id === 1 ? null : { distance: 1 }) });
    expect(some.map((p) => p.id)).toEqual([2]);
  });

  it("makes a destroy lead the flight to the Graveyard", () => {
    const events: DuelEvent[] = [
      { id: 1, kind: "destroy", text: "d", zone: z(1, MZONE, 2), card, cause: "battle" },
      move(2, z(1, MZONE, 2), z(1, GRAVE, 0), { reason: "destroy" }),
    ];
    const [plan] = planMoves(events, { now: 100, reduced: false, duelKey: "t", geometry });
    expect(pairedMovePlan(1)?.id).toBe(2);
    expect(plan.leadMs).toBe(MOVE_TIMING.destroyBreakBattleMs);
    expect(plan.startAt).toBe(100 + MOVE_TIMING.destroyBreakBattleMs);
  });

  it("uses a 150 ms fade with reduced motion", () => {
    const [plan] = planMoves([move(1, z(0, HAND, 0), z(0, MZONE, 0))], { now: 0, reduced: true, duelKey: "t", geometry });
    expect(plan.style).toBe("fade");
    expect(plan.durationMs).toBe(150);
  });
});

describe("buildFlight", () => {
  it("starts at the source offset and lands exactly on the destination", () => {
    const flight = buildFlight({ style: "place", dx: 200, dy: 300, startScale: 1, startRot: 0, endRot: 90, cardH: 100, spin: 0 });
    expect(flight.card[0].offset).toBe(0);
    expect(String(flight.card[0].transform)).toContain("translate3d(200.00px");
    const last = flight.card[flight.card.length - 1];
    expect(String(last.transform)).toBe("translate3d(0px, 0px, 0) rotate(90deg) scale(1)");
    expect(last.offset).toBe(1);
  });
  it("fades a toss into the pile", () => {
    const flight = buildFlight({ style: "toss", dx: 100, dy: -100, startScale: 1, startRot: 0, endRot: 0, cardH: 100, spin: 15 });
    expect(flight.card[flight.card.length - 1].opacity).toBeLessThan(0.05);
  });
});
