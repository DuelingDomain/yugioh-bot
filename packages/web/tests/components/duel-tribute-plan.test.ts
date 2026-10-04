import { beforeEach, describe, expect, it } from "vitest";
import type { DuelEvent, DuelZoneRef } from "@yugidraft/shared/duels";
import { pairedMovePlan, planMoves, resetMoveSchedule, tributeRoles } from "../../src/components/duel/move-plan";
import { TRIBUTE_FLIGHT_MS, TRIBUTE_TIMING, TRIBUTE_VISIBLE_MS, VISIBLE_EFFECT_MS } from "../../src/components/duel/duel-timing";
import { tributeTimeline } from "../../src/components/duel/tribute-fx";

const HAND = 0x02;
const MZONE = 0x04;
const GRAVE = 0x10;

const z = (controller: number, location: number, sequence: number): DuelZoneRef => ({ controller, location, sequence });
const card = { code: 1234, name: "Test", level: 4, type: 1 } as unknown as DuelEvent["card"];

function move(id: number, from: DuelZoneRef, zone: DuelZoneRef, extra: Partial<DuelEvent> = {}): DuelEvent {
  return { id, kind: "move", text: "move", seat: zone.controller, from, zone, card, ...extra };
}
const summon = (id: number, zone: DuelZoneRef, summonKind: DuelEvent["summonKind"] = "tribute"): DuelEvent =>
  ({ id, kind: "summon", text: "summon", seat: zone.controller, zone, card, summonKind });

const geometry = () => ({ distance: 300 });

/** A Tribute Summon of two: both Tributes go to the Graveyard, the monster moves in, then the summon event. */
const twoTributes = (summonKind: DuelEvent["summonKind"] = "tribute") => [
  move(1, z(0, MZONE, 0), z(0, GRAVE, 0), { reason: "send" }),
  move(2, z(0, MZONE, 1), z(0, GRAVE, 1), { reason: "send" }),
  move(3, z(0, HAND, 2), z(0, MZONE, 2), { reason: "summon" }),
  summon(4, z(0, MZONE, 2), summonKind),
];

beforeEach(() => resetMoveSchedule("t"));

describe("tributeRoles", () => {
  it("finds the Tributes and the summoned monster of a Tribute Summon", () => {
    const roles = tributeRoles(twoTributes());
    expect(roles.get(1)).toMatchObject({ role: "tribute", index: 0, count: 2 });
    expect(roles.get(2)).toMatchObject({ role: "tribute", index: 1, count: 2 });
    expect(roles.get(3)).toMatchObject({ role: "summoned", count: 2 });
  });

  it("ignores a summon that is not a Tribute Summon, and Graveyard moves with no summon after them", () => {
    expect(tributeRoles(twoTributes("normal")).size).toBe(0);
    expect(tributeRoles(twoTributes().slice(0, 3)).size).toBe(0);
  });

  it("stops at an event that is not part of the summon", () => {
    const events = [
      move(1, z(0, MZONE, 0), z(0, GRAVE, 0)),
      { id: 2, kind: "activate", text: "activate", seat: 0 } as DuelEvent,
      move(3, z(0, MZONE, 1), z(0, GRAVE, 1)),
      move(4, z(0, HAND, 2), z(0, MZONE, 2)),
      summon(5, z(0, MZONE, 2)),
    ];
    const roles = tributeRoles(events);
    expect(roles.has(1)).toBe(false);
    expect(roles.get(3)).toMatchObject({ role: "tribute", count: 1 });
  });

  it("does not take the other player's cards or cards that leave anywhere but the Graveyard", () => {
    const events = [
      move(1, z(1, MZONE, 0), z(1, GRAVE, 0)),
      move(2, z(0, MZONE, 1), z(0, HAND, 3)),
      move(3, z(0, HAND, 2), z(0, MZONE, 2)),
      summon(4, z(0, MZONE, 2)),
    ];
    expect(tributeRoles(events).size).toBe(0);
  });
});

