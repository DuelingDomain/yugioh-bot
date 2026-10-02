import { beforeEach, describe, expect, it } from "vitest";
import type { DuelEvent, DuelZoneRef } from "@yugidraft/shared/duels";
import {
  ADDED_TITLE,
  buildShowcaseFrames,
  isAddToHand,
  showcaseBox,
  showcaseGateMs,
  showcaseOrigin,
  showcasePhases,
  showcaseSourceLabel,
} from "../../src/components/duel/add-to-hand";
import { ADD_TO_HAND } from "../../src/components/duel/duel-timing";
import { baseDuration, MOVE_TIMING, planMoves, resetMoveSchedule } from "../../src/components/duel/move-plan";
import { closePickRects, rememberPickRects, resetPickRects, stripSeenWithin, takePickRect } from "../../src/components/duel/pick-rects";

const DECK = 0x01;
const HAND = 0x02;
const MZONE = 0x04;
const GRAVE = 0x10;
const REMOVED = 0x20;

const z = (controller: number, location: number, sequence: number): DuelZoneRef => ({ controller, location, sequence });
const info = (code: number) => ({ code, name: `Card ${code}`, level: 4, type: 1 }) as unknown as DuelEvent["card"];

function move(id: number, from: DuelZoneRef, zone: DuelZoneRef, extra: Partial<DuelEvent> & { addedToHand?: true } = {}): DuelEvent {
  return { id, kind: "move", text: "move", seat: zone.controller, from, zone, card: info(1000 + id), ...extra } as DuelEvent;
}

const geometry = () => ({ distance: 300 });
const plan = (events: DuelEvent[], now = 0, reduced = false) => planMoves(events, { now, reduced, duelKey: "t", geometry });
const rect = (left: number, top = 500) => ({ left, top, width: 120, height: 175 });

beforeEach(() => {
  resetMoveSchedule("t");
  resetPickRects();
});

describe("isAddToHand: which moves get the showcase", () => {
  it("marks every move into a hand from the Graveyard, banished, the field or a Deck search", () => {
    expect(isAddToHand(move(1, z(0, GRAVE, 2), z(0, HAND, 3)))).toBe(true);
    expect(isAddToHand(move(1, z(0, REMOVED, 0), z(0, HAND, 3)))).toBe(true);
    expect(isAddToHand(move(1, z(0, MZONE, 1), z(0, HAND, 3), { reason: "return" }))).toBe(true);
    expect(isAddToHand(move(1, z(0, DECK, 0), z(0, HAND, 3), { addedToHand: true }))).toBe(true);
  });
  it("keeps a normal draw a draw", () => {
    expect(isAddToHand(move(1, z(0, DECK, 0), z(0, HAND, 3), { reason: "draw" }))).toBe(false);
    // An older server does not mark a search: a move from the Deck stays a draw.
    expect(isAddToHand(move(1, z(0, DECK, 0), z(0, HAND, 3)))).toBe(false);
    expect(isAddToHand(move(1, z(0, DECK, 0), z(0, HAND, 3), { reason: "other" }))).toBe(false);
  });
  it("ignores moves that do not end in a hand, and moves inside a hand", () => {
    expect(isAddToHand(move(1, z(0, HAND, 3), z(0, GRAVE, 0)))).toBe(false);
    expect(isAddToHand(move(1, z(0, HAND, 3), z(0, MZONE, 0)))).toBe(false);
    expect(isAddToHand(move(1, z(0, HAND, 3), z(0, HAND, 0)))).toBe(false);
    expect(isAddToHand({ id: 1, kind: "phase", text: "d" } as DuelEvent)).toBe(false);
  });
  it("plans an add as a showcase plan and a draw as a draw flight", () => {
    const [add, draw] = plan([move(1, z(0, GRAVE, 0), z(0, HAND, 3)), move(2, z(0, DECK, 0), z(0, HAND, 4), { reason: "draw" })]);
    expect(add.style).toBe("add");
    expect(add.showcase).not.toBeNull();
    expect(draw.style).toBe("draw");
    expect(draw.showcase).toBeNull();
    expect(draw.durationMs).toBe(baseDuration("draw", 300));
  });
});

