import { describe, expect, it } from "vitest";
import { TYPE_FUSION, TYPE_LINK, TYPE_SYNCHRO, TYPE_XYZ } from "../src/components/duel/constants";
import {
  cardMultiset,
  deckCodes,
  deckCounts,
  isExtraDeckType,
  isValidSideChange,
  sameDeck,
  sameSections,
  swapCount,
  swapProblem,
  swapWithSide,
} from "../src/components/duel/side-deck-model";
import { makeDeck } from "./helpers/duel-series";

describe("swapWithSide", () => {
  it("exchanges one main card with one side card and keeps every count", () => {
    const deck = makeDeck();
    const next = swapWithSide(deck, { section: "main", index: 1 }, 0);
    expect(next.main).toEqual([1, 10, 3]);
    expect(next.side).toEqual([2, 11]);
    expect(next.extra).toEqual(deck.extra);
    expect(deckCounts(next)).toEqual(deckCounts(deck));
    expect(isValidSideChange(deck, next)).toBe(true);
  });

  it("does not change the deck it was given", () => {
    const deck = makeDeck();
    swapWithSide(deck, { section: "extra", index: 0 }, 1);
    expect(deck).toEqual(makeDeck());
  });

  it("swaps an extra slot and keeps the deck master", () => {
    const deck = makeDeck({ deckMaster: 999 });
    const next = swapWithSide(deck, { section: "extra", index: 0 }, 1);
    expect(next.extra).toEqual([11, 101]);
    expect(next.side).toEqual([10, 100]);
    expect(next.deckMaster).toBe(999);
  });

  it("is its own undo", () => {
    const deck = makeDeck();
    const once = swapWithSide(deck, { section: "main", index: 0 }, 1);
    expect(sameDeck(swapWithSide(once, { section: "main", index: 0 }, 1), deck)).toBe(true);
  });

  it("throws on an index that is out of range", () => {
    const deck = makeDeck();
    expect(() => swapWithSide(deck, { section: "main", index: 3 }, 0)).toThrow(RangeError);
    expect(() => swapWithSide(deck, { section: "main", index: -1 }, 0)).toThrow(RangeError);
    expect(() => swapWithSide(deck, { section: "main", index: 0 }, 2)).toThrow(RangeError);
    expect(() => swapWithSide(deck, { section: "main", index: 0.5 }, 0)).toThrow(RangeError);
  });
});

describe("swapProblem", () => {
  const types = new Map<number, number>([[10, 0x1], [11, TYPE_FUSION], [100, TYPE_SYNCHRO]]);
  const deck = makeDeck();

  it("allows a normal card for a main card and an extra monster for an extra card", () => {
    expect(swapProblem(deck, { section: "main", index: 0 }, 0, types)).toBeNull();
    expect(swapProblem(deck, { section: "extra", index: 0 }, 1, types)).toBeNull();
  });

  it("refuses an extra deck monster in the main deck", () => {
    expect(swapProblem(deck, { section: "main", index: 0 }, 1, types)).toMatch(/Main Deck/);
  });

  it("refuses a main deck card in the extra deck", () => {
    expect(swapProblem(deck, { section: "extra", index: 0 }, 0, types)).toMatch(/Extra Deck/);
  });

  it("allows a card with an unknown type (the server checks it)", () => {
    expect(swapProblem(deck, { section: "extra", index: 0 }, 0, new Map())).toBeNull();
  });

  it("asks for two cards when an index has no card", () => {
    expect(swapProblem(deck, { section: "main", index: 9 }, 0, types)).toMatch(/Pick one card/);
  });
});

describe("isExtraDeckType", () => {
  it("knows the four extra deck monster types", () => {
    for (const type of [TYPE_FUSION, TYPE_SYNCHRO, TYPE_XYZ, TYPE_LINK]) expect(isExtraDeckType(type | 0x1)).toBe(true);
    expect(isExtraDeckType(0x1 | 0x10)).toBe(false);
  });
});

describe("isValidSideChange", () => {
  it("rejects a change in the side deck size or the card set", () => {
    const deck = makeDeck();
    expect(isValidSideChange(deck, { ...deck, side: [10] })).toBe(false);
    expect(isValidSideChange(deck, { ...deck, side: [10, 12] })).toBe(false);
    expect(isValidSideChange(deck, { ...deck, main: [1, 2], side: [10, 11, 3] })).toBe(false);
  });

  it("counts the deck master", () => {
    const deck = makeDeck({ deckMaster: 5 });
    expect(cardMultiset(deck).get(5)).toBe(1);
    expect(isValidSideChange(deck, { ...deck, deckMaster: 6 })).toBe(false);
  });
});

describe("comparisons", () => {
  it("sameDeck needs the same order, sameSections does not", () => {
    const deck = makeDeck();
    const shuffled = { ...deck, main: [3, 2, 1] };
    expect(sameDeck(deck, shuffled)).toBe(false);
    expect(sameSections(deck, shuffled)).toBe(true);
    expect(sameSections(deck, { ...deck, side: [10, 12] })).toBe(false);
  });
});

describe("swapCount", () => {
  it("counts the cards that left the registered deck", () => {
    const base = makeDeck();
    expect(swapCount(base, base)).toBe(0);
    const one = swapWithSide(base, { section: "main", index: 0 }, 0);
    expect(swapCount(base, one)).toBe(1);
    const two = swapWithSide(one, { section: "main", index: 1 }, 1);
    expect(swapCount(base, two)).toBe(2);
  });

  it("returns to zero when a swap is undone", () => {
    const base = makeDeck();
    const once = swapWithSide(base, { section: "main", index: 0 }, 0);
    expect(swapCount(base, swapWithSide(once, { section: "main", index: 0 }, 0))).toBe(0);
  });
});

describe("deckCodes", () => {
  it("lists each passcode once", () => {
    expect(deckCodes({ main: [1, 1, 2], extra: [100], side: [2, 3] }).sort((a, b) => a - b)).toEqual([1, 2, 3, 100]);
  });
});