describe("planMoves for a Tribute Summon", () => {
  it("plays the Tributes together, a beat apart, as the tribute animation", () => {
    const plans = new Map(planMoves(twoTributes(), { now: 1000, reduced: false, duelKey: "t", geometry }).map((plan) => [plan.id, plan]));
    const [a, b] = [plans.get(1)!, plans.get(2)!];
    expect(a.style).toBe("tribute");
    expect(b.style).toBe("tribute");
    expect(a.durationMs).toBe(TRIBUTE_FLIGHT_MS);
    expect(a.tribute).toMatchObject({ index: 0, count: 2 });
    expect(a.tribute?.to).toEqual(z(0, MZONE, 2));
    expect(a.startAt).toBe(1000);
    expect(b.startAt - a.startAt).toBe(TRIBUTE_TIMING.staggerMs);
  });

  it("starts the summoned monster 40 ms before the last energy lands", () => {
    const plans = new Map(planMoves(twoTributes(), { now: 1000, reduced: false, duelKey: "t", geometry }).map((plan) => [plan.id, plan]));
    const last = plans.get(2)!;
    const summoned = plans.get(3)!;
    expect(TRIBUTE_TIMING.summonLeadMs).toBe(40);
    expect(summoned.startAt).toBe(last.landAt - TRIBUTE_TIMING.summonLeadMs);
    // The summon effect reads the summoned monster's flight, so it waits too.
    expect(pairedMovePlan(4)?.id).toBe(3);
  });

  it("leaves other moves alone: a plain send to the Graveyard is still a toss", () => {
    const [plan] = planMoves([move(1, z(0, MZONE, 0), z(0, GRAVE, 0), { reason: "send" })], { now: 0, reduced: false, duelKey: "t", geometry });
    expect(plan.style).toBe("toss");
    expect(plan.tribute).toBeUndefined();
  });

  it("does not delay a normal summon", () => {
    const events = [move(1, z(0, HAND, 2), z(0, MZONE, 2), { reason: "summon" }), summon(2, z(0, MZONE, 2), "normal")];
    const [plan] = planMoves(events, { now: 500, reduced: false, duelKey: "t", geometry });
    expect(plan.startAt).toBe(500);
  });

  it("reduced motion: the Tributes fade in place at once and the summon waits a short beat", () => {
    const plans = new Map(planMoves(twoTributes(), { now: 1000, reduced: true, duelKey: "t", geometry }).map((plan) => [plan.id, plan]));
    expect(plans.get(1)!.style).toBe("fade");
    expect(plans.get(2)!.style).toBe("fade");
    expect(plans.get(1)!.startAt).toBe(1000);
    expect(plans.get(2)!.startAt).toBe(1000);
    expect(plans.get(3)!.startAt).toBe(1000 + TRIBUTE_TIMING.reducedMs);
  });

  it("is built from events alone, so the opponent's view plays the same animation", () => {
    const opponent = [
      move(1, z(1, MZONE, 0), z(1, GRAVE, 0)),
      move(2, z(1, HAND, 2), z(1, MZONE, 2)),
      summon(3, z(1, MZONE, 2)),
    ];
    const plans = planMoves(opponent, { now: 0, reduced: false, duelKey: "t", geometry });
    expect(plans.find((plan) => plan.id === 1)?.style).toBe("tribute");
  });
});

describe("tribute timing", () => {
  it("is part of the visible effects, none shorter than 400 ms", () => {
    for (const [name, ms] of Object.entries(TRIBUTE_VISIBLE_MS)) {
      expect(VISIBLE_EFFECT_MS[name], name).toBe(ms);
      expect(ms, name).toBeGreaterThanOrEqual(400);
    }
  });

  it("has the burned card counted into the Graveyard before the energy has finished, and ends with the last effect", () => {
    const line = tributeTimeline();
    expect(line.graveAtMs).toBeLessThan(line.energyEndMs);
    expect(line.energyEndMs).toBe(TRIBUTE_FLIGHT_MS);
    expect(line.totalMs).toBeGreaterThanOrEqual(line.energyEndMs);
  });
});