describe("showcase timing", () => {
  it("shortens each add-to-hand leg by 10%, including reduced-motion fades", () => {
    const normal = showcasePhases(1, false);
    expect([normal.riseMs, normal.holdMs, normal.flyMs, normal.glowMs]).toEqual([414, 720, 504, 468]);
    const reduced = showcasePhases(1, true);
    expect([reduced.riseMs, reduced.holdMs, reduced.flyMs, reduced.glowMs]).toEqual([144, 720, 180, 0]);
  });

  it("rises, holds 700-900 ms, then flies; the plan lasts the sum", () => {
    const phases = showcasePhases(1, false);
    expect(phases.riseMs).toBe(ADD_TO_HAND.riseMs);
    expect(phases.holdMs).toBeGreaterThanOrEqual(700);
    expect(phases.holdMs).toBeLessThanOrEqual(900);
    expect(phases.totalMs).toBe(phases.riseMs + phases.holdMs + phases.flyMs);
    const [add] = plan([move(1, z(0, GRAVE, 0), z(0, HAND, 3))], 100);
    expect(add.startAt).toBe(100);
    expect(add.durationMs).toBe(phases.totalMs);
    expect(add.landAt).toBe(100 + phases.totalMs);
    expect(add.holdMs).toBe(phases.glowMs);
  });
  it("never shortens the hold below its floor, however long the backlog", () => {
    const events = Array.from({ length: 9 }, (_, i) => move(i + 1, z(0, GRAVE, i), z(0, HAND, i), { addedToHand: true }));
    const plans = plan(events);
    for (const p of plans) {
      expect(p.showcase!.phases.holdMs).toBeGreaterThanOrEqual(ADD_TO_HAND.holdMinMs);
      expect(p.showcase!.phases.riseMs).toBeGreaterThanOrEqual(400);
    }
    // It squeezed the rise and the flight of the later ones, not the hold.
    expect(plans[plans.length - 1].showcase!.phases.flyMs).toBeLessThanOrEqual(plans[0].showcase!.phases.flyMs);
  });
  it("uses a fade in, a hold and a fade out under reduced motion, with no glow ring", () => {
    const [add] = plan([move(1, z(0, GRAVE, 0), z(0, HAND, 3))], 0, true);
    expect(add.style).toBe("add");
    const { riseMs, holdMs, flyMs, glowMs } = add.showcase!.phases;
    expect([riseMs, holdMs, flyMs, glowMs]).toEqual([ADD_TO_HAND.reducedInMs, ADD_TO_HAND.reducedHoldMs, ADD_TO_HAND.reducedOutMs, 0]);
    const frames = buildShowcaseFrames({
      phases: add.showcase!.phases, start: { dx: 50, dy: 80, scale: 1 }, spot: { dx: 0, dy: -300, scale: 3, height: 300 }, endRot: 0, reduced: true, fadeIn: false,
    });
    // Nothing travels: every frame sits on the showcase spot.
    for (const frame of [...frames.stage, ...frames.fly]) expect(String(frame.transform)).toContain("translate3d(0.00px, -300.00px");
    expect(frames.stage[0].opacity).toBe(0);
    expect(frames.fly[frames.fly.length - 1].opacity).toBe(0);
  });
  it("sequences the showcase before the Graveyard flights of the same effect", () => {
    // Painful Choice: the opponent picks one card; the others go to the Graveyard (engine order: tosses first).
    const events = [
      move(1, z(0, DECK, 0), z(0, GRAVE, 0), { reason: "send" }),
      move(2, z(0, DECK, 1), z(0, GRAVE, 0), { reason: "send" }),
      move(3, z(0, DECK, 2), z(0, HAND, 5), { addedToHand: true }),
    ];
    const plans = plan(events, 0);
    const byId = new Map(plans.map((p) => [p.id, p]));
    const show = byId.get(3)!;
    expect(plans[0].id).toBe(3);
    const first = byId.get(1)!;
    expect(first.startAt).toBeGreaterThanOrEqual(show.startAt + show.showcase!.phases.riseMs + show.showcase!.phases.holdMs);
    // ... as the showcase card sets off for the hand, so the flights overlap, not queue behind it.
    expect(first.startAt).toBeLessThan(show.landAt);
    expect(byId.get(2)!.startAt).toBeGreaterThan(first.startAt);
    expect(MOVE_TIMING.minGapMs).toBeGreaterThan(0);
  });
  it("keeps a move that is not in the run where it was (an event between splits runs)", () => {
    const events = [
      move(1, z(0, MZONE, 0), z(0, GRAVE, 0), { reason: "send" }),
      { id: 2, kind: "activate", text: "a", zone: z(0, MZONE, 4), card: info(5) } as DuelEvent,
      move(3, z(0, GRAVE, 1), z(0, HAND, 5)),
    ];
    expect(plan(events).map((p) => p.id)).toEqual([1, 3]);
  });
  it("starts a second showcase only when the first is nearly in the hand", () => {
    const phases = showcasePhases(1, false);
    expect(showcaseGateMs(phases, false)).toBe(phases.riseMs + phases.holdMs);
    expect(showcaseGateMs(phases, true)).toBeGreaterThan(phases.riseMs + phases.holdMs);
    expect(showcaseGateMs(phases, true)).toBeLessThan(phases.totalMs);
  });
});

