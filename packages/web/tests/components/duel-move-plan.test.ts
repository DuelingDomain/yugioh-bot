import { beforeEach, describe, expect, it } from "vitest";
import type { DuelEvent, DuelZoneRef } from "@yugidraft/shared/duels";
import { buildFlight, destinationShift, handCardKeys, handFlipMoves } from "../../src/components/duel/move-fx";
import {
  baseDuration,
  MOVE_TIMING,
  pairedMovePlan,
  moveStyleOf,
  planMoves,
  resetMoveSchedule,
} from "../../src/components/duel/move-plan";

const HAND = 0x02;
const MZONE = 0x04;
const GRAVE = 0x10;
const REMOVED = 0x20;
const DECK = 0x01;
const SZONE = 0x08;

const z = (controller: number, location: number, sequence: number): DuelZoneRef => ({ controller, location, sequence });

const card = { code: 1234, name: "Test", level: 4, type: 1 } as unknown as DuelEvent["card"];

function move(id: number, from: DuelZoneRef, zone: DuelZoneRef, extra: Partial<DuelEvent> = {}): DuelEvent {
  return { id, kind: "move", text: "move", seat: zone.controller, from, zone, card, ...extra };
}

const geometry = () => ({ distance: 300 });

beforeEach(() => resetMoveSchedule("t"));

describe("baseDuration", () => {
  it("keeps placements between 700 and 860 ms", () => {
    expect(baseDuration("place", 0)).toBe(700);
    expect(baseDuration("place", 200)).toBeGreaterThan(700);
    expect(baseDuration("place", 5000)).toBe(860);
  });
  it("keeps tosses between 680 and 840 ms and makes draws about 10% quicker", () => {
    expect(baseDuration("toss", 0)).toBe(680);
    expect(baseDuration("toss", 5000)).toBe(840);
    // Round up by 1 ms to preserve the 400 ms floor at the maximum queue compression.
    expect(baseDuration("draw", 300)).toBe(667);
    expect(baseDuration("fade", 300)).toBe(150);
  });
});

