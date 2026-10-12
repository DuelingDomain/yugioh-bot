import { describe, expect, it } from "vitest";
import type { DuelEvent } from "@yugidraft/shared/duels";
import { lastEventId, lockForEvents, otherPlayerActed } from "@/components/duel/tag/fx-lock";

const ev = (id: number, kind: DuelEvent["kind"], extra: Partial<DuelEvent> = {}): DuelEvent => ({ id, kind, text: kind, ...extra });

describe("lockForEvents", () => {
  it("returns null without new events", () => {
    expect(lockForEvents([], 0)).toBeNull();
    expect(lockForEvents([ev(3, "attack")], 3)).toBeNull();
  });

  it("an attack on a monster locks for battle", () => {
    const lock = lockForEvents([ev(1, "attack", { target: { controller: 3, location: 4, sequence: 0 } as never })], 0);
    expect(lock?.reason).toBe("battle");
    expect(lock?.ms).toBeGreaterThan(1000);
  });

  it("an attack with no target is a direct attack", () => {
    expect(lockForEvents([ev(1, "attack")], 0)?.reason).toBe("direct");
  });

  it("a chain resolving locks for the chain", () => {
    expect(lockForEvents([ev(1, "chain-resolving", { chainIndex: 2 })], 0)?.reason).toBe("chain");
  });

  it("a destroy locks for destroy", () => {
    expect(lockForEvents([ev(1, "destroy")], 0)?.reason).toBe("destroy");
  });

  it("picks the strongest reason and the longest time of the new events only", () => {
    const events = [ev(1, "destroy"), ev(2, "attack"), ev(3, "chain-resolving")];
    expect(lockForEvents(events, 1)?.reason).toBe("direct");
    expect(lockForEvents(events, 2)?.reason).toBe("chain");
  });

  it("quiet events do not lock", () => {
    expect(lockForEvents([ev(1, "phase"), ev(2, "summon"), ev(3, "move")], 0)).toBeNull();
  });

  it("does not lock with reduced motion, even for an attack", () => {
    expect(lockForEvents([ev(1, "attack"), ev(2, "chain-resolving")], 0, true)).toBeNull();
    expect(lockForEvents([ev(1, "attack")], 0, false)?.reason).toBe("direct");
  });

  it("lastEventId moves the cursor past the newest event", () => {
    expect(lastEventId([ev(4, "phase"), ev(9, "attack"), ev(7, "destroy")], 2)).toBe(9);
    expect(lastEventId([], 5)).toBe(5);
  });
});

describe("otherPlayerActed", () => {
  it("is true for an action of a seat that is neither the viewer nor the field in close-up", () => {
    for (const kind of ["activate", "chain-resolving", "summon", "set", "attack"] as const) {
      expect(otherPlayerActed([ev(1, kind, { seat: 1 })], 0, 0, 0)).toBe(true);
    }
  });

  it("is false for the viewer's own actions and for the field in close-up", () => {
    expect(otherPlayerActed([ev(1, "activate", { seat: 0 }), ev(2, "attack", { seat: 0 })], 0, 0, 0)).toBe(false);
    expect(otherPlayerActed([ev(1, "activate", { seat: 1 })], 0, 0, 1)).toBe(false);
  });

  it("is false for events that name the owner of a card and not who acted, for quiet events and for old events", () => {
    expect(otherPlayerActed([ev(1, "destroy", { seat: 1 }), ev(2, "move", { seat: 1 }), ev(3, "phase", { seat: 1 })], 0, 0, 0)).toBe(false);
    expect(otherPlayerActed([ev(1, "activate", { seat: 1 })], 1, 0, 0)).toBe(false);
    expect(otherPlayerActed([ev(1, "activate")], 0, 0, 0)).toBe(false);
  });

  it("treats every acting seat as another player for a spectator", () => {
    expect(otherPlayerActed([ev(1, "activate", { seat: 2 })], 0, null, null)).toBe(true);
    expect(otherPlayerActed([ev(1, "activate", { seat: 2 })], 0, null, 2)).toBe(false);
  });
});
