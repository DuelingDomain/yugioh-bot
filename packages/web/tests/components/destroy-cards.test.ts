import { describe, expect, it } from "vitest";
import type { DuelCardInfo, DuelEvent, DuelZoneRef } from "@yugidraft/shared/duels";
import { withDestroyCards } from "@/components/duel/destroy-cards";

const zone = (controller: number, location: number, sequence: number): DuelZoneRef => ({ controller, location, sequence });
const SZONE = 0x08, MZONE = 0x04, GRAVE = 0x10;
const card = (code: number): DuelCardInfo => ({ code } as DuelCardInfo);
const ev = (event: Partial<DuelEvent> & { id: number; kind: DuelEvent["kind"] }): DuelEvent => event as DuelEvent;

const at = zone(1, SZONE, 2);
const destroyOf = (id: number, zoneRef: DuelZoneRef = at, named?: DuelCardInfo) =>
  ev({ id, kind: "destroy", zone: zoneRef, ...(named ? { card: named } : {}) });
const moveOf = (id: number, code: number, from: DuelZoneRef = at, reason: DuelEvent["reason"] = "destroy") =>
  ev({ id, kind: "move", card: card(code), from, zone: zone(1, GRAVE, 0), reason });

describe("withDestroyCards", () => {
  it("gives a card-less destroy the card of the move that leaves its zone", () => {
    const out = withDestroyCards([moveOf(1, 111), destroyOf(2)]);
    expect(out[1].card?.code).toBe(111);
  });

  it("returns the same array when nothing needed a card, and the same output for the same input", () => {
    const events = [moveOf(1, 111), destroyOf(2, at, card(111))];
    expect(withDestroyCards(events)).toBe(events);
    const hidden = [moveOf(1, 111), destroyOf(2)];
    expect(withDestroyCards(hidden)).toBe(withDestroyCards(hidden));
  });

  it("does not change the other events or the input", () => {
    const events = [moveOf(1, 111), destroyOf(2)];
    const out = withDestroyCards(events);
    expect(out[0]).toBe(events[0]);
    expect(events[1].card).toBeUndefined();
  });

  describe("the reason", () => {
    it.each(["send", "return", "banish", "discard", "other", "summon"] as const)("ignores a move with reason %s", (reason) => {
      const out = withDestroyCards([moveOf(1, 111, at, reason), destroyOf(2)]);
      expect(out[1].card).toBeUndefined();
    });

    it("ignores a move that has no known card", () => {
      const hidden = ev({ id: 1, kind: "move", from: at, zone: zone(1, GRAVE, 0), reason: "destroy" });
      expect(withDestroyCards([hidden, destroyOf(2)])[1].card).toBeUndefined();
      const zero = moveOf(1, 0);
      expect(withDestroyCards([zero, destroyOf(2)])[1].card).toBeUndefined();
    });
  });

  describe("the zone", () => {
    it("ignores a move that leaves another zone", () => {
      const out = withDestroyCards([moveOf(1, 111, zone(1, SZONE, 3)), destroyOf(2)]);
      expect(out[1].card).toBeUndefined();
    });

    it("ignores a move of the same sequence in another location or for another controller", () => {
      expect(withDestroyCards([moveOf(1, 111, zone(1, MZONE, 2)), destroyOf(2)])[1].card).toBeUndefined();
      expect(withDestroyCards([moveOf(1, 111, zone(0, SZONE, 2)), destroyOf(2)])[1].card).toBeUndefined();
    });
  });

  describe("the claim", () => {
    it("uses each move once: two card-less destroys of one zone with one move leave the second on the sleeve", () => {
      const out = withDestroyCards([moveOf(1, 111), destroyOf(2), destroyOf(3)]);
      expect(out[1].card?.code).toBe(111);
      expect(out[2].card).toBeUndefined();
    });

    it("gives two destroys of one zone their own move each, nearest first", () => {
      const out = withDestroyCards([moveOf(1, 111), destroyOf(2), moveOf(10, 222), destroyOf(11)]);
      expect(out[1].card?.code).toBe(111);
      expect(out[3].card?.code).toBe(222);
    });

    it("lets a destroy that names its card keep its own move", () => {
      // The named destroy (id 3) is closer to move 2 than the card-less one: it keeps move 2, the other takes none.
      const out = withDestroyCards([destroyOf(1), moveOf(2, 222), destroyOf(3, at, card(222))]);
      expect(out[0].card).toBeUndefined();
      expect(out[2].card?.code).toBe(222);
    });

    it("does not let a named destroy claim a move of another card", () => {
      // The named destroy is for 333, so the move of 222 is free for the card-less one.
      const out = withDestroyCards([moveOf(1, 222), destroyOf(2), destroyOf(3, at, card(333))]);
      expect(out[1].card?.code).toBe(222);
    });
  });

  describe("the gap", () => {
    it("takes a move 6 ids away", () => {
      expect(withDestroyCards([moveOf(1, 111), destroyOf(7)])[1].card?.code).toBe(111);
      expect(withDestroyCards([destroyOf(1), moveOf(7, 111)])[0].card?.code).toBe(111);
    });

    it("leaves the sleeve for a move 7 ids away", () => {
      expect(withDestroyCards([moveOf(1, 111), destroyOf(8)])[1].card).toBeUndefined();
      expect(withDestroyCards([destroyOf(1), moveOf(8, 111)])[0].card).toBeUndefined();
    });

    it("takes the nearer of two moves, and the earlier one on a tie", () => {
      expect(withDestroyCards([moveOf(1, 111), moveOf(4, 222), destroyOf(5)])[2].card?.code).toBe(222);
      expect(withDestroyCards([moveOf(1, 111), destroyOf(3), moveOf(5, 222)])[1].card?.code).toBe(111);
    });
  });
});