describe("planMoves", () => {
  it("chains a known arrival discarded from a different slot after an unreported engine shuffle", () => {
    const events = [move(1, z(0, DECK, 0), z(0, HAND, 4), { reason: "draw", handId: "departed-1" }),
      move(2, z(0, HAND, 1), z(0, GRAVE, 0), { reason: "discard" })];
    const [incoming, outgoing] = planMoves(events, { now: 0, reduced: false, duelKey: "t", geometry });
    expect(incoming.handoff).toBe(outgoing.id);
    expect(outgoing.handoffFrom?.id).toBe(incoming.id);
    expect(outgoing.startAt).toBe(incoming.landAt);
  });

  it.each([false, true])("preserves every pending arrival when code matching differs from the compacted engine slot (reduced=%s)", (reduced) => {
    const identified = (code: number) => ({ ...card!, code });
    const events = [
      ...[10, 20, 30].map((code, index) => move(index + 1, z(0, DECK, 0), z(0, HAND, index + 2),
        { reason: "draw", handId: `departed-${index + 1}`, card: identified(code) })),
      // An unreported shuffle put C in A's engine slot; B and A then leave that compacted slot.
      ...[30, 20, 10].map((code, index) => move(index + 4, z(0, HAND, 2), z(0, GRAVE, index),
        { reason: "discard", card: identified(code) })),
    ];
    const plans = new Map(planMoves(events, { now: 0, reduced, duelKey: "t", geometry }).map((plan) => [plan.id, plan]));
    for (const [arrival, departure] of [[3, 4], [2, 5], [1, 6]]) {
      expect(plans.get(arrival)!.handoff).toBe(departure);
      expect(plans.get(departure)!.handoffFrom?.id).toBe(arrival);
      expect(plans.get(departure)!.startAt).toBe(plans.get(arrival)!.landAt);
    }
  });

  it("keeps a surviving identical arrival separate from an older card's departure", () => {
    const events = [move(1, z(0, DECK, 0), z(0, HAND, 2), { reason: "draw", handId: "hand-survivor" }),
      move(2, z(0, HAND, 2), z(0, GRAVE, 0), { reason: "discard" })];
    const [incoming, outgoing] = planMoves(events, { now: 0, reduced: false, duelKey: "t", geometry });
    expect(incoming.handoff).toBeUndefined();
    expect(outgoing.handoffFrom).toBeUndefined();
  });
  it("makes the whole opening deal about 10% quicker, including a compressed queue", () => {
    const opening = Array.from({ length: 10 }, (_, i) => move(i + 1, z(Math.floor(i / 5), DECK, 0), z(Math.floor(i / 5), HAND, i % 5), { reason: "draw" }));
    const plans = planMoves(opening, { now: 0, reduced: false, duelKey: "t", geometry });
    expect(plans[plans.length - 1].landAt).toBeCloseTo(4400 * 0.9, 0);
  });

  it("shortens the hand-entry stagger under reduced motion and keeps plain fades", () => {
    const draws = [move(1, z(0, DECK, 0), z(0, HAND, 0), { reason: "draw" }), move(2, z(0, DECK, 0), z(0, HAND, 1), { reason: "draw" })];
    const [a, b] = planMoves(draws, { now: 0, reduced: true, duelKey: "t", geometry });
    expect(a.style).toBe("fade");
    expect(b.startAt - a.startAt).toBe(280 * 0.9);
    expect(a.durationMs).toBe(150);
  });

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

  it("starts the next move when the previous is 70% through", () => {
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

  it("keeps a batch under about 4.4 s and each card a distinct beat apart", () => {
    expect(MOVE_TIMING.queueCapMs).toBeLessThanOrEqual(4400);
    const events = Array.from({ length: 5 }, (_, i) => move(i + 1, z(0, DECK, 0), z(0, HAND, 3 + i), { reason: "draw" }));
    const plans = planMoves(events, { now: 0, reduced: false, duelKey: "t", geometry });
    expect(plans.every((p) => p.style === "draw")).toBe(true);
    expect(plans[plans.length - 1].landAt).toBeLessThanOrEqual(4400 + 1);
    for (let i = 1; i < plans.length; i += 1) {
      expect(plans[i].startAt - plans[i - 1].startAt).toBeGreaterThanOrEqual(MOVE_TIMING.minGapMs - 0.001);
    }
  });

  it("staggers a draw of two: the second card starts while the first is still landing", () => {
    const events = [move(1, z(0, DECK, 0), z(0, HAND, 4)), move(2, z(0, DECK, 0), z(0, HAND, 5))];
    const [a, b] = planMoves(events, { now: 0, reduced: false, duelKey: "t", geometry });
    expect(b.startAt).toBeGreaterThan(a.startAt);
    expect(b.startAt).toBeLessThan(a.landAt);
  });

  it("keeps every flight under 1 s (the add to hand showcase is longer on purpose)", () => {
    const events = [
      move(1, z(0, DECK, 0), z(0, HAND, 0)),
      move(2, z(0, GRAVE, 0), z(0, HAND, 1)),
      move(3, z(0, HAND, 1), z(0, MZONE, 1)),
      move(4, z(0, MZONE, 1), z(0, REMOVED, 0)),
    ];
    for (const plan of planMoves(events, { now: 0, reduced: false, duelKey: "t", geometry: () => ({ distance: 5000 }) })) {
      if (plan.style === "add") continue;
      expect(plan.durationMs).toBeLessThan(1000);
    }
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

  it.each([false, true])("chains multiple draws into compacted discards despite intervening moves (reduced=%s)", (reduced) => {
    const identified = (code: number) => ({ ...card!, code });
    const events = [
      move(1, z(0, DECK, 0), z(0, HAND, 2), { reason: "draw", card: identified(10) }),
      move(2, z(0, DECK, 0), z(0, HAND, 3), { reason: "draw", card: identified(20) }),
      move(3, z(0, DECK, 0), z(0, HAND, 4), { reason: "draw", card: identified(30) }),
      move(4, z(1, HAND, 0), z(1, GRAVE, 0)),
      move(5, z(0, HAND, 2), z(0, GRAVE, 0), { reason: "discard", card: identified(10) }),
      move(6, z(0, HAND, 2), z(0, GRAVE, 1), { reason: "discard", card: identified(20) }),
    ];
    const plans = planMoves(events, { now: 0, reduced, duelKey: "t", geometry });
    const byId = new Map(plans.map((plan) => [plan.id, plan]));
    for (const [arrival, departure] of [[1, 5], [2, 6]]) {
      expect(byId.get(arrival)!.handoff).toBe(departure);
      expect(byId.get(departure)!.handoffFrom?.id).toBe(arrival);
      expect(byId.get(departure)!.startAt).toBe(byId.get(arrival)!.landAt);
      expect(byId.get(arrival)!.holdMs).toBe(0);
    }
    expect(byId.get(3)!.handoff).toBeUndefined();
    expect(byId.get(4)!.handoffFrom).toBeUndefined();
  });

  it("chains an Exchange hand arrival into its departure after another seat's move", () => {
    const exchange = move(1, z(0, HAND, 1), z(1, HAND, 2));
    const events = [exchange, move(2, z(0, HAND, 0), z(0, GRAVE, 0)), move(3, z(1, HAND, 2), z(1, GRAVE, 0))];
    const [arrival, unrelated, departure] = planMoves(events, { now: 0, reduced: false, duelKey: "t", geometry });
    expect(arrival.handoff).toBe(departure.id);
    expect(departure.handoffFrom?.id).toBe(exchange.id);
    expect(departure.startAt).toBe(arrival.landAt);
    expect(unrelated.handoffFrom).toBeUndefined();
  });

  it("chains a concealed draw when the subsequent discard reveals its card", () => {
    const events = [
      move(1, z(1, DECK, 0), z(1, HAND, 2), { reason: "draw", card: undefined }),
      move(2, z(0, HAND, 0), z(0, GRAVE, 0)),
      move(3, z(1, HAND, 2), z(1, GRAVE, 0), { reason: "discard" }),
    ];
    const [arrival, , departure] = planMoves(events, { now: 0, reduced: false, duelKey: "t", geometry });
    expect(arrival.handoff).toBe(departure.id);
    expect(departure.startAt).toBe(arrival.landAt);
    expect(arrival.event.card).toBeUndefined();
    expect(departure.event.card).toBe(card);
  });

  it("compacts pending arrivals through skipped moves without matching an older identical copy", () => {
    const events = [
      move(1, z(0, DECK, 0), z(0, HAND, 2), { reason: "draw" }),
      move(2, z(0, DECK, 0), z(0, HAND, 3), { reason: "draw" }),
      move(3, z(0, HAND, 0), z(0, GRAVE, 0), { reason: "discard" }),
      move(4, z(0, HAND, 1), z(0, GRAVE, 1), { reason: "discard" }),
      move(5, z(0, HAND, 1), z(0, GRAVE, 2), { reason: "discard" }),
    ];
    const [a, b, discardA, discardB] = planMoves(events, { now: 0, reduced: false, duelKey: "t",
      geometry: (event) => event.id === 3 ? null : geometry() });
    expect(a.handoff).toBe(discardA.id);
    expect(b.handoff).toBe(discardB.id);
    expect(discardA.handoffFrom?.id).toBe(a.id);
    expect(discardB.handoffFrom?.id).toBe(b.id);
  });
});

describe("moveStyleOf", () => {
  it("gives every kind of card movement a flight style", () => {
    const style = (from: DuelZoneRef, to: DuelZoneRef, extra: Partial<DuelEvent> = {}) => moveStyleOf(move(1, from, to, extra), false);
    expect(style(z(0, DECK, 0), z(0, HAND, 3), { reason: "draw" })).toBe("draw");
    expect(style(z(0, DECK, 0), z(0, HAND, 3), { reason: "other" })).toBe("draw");
    expect(style(z(0, GRAVE, 2), z(0, HAND, 3))).toBe("add");
    expect(style(z(0, REMOVED, 0), z(0, HAND, 3))).toBe("add");
    expect(style(z(0, MZONE, 2), z(0, HAND, 3), { reason: "return" })).toBe("add");
    expect(style(z(0, HAND, 3), z(0, MZONE, 1))).toBe("place");
    expect(style(z(0, HAND, 3), z(0, SZONE, 1))).toBe("place");
    expect(style(z(0, 0x40, 0), z(0, MZONE, 1))).toBe("place");
    expect(style(z(0, HAND, 3), z(0, GRAVE, 0), { reason: "discard" })).toBe("toss");
    expect(style(z(0, MZONE, 3), z(0, DECK, 0), { reason: "return" })).toBe("toss");
    expect(style(z(0, MZONE, 3), z(0, 0x40, 0))).toBe("toss");
    expect(moveStyleOf(move(1, z(0, DECK, 0), z(0, HAND, 3)), true)).toBe("fade");
  });
  it("keeps an add to hand under reduced motion, and fades every other move", () => {
    expect(moveStyleOf(move(1, z(0, GRAVE, 2), z(0, HAND, 3)), true)).toBe("add");
    expect(moveStyleOf(move(1, z(0, DECK, 0), z(0, HAND, 3), { addedToHand: true } as Partial<DuelEvent>), true)).toBe("add");
    expect(moveStyleOf(move(1, z(0, HAND, 3), z(0, MZONE, 1)), true)).toBe("fade");
  });
});

describe("hand sliding", () => {
  it("keys cards by picture and tells copies apart", () => {
    expect(handCardKeys(["a", "b", "a", null, null])).toEqual(["a#0", "b#0", "a#1", "back#0", "back#1"]);
  });
  it("slides the cards that stayed and reports the ones that arrived", () => {
    const prev = new Map([["a#0", { left: 100, top: 10 }], ["b#0", { left: 150, top: 10 }], ["c#0", { left: 200, top: 10 }]]);
    const next = new Map([["a#0", { left: 100, top: 10 }], ["c#0", { left: 175, top: 10 }], ["d#0", { left: 225, top: 10 }]]);
    const { moves, entered } = handFlipMoves(prev, next);
    expect(moves).toEqual([{ key: "c#0", dx: 25, dy: 0 }]);
    expect(entered).toEqual(["d#0"]);
  });
  it("ignores sub-pixel changes", () => {
    const prev = new Map([["a#0", { left: 100, top: 10 }]]);
    expect(handFlipMoves(prev, new Map([["a#0", { left: 100.4, top: 10.4 }]])).moves).toEqual([]);
  });
});

describe("destinationShift", () => {
  const box = (left: number, top: number, w = 60, h = 90) =>
    ({ getBoundingClientRect: () => ({ left, top, width: w, height: h }) }) as unknown as HTMLElement;
  it("follows a destination that moved during the flight", () => {
    expect(destinationShift(box(0, 0, 500, 500), box(120, 300), 120 - 0 + 30 - 15, 300 + 45)).toEqual({ dx: 15, dy: 0 });
  });
  it("ignores a destination that stayed", () => {
    expect(destinationShift(box(0, 0, 500, 500), box(120, 300), 150, 345)).toBeNull();
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
  it("lands a toss fully opaque and at full size so the real pile card can take over without a gap", () => {
    const flight = buildFlight({ style: "toss", dx: 100, dy: -100, startScale: 1, startRot: 0, endRot: 0, cardH: 100, spin: 15 });
    for (const frame of flight.card) expect(frame.opacity).toBe(1);
    expect(String(flight.card[flight.card.length - 1].transform)).toBe("translate3d(0px, 0px, 0) rotate(0deg) scale(1)");
  });
});
