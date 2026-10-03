import { describe, expect, it } from "vitest";
import type { DuelCard, DuelCardInfo, DuelEvent, DuelSeatView, DuelZoneRef } from "@yugidraft/shared/duels";
import { detectMasterReturns, locateCard } from "../../src/components/duel/master-return";
import {
  buildMasterFlight,
  echoFrames,
  MASTER_RETURN,
  planMasterReturnTiming,
  shortestTurn,
} from "../../src/components/duel/master-return-fx";

const HAND = 0x02;
const MZONE = 0x04;
const GRAVE = 0x10;
const REMOVED = 0x20;
const DMZONE = 0x4000;
const CODE = 4242;

const info = { code: CODE, name: "Master", description: "", type: 1, attack: 0, defense: 0, level: 1, attribute: 0x10, race: "Spellcaster" } as DuelCardInfo;
const z = (controller: number, location: number, sequence: number): DuelZoneRef => ({ controller, location, sequence });
const at = (zone: DuelZoneRef, code = CODE): DuelCard => ({ ...zone, position: 1, code });

function seat(n: number, master: { inZone: boolean; returns: number }, over: Partial<DuelSeatView> = {}): DuelSeatView {
  return {
    seat: n,
    lp: 8000,
    hand: [],
    deckCount: 30,
    extraCount: 0,
    extra: [],
    monsters: [null, null, null, null, null, null, null],
    spells: [null, null, null, null, null, null, null, null],
    graveyard: [],
    banished: [],
    deckMaster: { card: info, inZone: master.inZone, returns: master.returns, nextCost: master.returns * 500 },
    ...over,
  };
}

function move(id: number, from: DuelZoneRef, zone: DuelZoneRef, code = CODE): DuelEvent {
  return { id, kind: "move", text: "move", seat: zone.controller, from, zone, card: { ...info, code } };
}

describe("detectMasterReturns", () => {
  it("returns nothing for the first view and for an unchanged master", () => {
    const now = [seat(0, { inZone: true, returns: 0 }), seat(1, { inZone: true, returns: 0 })];
    expect(detectMasterReturns(null, now)).toEqual([]);
    expect(detectMasterReturns(now, now)).toEqual([]);
  });

  it("does not fire when the master leaves the zone", () => {
    const before = [seat(0, { inZone: true, returns: 0 })];
    const after = [seat(0, { inZone: false, returns: 0 }, { monsters: [at(z(0, MZONE, 2)), null, null, null, null, null, null] })];
    expect(detectMasterReturns(before, after)).toEqual([]);
  });

  it("reads the source from the previous view (Graveyard)", () => {
    const before = [seat(0, { inZone: false, returns: 0 }, { graveyard: [at(z(0, GRAVE, 3))] })];
    const after = [seat(0, { inZone: true, returns: 1 })];
    expect(detectMasterReturns(before, after)).toEqual([
      { seat: 0, code: CODE, returns: 1, from: z(0, GRAVE, 3), source: "board" },
    ]);
  });

  it("reads banished, hand and field sources from the previous view", () => {
    const after = [seat(0, { inZone: true, returns: 2 })];
    const banished = [seat(0, { inZone: false, returns: 1 }, { banished: [at(z(0, REMOVED, 0))] })];
    const hand = [seat(0, { inZone: false, returns: 1 }, { hand: [at(z(0, HAND, 1))] })];
    const field = [seat(0, { inZone: false, returns: 1 }, { monsters: [null, null, at(z(0, MZONE, 2)), null, null, null, null] })];
    expect(detectMasterReturns(banished, after)[0].from).toEqual(z(0, REMOVED, 0));
    expect(detectMasterReturns(hand, after)[0].from).toEqual(z(0, HAND, 1));
    expect(detectMasterReturns(field, after)[0].from).toEqual(z(0, MZONE, 2));
  });

  it("prefers the last move event of the batch: destroyed and returned in one step", () => {
    const before = [seat(0, { inZone: false, returns: 0 }, { monsters: [null, at(z(0, MZONE, 1)), null, null, null, null, null] })];
    const after = [seat(0, { inZone: true, returns: 1 })];
    const fresh = [move(5, z(0, MZONE, 1), z(0, GRAVE, 4)), move(6, z(0, MZONE, 0), z(0, GRAVE, 5), 999)];
    const hit = detectMasterReturns(before, after, fresh)[0];
    expect(hit.from).toEqual(z(0, GRAVE, 4));
    expect(hit.source).toBe("event");
  });

  it("uses an event that ends in the Deck Master Zone, and its source", () => {
    const before = [seat(0, { inZone: false, returns: 0 })];
    const after = [seat(0, { inZone: true, returns: 1 })];
    const fresh = [move(5, z(0, MZONE, 1), z(0, GRAVE, 4)), move(6, z(0, GRAVE, 4), z(0, DMZONE, 0))];
    expect(detectMasterReturns(before, after, fresh)[0].from).toEqual(z(0, GRAVE, 4));
  });

  it("detects a master that left and came back inside one batch (returns went up, still in zone)", () => {
    const before = [seat(1, { inZone: true, returns: 1 })];
    const after = [seat(1, { inZone: true, returns: 2 })];
    const fresh = [move(8, z(1, MZONE, 0), z(1, GRAVE, 0))];
    const hit = detectMasterReturns(before, after, fresh)[0];
    expect(hit).toMatchObject({ seat: 1, returns: 2, from: z(1, GRAVE, 0), source: "event" });
  });

  it("falls back to that player's Graveyard when nothing says where it was", () => {
    const before = [seat(1, { inZone: false, returns: 0 })];
    const after = [seat(1, { inZone: true, returns: 1 })];
    expect(detectMasterReturns(before, after)).toEqual([
      { seat: 1, code: CODE, returns: 1, from: z(1, GRAVE, 0), source: "fallback" },
    ]);
    const quick = [seat(1, { inZone: true, returns: 0 })];
    expect(detectMasterReturns(quick, [seat(1, { inZone: true, returns: 1 })])[0].source).toBe("fallback");
  });

  it("handles both seats, and ignores seats without a master or with a different master", () => {
    const before = [seat(0, { inZone: false, returns: 0 }), seat(1, { inZone: false, returns: 0 })];
    const after = [seat(0, { inZone: true, returns: 1 }), seat(1, { inZone: true, returns: 1 })];
    expect(detectMasterReturns(before, after).map((hit) => hit.seat)).toEqual([0, 1]);
    const bare = { ...seat(0, { inZone: true, returns: 1 }), deckMaster: undefined } as DuelSeatView;
    expect(detectMasterReturns(before, [bare])).toEqual([]);
    const other = seat(0, { inZone: true, returns: 1 });
    other.deckMaster = { ...other.deckMaster!, card: { ...info, code: 7 } };
    expect(detectMasterReturns(before, [other])).toEqual([]);
  });
});

