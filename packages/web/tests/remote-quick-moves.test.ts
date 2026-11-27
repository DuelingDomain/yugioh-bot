import { describe, expect, it, vi } from "vitest";
import { quickMoves } from "../src/components/remote/ui/quick-moves";
import type { TwinCard } from "../src/components/remote/ui/model";

const base = { seat: 0, mySeat: 0, solo: false, live: true, isLink: false, canGive: true, ownerAlive: true, give: vi.fn(), giveBack: vi.fn() };
const ids = (card: Partial<TwinCard>, over: Partial<typeof base> & { seat?: number; mySeat?: number } = {}) =>
  quickMoves({ ...base, ...over, card: { ref: "a", cardId: 1, zone: "monster", slot: 1, faceUp: true, position: "attack", ...card } as TwinCard, act: vi.fn() }).map(m => m.id);

describe("remote quick card moves", () => {
  it("offers Activate and give first on my own card (a Set card: Flip and activate), and Remove proxy to both the owner and the holder of a given card", () => {
    expect(ids({})).toEqual(["activate", "give", "position", "set", "grave", "banish", "hand", "deck", "remove"]);
    expect(ids({ ownerSeat: 1 }, { seat: 0, mySeat: 0 })).toEqual(["activate", "return", "position", "grave", "banish", "hand", "deck", "remove"]);
    expect(ids({ ownerSeat: 0 }, { seat: 1, mySeat: 0 })).toContain("remove");
    expect(ids({ zone: "spell-trap", faceUp: false })[0]).toBe("activate");
    expect(ids({ ownerSeat: 2 }, { seat: 1, mySeat: 0 })).toEqual([]);
  });

  it("offers corrections for an unnamed twin only on the player's side", () => {
    expect(ids({ cardId: undefined, zone: "spell-trap", faceUp: false })).toEqual(["give", "grave", "banish", "hand", "deck", "remove"]);
    expect(ids({ cardId: undefined }, { seat: 1 })).toEqual([]);
  });
});
