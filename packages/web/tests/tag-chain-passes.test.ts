import { describe, expect, it } from "vitest";
import { advancePasses, chainKeyOf, EMPTY_PASSES, passedSeatsFor } from "@/components/duel/tag/use-chain-passes";
import type { DuelChainLink } from "@yugidraft/shared/duels";

const link = (index: number, seat: number) => ({ index, seat }) as DuelChainLink;

describe("chainKeyOf", () => {
  it("is null for an empty chain and changes when a link is added", () => {
    expect(chainKeyOf([])).toBeNull();
    expect(chainKeyOf([link(1, 0)])).not.toEqual(chainKeyOf([link(1, 0), link(2, 1)]));
  });
});

describe("advancePasses", () => {
  it("starts empty and remembers who holds the prompt", () => {
    const next = advancePasses(EMPTY_PASSES, { chainKey: "a", promptSeat: 1 });
    expect(next.seats).toEqual([]);
    expect(next.lastSeat).toBe(1);
  });
  it("counts the seat that held the prompt as passed when the prompt moves on and the chain is the same", () => {
    const first = advancePasses(EMPTY_PASSES, { chainKey: "a", promptSeat: 1 });
    const second = advancePasses(first, { chainKey: "a", promptSeat: 3 });
    expect(second.seats).toEqual([1]);
    expect(second.lastSeat).toBe(3);
  });
  it("returns the same object for the same input", () => {
    const first = advancePasses(EMPTY_PASSES, { chainKey: "a", promptSeat: 1 });
    expect(advancePasses(first, { chainKey: "a", promptSeat: 1 })).toBe(first);
  });
  it("forgets the passes when the chain grows or ends", () => {
    const first = advancePasses(advancePasses(EMPTY_PASSES, { chainKey: "a", promptSeat: 1 }), { chainKey: "a", promptSeat: 3 });
    expect(advancePasses(first, { chainKey: "b", promptSeat: 0 }).seats).toEqual([]);
    expect(advancePasses(first, { chainKey: null, promptSeat: null })).toBe(EMPTY_PASSES);
  });
  it("keeps the holder while no chain prompt is open", () => {
    const first = advancePasses(EMPTY_PASSES, { chainKey: "a", promptSeat: 1 });
    const gap = advancePasses(first, { chainKey: "a", promptSeat: null });
    expect(gap.lastSeat).toBe(1);
    expect(advancePasses(gap, { chainKey: "a", promptSeat: 3 }).seats).toEqual([1]);
  });
});

describe("passedSeatsFor", () => {
  it("adds the rival team when the prompt seat is on the team of the link owner", () => {
    // Link owner seat 0 (team 0); seat 2 (team 0) holds the prompt: team 1 already passed.
    expect(passedSeatsFor({ ...EMPTY_PASSES }, [link(1, 0)], 2).sort()).toEqual([1, 3]);
  });
  it("adds only the tracked passes when the prompt seat is on the other team", () => {
    expect(passedSeatsFor({ key: "a", seats: [1], lastSeat: 3 }, [link(1, 0)], 3)).toEqual([1]);
  });
  it("is empty without a chain", () => {
    expect(passedSeatsFor(EMPTY_PASSES, [], null)).toEqual([]);
  });
});