describe("locateCard", () => {
  it("returns null for a card that is not visible", () => {
    expect(locateCard(seat(0, { inZone: false, returns: 0 }), CODE)).toBeNull();
  });
});

describe("planMasterReturnTiming", () => {
  it("starts at once when no flight is running, and flies about 660 ms", () => {
    expect(planMasterReturnTiming(1000, 900, false)).toEqual({ startAt: 1000, landAt: 1000 + MASTER_RETURN.flightMs, durationMs: MASTER_RETURN.flightMs });
    expect(MASTER_RETURN.flightMs).toBeGreaterThanOrEqual(600);
    expect(MASTER_RETURN.flightMs).toBeLessThanOrEqual(800);
  });

  it("waits for the planned card flights, a beat longer, never past the queue cap", () => {
    expect(planMasterReturnTiming(1000, 1500, false).startAt).toBe(1500 + MASTER_RETURN.gapMs);
    expect(planMasterReturnTiming(1000, 9000, false).startAt).toBe(1000 + MASTER_RETURN.waitCapMs);
  });

  it("does not wait and does not fly with reduced motion", () => {
    const t = planMasterReturnTiming(1000, 5000, true);
    expect(t.startAt).toBe(1000);
    expect(t.durationMs).toBe(MASTER_RETURN.reducedFadeMs);
  });
});

describe("buildMasterFlight", () => {
  const flight = buildMasterFlight({ dx: -400, dy: 120, startScale: 0.7, startRot: 180, endRot: 0, cardH: 120 });

  it("starts at the source offset and lands exactly on the dock", () => {
    expect(flight.card[0].transform).toContain("translate3d(-400.00px");
    expect(flight.card[flight.card.length - 1].transform).toBe("translate3d(0px, 0px, 0) rotate(0deg) scale(1)");
    expect(flight.shade[flight.shade.length - 1].opacity).toBe(0);
  });

  it("keeps offsets rising and uses only transform and opacity", () => {
    let last = -1;
    for (const frame of flight.card) {
      expect(frame.offset as number).toBeGreaterThanOrEqual(last);
      last = frame.offset as number;
      expect(Object.keys(frame).sort()).toEqual(["offset", "opacity", "transform"]);
    }
    expect(last).toBe(1);
  });

  it("arcs above the straight line and turns the far card upright the short way", () => {
    const level = buildMasterFlight({ dx: -400, dy: 0, startScale: 0.7, startRot: 180, endRot: 0, cardH: 120 });
    const mid = level.card[Math.floor(level.card.length * 0.45)].transform as string;
    const y = Number(/translate3d\([^,]+, (-?[\d.]+)px/.exec(mid)![1]);
    expect(y).toBeLessThan(0);
    expect(shortestTurn(270)).toBe(-90);
    expect(shortestTurn(180)).toBe(-180);
    expect(shortestTurn(0)).toBe(0);
    expect(flight.card[0].transform).toContain("rotate(-180.00deg)");
  });

  it("fades the trail copies in on the lift and out on arrival", () => {
    const echo = echoFrames(flight, 0.34);
    expect(echo).toHaveLength(flight.card.length);
    expect(echo[0].opacity).toBe(0);
    expect(echo[echo.length - 1].opacity).toBe(0);
    expect(Math.max(...echo.map((frame) => frame.opacity as number))).toBeCloseTo(0.34);
  });
});
