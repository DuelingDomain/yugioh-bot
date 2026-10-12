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
  const zone = (controller: number, location = 4, sequence = 0) => ({ controller, location, sequence });

  it("is true for an activation or an attack of a seat that is neither the viewer nor the field in close-up", () => {
    expect(otherPlayerActed([ev(1, "activate", { seat: 1 })], 0, 0, 0)).toBe(true);
    expect(otherPlayerActed([ev(1, "attack", { seat: 1 })], 0, 0, 0)).toBe(true);
  });

  it("is false for the viewer's own actions", () => {
    expect(otherPlayerActed([ev(1, "activate", { seat: 0 }), ev(2, "attack", { seat: 0 })], 0, 0, 0)).toBe(false);
    expect(otherPlayerActed([ev(1, "activate", { seat: 0, targets: [zone(2)] }), ev(2, "attack", { seat: 0, target: zone(2) })], 0, 0, 0)).toBe(false);
  });

  it("is false for an action on the field in close-up only", () => {
    expect(otherPlayerActed([ev(1, "activate", { seat: 1 })], 0, 0, 1)).toBe(false);
    expect(otherPlayerActed([ev(1, "attack", { seat: 1, target: zone(1) })], 0, 0, 1)).toBe(false);
  });

  it("a chain link on its own is not an action: the activation of the link is", () => {
    expect(otherPlayerActed([ev(1, "chain-resolving", { seat: 1 })], 0, 0, 0)).toBe(false);
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

  describe("summon and set: the actor is not event.seat", () => {
    it("a summon to a rival field on the viewer's turn, no link resolving, keeps the close-up", () => {
      // A Kaiju or a token goes to seat 1; the turn player (the viewer, seat 0) summoned it.
      expect(otherPlayerActed([ev(1, "summon", { seat: 1, zone: zone(1) })], 0, 0, 0, 0)).toBe(false);
      expect(otherPlayerActed([ev(1, "set", { seat: 1, zone: zone(1, 8) })], 0, 0, 0, 0)).toBe(false);
    });

    it("a summon by another turn player to their own field goes out", () => {
      expect(otherPlayerActed([ev(1, "summon", { seat: 1, zone: zone(1) })], 0, 0, 0, 1)).toBe(true);
      expect(otherPlayerActed([ev(1, "set", { seat: 1, zone: zone(1, 8) })], 0, 0, 0, 1)).toBe(true);
    });

    it("a summon to the field in close-up by the rival turn player stays when it lands on the close-up field", () => {
      expect(otherPlayerActed([ev(1, "summon", { seat: 0, zone: zone(0) })], 0, 0, 0, 1)).toBe(false);
    });

    it("the owner of the resolving chain link is the actor, not the turn player", () => {
      const link = ev(1, "chain-resolving", { seat: 1 });
      expect(otherPlayerActed([link, ev(2, "summon", { seat: 1, zone: zone(1) })], 0, 0, 0, 0)).toBe(true);
      // The viewer's link resolves on the rival's turn: the summon is the viewer's.
      const mine = ev(1, "chain-resolving", { seat: 0 });
      expect(otherPlayerActed([mine, ev(2, "summon", { seat: 1, zone: zone(1) })], 0, 0, 0, 1)).toBe(false);
    });

    it("a link that already resolved no longer names the actor", () => {
      const events = [ev(1, "chain-resolving", { seat: 1 }), ev(2, "chain-resolved", { seat: 1 }), ev(3, "summon", { seat: 1, zone: zone(1) })];
      expect(otherPlayerActed(events, 0, 0, 0, 0)).toBe(false);
    });

    it("a link resolved before the cursor still names the actor of a later summon", () => {
      const events = [ev(1, "chain-resolving", { seat: 1 }), ev(5, "summon", { seat: 1, zone: zone(1) })];
      expect(otherPlayerActed(events, 3, 0, 0, 0)).toBe(true);
    });
  });

  describe("the fields an action touches", () => {
    it("an attack from the close-up field on a monster of another field goes out, on its own field it does not", () => {
      expect(otherPlayerActed([ev(1, "attack", { seat: 1, zone: zone(1), target: zone(0) })], 0, 0, 1)).toBe(true);
      expect(otherPlayerActed([ev(1, "attack", { seat: 1, zone: zone(1), target: zone(1) })], 0, 0, 1)).toBe(false);
    });

    it("a direct attack on another field goes out, on the close-up field it does not", () => {
      expect(otherPlayerActed([ev(1, "attack", { seat: 1, targetSeat: 2 })], 0, 0, 1)).toBe(true);
      expect(otherPlayerActed([ev(1, "attack", { seat: 1, targetSeat: 1 })], 0, 0, 1)).toBe(false);
    });

    it("an activation that targets a card on another field goes out", () => {
      expect(otherPlayerActed([ev(1, "activate", { seat: 1, zone: zone(1, 8), targets: [zone(2)] })], 0, 0, 1)).toBe(true);
      expect(otherPlayerActed([ev(1, "activate", { seat: 1, zone: zone(1, 8), targets: [zone(1)] })], 0, 0, 1)).toBe(false);
    });

    it("a rival on another field who targets the close-up field goes out", () => {
      expect(otherPlayerActed([ev(1, "activate", { seat: 2, zone: zone(2, 8), targets: [zone(0)] })], 0, 1, 0)).toBe(true);
    });
  });
});