describe("where the showcase starts", () => {
  it("starts from the card's rect in the strip", () => {
    rememberPickRects([{ code: 1001, location: GRAVE, rect: rect(300) }, { code: 9, location: GRAVE, rect: rect(450) }], 1000);
    const [add] = plan([move(1, z(0, GRAVE, 2), z(0, HAND, 3))], 1200);
    expect(add.showcase!.origin).toEqual({ kind: "strip", rect: rect(300) });
  });
  it("uses a strip rect once: a second copy finds the next one, then falls back", () => {
    rememberPickRects([{ code: 7, location: DECK, rect: rect(100) }, { code: 7, location: DECK, rect: rect(260) }], 0);
    const events = [1, 2, 3].map((id) => move(id, z(0, DECK, id), z(0, HAND, id), { addedToHand: true, card: info(7) }));
    const origins = plan(events, 10).map((p) => p.showcase!.origin.kind);
    expect(origins.filter((kind) => kind === "strip")).toHaveLength(2);
    expect(origins).toContain("centre");
  });
  it("starts at the centre once the strip has closed and its rect expired", () => {
    rememberPickRects([{ code: 1001, location: GRAVE, rect: rect(300) }], 0);
    closePickRects(1000);
    const [add] = plan([move(1, z(0, GRAVE, 2), z(0, HAND, 3))], 1000 + ADD_TO_HAND.pickRectTtlMs + 1);
    expect(add.showcase!.origin).toEqual({ kind: "centre" });
  });
  it("starts at the centre for a card whose strip is gone (Painful Choice, the activator)", () => {
    // The strip showed other cards of the deck long ago: a pick, so the card has no place to rise from.
    rememberPickRects([{ code: 55, location: DECK, rect: rect(100) }], 0);
    closePickRects(500);
    const [add] = plan([move(1, z(0, DECK, 4), z(0, HAND, 3), { addedToHand: true })], 20000);
    expect(add.showcase!.origin).toEqual({ kind: "centre" });
  });
  it("rises out of the zone it left when no strip was involved", () => {
    expect(showcaseOrigin(move(1, z(0, MZONE, 1), z(0, HAND, 3), { reason: "return" }), 0, true)).toEqual({ kind: "source" });
    expect(showcaseOrigin(move(1, z(0, MZONE, 1), z(0, HAND, 3), { reason: "return" }), 0, false)).toEqual({ kind: "centre" });
  });
});

describe("pick rect memory", () => {
  it("forgets a rect after its time to live and after one use", () => {
    rememberPickRects([{ code: 5, location: GRAVE, rect: rect(10) }], 100);
    expect(takePickRect(5, GRAVE, 100)).toEqual(rect(10));
    expect(takePickRect(5, GRAVE, 100)).toBeNull();
    rememberPickRects([{ code: 5, location: GRAVE, rect: rect(10) }], 100);
    closePickRects(200);
    expect(takePickRect(5, GRAVE, 200 + ADD_TO_HAND.pickRectTtlMs - 1)).toEqual(rect(10));
    rememberPickRects([{ code: 5, location: GRAVE, rect: rect(10) }], 100);
    closePickRects(200);
    expect(takePickRect(5, GRAVE, 200 + ADD_TO_HAND.pickRectTtlMs + 1)).toBeNull();
  });
  it("matches the code first, then any place for a strip that did not know the location", () => {
    rememberPickRects([{ code: 5, location: 0, rect: rect(10) }], 0);
    expect(takePickRect(5, GRAVE, 1)).toEqual(rect(10));
    expect(takePickRect(6, GRAVE, 1)).toBeNull();
  });
  it("ignores unknown cards and rects with no size", () => {
    rememberPickRects([{ code: 0, location: GRAVE, rect: rect(10) }, { code: 5, location: GRAVE, rect: { left: 0, top: 0, width: 0, height: 0 } }], 0);
    expect(takePickRect(5, GRAVE, 1)).toBeNull();
    expect(takePickRect(0, GRAVE, 1)).toBeNull();
  });
  it("remembers that a strip was on screen for the pick window", () => {
    expect(stripSeenWithin(0)).toBe(false);
    rememberPickRects([{ code: 5, location: DECK, rect: rect(10) }], 0);
    expect(stripSeenWithin(5000, DECK)).toBe(true);
    expect(stripSeenWithin(5000, GRAVE)).toBe(false);
    closePickRects(1000);
    expect(stripSeenWithin(1000 + ADD_TO_HAND.pickWindowMs - 1, DECK)).toBe(true);
    expect(stripSeenWithin(1000 + ADD_TO_HAND.pickWindowMs + 1, DECK)).toBe(false);
  });
});

