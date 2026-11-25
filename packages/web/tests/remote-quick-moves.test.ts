import { describe, expect, it, vi } from "vitest";
import { quickMoves } from "../src/components/remote/ui/quick-moves";
import type { TwinCard } from "../src/components/remote/ui/model";

const base = { seat: 0, mySeat: 0, solo: false, live: true, isLink: false, canGive: true, ownerAlive: true, give: vi.fn(), giveBack: vi.fn() };
const ids = (card: Partial<TwinCard>, over: Partial<typeof base> & { seat?: number; mySeat?: number; board?: boolean } = {}) =>
  quickMoves({ ...base, ...over, card: { ref: "a", cardId: 1, zone: "monster", slot: 1, faceUp: true, position: "attack", ...card } as TwinCard, act: vi.fn() }).map(m => m.id);

describe("remote quick card moves", () => {
  it("offers only what the camera cannot show on a webcam card (no position, no Set), Remove proxy to both the owner and the holder of a given card, and the battle position only on the virtual board", () => {
    expect(ids({})).toEqual(["activate", "give", "grave", "banish", "hand"]);
    expect(ids({}, { board: true })).toEqual(["activate", "give", "position", "grave", "banish", "hand"]);
    expect(ids({ ownerSeat: 1 }, { seat: 0, mySeat: 0 })).toEqual(["activate", "return", "grave", "banish", "hand", "remove"]);
    expect(ids({ ownerSeat: 0 }, { seat: 1, mySeat: 0 })).toContain("remove");
    expect(ids({ zone: "spell-trap", faceUp: false })[0]).toBe("activate");
    expect(ids({ ownerSeat: 2 }, { seat: 1, mySeat: 0 })).toEqual([]);
  });
});
