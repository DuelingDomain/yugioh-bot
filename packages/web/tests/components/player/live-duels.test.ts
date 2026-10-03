import { describe, expect, it, vi } from "vitest";

const { list } = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock("@yugidraft/shared/services", () => ({ createDuelService: () => ({ list }) }));

import { liveDuelSlugs } from "@/components/player/live-duels";

const db = {} as never;
const seat = (playerId: number | null) => ({ seat: 0, playerId, displayName: "x", ready: true, isBot: false });

describe("liveDuelSlugs", () => {
  it("maps every seated player of a running duel to its slug, first duel winning", () => {
    list.mockReturnValue([
      { slug: "a", status: "active", seats: [seat(1), seat(2)] },
      { slug: "b", status: "active", seats: [seat(2), seat(3)] },
      { slug: "c", status: "lobby", seats: [seat(4)] },
      { slug: "d", status: "active", seats: [seat(null)] },
    ]);
    expect(liveDuelSlugs(db, "g1", 9)).toEqual({ 1: "a", 2: "a", 3: "b" });
    expect(list).toHaveBeenCalledWith("g1", 9);
  });

  it("returns nothing for a viewer with no player record, or when the read fails", () => {
    list.mockClear();
    expect(liveDuelSlugs(db, "g1", null)).toEqual({});
    expect(list).not.toHaveBeenCalled();
    list.mockImplementation(() => { throw new Error("boom"); });
    expect(liveDuelSlugs(db, "g1", 9)).toEqual({});
  });
});