describe("what the player is told", () => {
  it("says where the card came from, and whose hand it went to", () => {
    expect(ADDED_TITLE).toBe("Added to hand");
    expect(showcaseSourceLabel(z(0, DECK, 0), z(0, HAND, 1), "you")).toBe("from Deck");
    expect(showcaseSourceLabel(z(0, GRAVE, 0), z(0, HAND, 1), "you")).toBe("from GY");
    expect(showcaseSourceLabel(z(1, GRAVE, 0), z(1, HAND, 1), "opp")).toBe("Opponent · from GY");
    expect(showcaseSourceLabel(z(1, GRAVE, 0), z(0, HAND, 1), "you")).toBe("from Opponent's GY");
    expect(showcaseSourceLabel(z(0, GRAVE, 0), z(1, HAND, 1), "opp")).toBe("from your GY");
    expect(showcaseSourceLabel(z(0, REMOVED, 0), z(0, HAND, 1), "you")).toBe("from Banished");
    expect(showcaseSourceLabel(z(0, MZONE, 0), z(0, HAND, 1), "you")).toBe("from Field");
  });
  it("keeps the label for a card whose place is not known", () => {
    expect(showcaseSourceLabel(undefined, z(0, HAND, 1), "you")).toBe("");
    expect(showcaseSourceLabel(undefined, z(1, HAND, 1), "opp")).toBe("Opponent");
  });
});

describe("plan end for the hand-off", () => {
  it("ends the plan after the glow, so effects that wait for the cards wait for it", () => {
    const [add] = plan([move(1, z(0, GRAVE, 0), z(0, HAND, 3))], 500);
    expect(add.landAt).toBe(500 + add.showcase!.phases.totalMs);
    expect(add.holdMs).toBe(ADD_TO_HAND.glowMs);
  });
});

describe("keyframes", () => {
  const spot = { dx: 10, dy: -260, scale: 3, height: 300 };
  const phases = showcasePhases(1, false);
  it("rises from the start rect to the spot, holds with a slow breath, and lands exactly in the hand slot", () => {
    const f = buildShowcaseFrames({ phases, start: { dx: 300, dy: 40, scale: 1 }, spot, endRot: 180, reduced: false, fadeIn: false });
    expect(String(f.stage[0].transform)).toContain("translate3d(300.00px, 40.00px");
    expect(f.stage[0].opacity).toBe(1);
    const atSpot = f.stage.find((frame) => frame.offset === phases.riseMs / (phases.riseMs + phases.holdMs));
    expect(String(atSpot!.transform)).toBe("translate3d(10.00px, -260.00px, 0) rotate(0.00deg) scale(3.0000)");
    expect(f.stage[f.stage.length - 1].offset).toBe(1);
    expect(String(f.fly[0].transform)).toBe(String(atSpot!.transform));
    expect(String(f.fly[f.fly.length - 1].transform)).toBe("translate3d(0.00px, 0.00px, 0) rotate(180.00deg) scale(1.0000)");
    // The settle: a touch under size before it rests.
    expect(f.fly.some((frame) => String(frame.transform).includes("scale(0.9820)"))).toBe(true);
  });
  it("fades in a card that starts at the centre", () => {
    const f = buildShowcaseFrames({ phases, start: { dx: 10, dy: -260, scale: 1.8 }, spot, endRot: 0, reduced: false, fadeIn: true });
    expect(f.stage[0].opacity).toBe(0);
  });
  it("sizes the showcase from the board and caps it", () => {
    expect(showcaseBox({ width: 1600, height: 500 }).height).toBeCloseTo(500 * ADD_TO_HAND.heightShare);
    expect(showcaseBox({ width: 3000, height: 2000 }).height).toBe(ADD_TO_HAND.maxHeightPx);
  });
});
