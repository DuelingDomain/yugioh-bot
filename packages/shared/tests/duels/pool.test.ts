import { describe, expect, it } from "vitest";
import { canonicalCardCode, checkDeckAgainstPool, mapDeckCodes } from "../../src/duels/pool.js";

const base = 81480460;
const art = 81480461;
const catalog = new Map([
  [base, { name: "Barrel Dragon", type: 33, alias: 0 }],
  [art, { name: "Barrel Dragon", type: 33, alias: base }],
]);
const resolve = (code: number) => canonicalCardCode(code, catalog);

describe("draft card identity", () => {
  it("allows one additional copy per forced pick across artworks and sections", () => {
    const pool = new Map([[base, 3], [art, 2]]);
    const forced = new Map([[art, 1]]);
    const deck = { main: [base, base, art], extra: [], side: [art] };
    expect(checkDeckAgainstPool(deck, pool, resolve, forced)).toEqual([]);
    expect(checkDeckAgainstPool({ ...deck, side: [art, base] }, pool, resolve, forced))
      .toEqual([{ code: base, used: 5, available: 4 }]);
    expect(checkDeckAgainstPool({ ...deck, side: [art, base] }, pool, resolve, new Map([[art, 1], [base, 1]])))
      .toEqual([]);
    // An allowance never creates a copy the player did not draft.
    expect(checkDeckAgainstPool(deck, new Map([[base, 3]]), resolve, forced))
      .toEqual([{ code: base, used: 4, available: 3 }]);
    expect(checkDeckAgainstPool(deck, pool, resolve))
      .toEqual([{ code: base, used: 4, available: 3 }]);
  });

  it("counts artworks together across the deck and the pool", () => {
    const pool = new Map([[base, 1], [art, 1]]);
    expect(checkDeckAgainstPool({ main: [art], extra: [], side: [base] }, pool, resolve)).toEqual([]);
    expect(checkDeckAgainstPool({ main: [base, art], extra: [], side: [art] }, pool, resolve))
      .toEqual([{ code: base, used: 3, available: 2 }]);
  });

  it("maps all sections and the master without dropping or changing copies", () => {
    const deck = { main: [art, 999], extra: [art], side: [base], deckMaster: art };
    expect(mapDeckCodes(deck, resolve)).toEqual({ main: [base, 999], extra: [base], side: [base], deckMaster: base });
    expect(deck.main).toEqual([art, 999]);
  });

  it("keeps a different named alias as a separate drafted card", () => {
    const cards = new Map([...catalog, [42, { name: "Another card", type: 33, alias: base }] as const]);
    expect(canonicalCardCode(42, cards)).toBe(42);
    expect(canonicalCardCode(999, cards)).toBe(999);
  });

  it("keeps same-name cards of different types separate", () => {
    const cards = new Map([
      [5405694, { name: "Black Luster Soldier", type: 0x81, alias: 0 }],
      [10000100, { name: "Black Luster Soldier", type: 0x11, alias: 5405694 }],
    ]);
    const identity = (code: number) => canonicalCardCode(code, cards);
    expect(identity(10000100)).toBe(10000100);
    expect(checkDeckAgainstPool({ main: [10000100], extra: [], side: [] }, new Map([[5405694, 1]]), identity))
      .toEqual([{ code: 10000100, used: 1, available: 0 }]);
  });

  it("follows artwork chains and leaves invalid alias cycles unchanged", () => {
    const cards = new Map([...catalog, [81480462, { name: "Barrel Dragon", type: 33, alias: art }] as const]);
    expect(canonicalCardCode(81480462, cards)).toBe(base);
    cards.set(base, { name: "Barrel Dragon", type: 33, alias: art });
    expect(canonicalCardCode(base, cards)).toBe(base);
    expect(canonicalCardCode(art, cards)).toBe(art);
  });
});
