import { describe, expect, it } from "vitest";
import { TYPE_FUSION, TYPE_LINK, TYPE_SYNCHRO, TYPE_XYZ } from "../src/components/duel/constants";
import {
  cardMultiset,
  deckCodes,
  deckCounts,
  isExtraDeckType,
  isValidSideChange,
  NO_MARKS,
  planSideDeck,
  sameDeck,
  toggleIn,
  toggleOut,
  type SideMarks,
} from "../src/components/duel/side-deck-model";
import { makeDeck } from "./helpers/duel-series";

// Card 11 and the 100s are Extra Deck monsters; 10 and the rest are Main Deck cards.
const types = new Map<number, number>([[5, 0x1], [10, 0x1], [11, TYPE_FUSION], [12, 0x1], [100, TYPE_SYNCHRO], [101, TYPE_XYZ]]);

function marks(out: Array<["main" | "extra", number]>, inn: number[]): SideMarks {
  return { out: out.map(([section, index]) => ({ section, index })), inn };
}

describe("toggleOut and toggleIn", () => {
  it("marks a card and takes the mark back", () => {
    const once = toggleOut(NO_MARKS, "main", 1);
    expect(once.out).toEqual([{ section: "main", index: 1 }]);
    expect(toggleOut(once, "main", 1)).toEqual(NO_MARKS);
    const inOnce = toggleIn(NO_MARKS, 0);
    expect(inOnce.inn).toEqual([0]);
    expect(toggleIn(inOnce, 0)).toEqual(NO_MARKS);
  });

  it("does not change the marks it was given", () => {
    const start = toggleOut(NO_MARKS, "extra", 0);
    toggleIn(start, 1);
    expect(start).toEqual({ out: [{ section: "extra", index: 0 }], inn: [] });
  });
});

describe("planSideDeck", () => {
  it.each([40, 41, 60])("rejects an even swap that grows a %i-card Main Deck and shrinks Extra", (size) => {
    const deck = makeDeck({ main: Array.from({ length: size }, (_, i) => i + 1000) });
    const plan = planSideDeck(deck, marks([["extra", 0]], [0]), types);
    expect(plan.out).toBe(plan.inn);
    expect(plan.balanced).toBe(false);
    expect(plan.reason).toBe(`Keep the Main Deck at ${size} cards and the Extra Deck at 2 cards (last game).`);
    expect(isValidSideChange(deck, plan.deck)).toBe(false);
  });

  it("rejects a Main count decrease even when it remains above 40 and matches the registered deck", () => {
    const deck = makeDeck({ main: Array.from({ length: 41 }, (_, i) => i + 1000) });
    const base = { ...deck, main: deck.main.slice(1) };
    const plan = planSideDeck(deck, marks([["main", 0]], [1]), types, base);
    expect(plan.counts).toEqual({ main: 40, extra: 3, side: 2 });
    expect(plan.balanced).toBe(false);
    expect(plan.reason).toBe("Keep the Main Deck at 41 cards and the Extra Deck at 2 cards (last game).");
    expect(isValidSideChange(deck, plan.deck)).toBe(false);
  });

  it("is the deck as it was with no marks", () => {
    const deck = makeDeck();
    const plan = planSideDeck(deck, NO_MARKS, types);
    expect(plan.deck).toEqual(deck);
    expect(plan.out).toBe(0);
    expect(plan.inn).toBe(0);
    expect(plan.balanced).toBe(true);
    expect(plan.reason).toBeNull();
  });

  it("swaps one Main card for one Side card and keeps the Side Deck size", () => {
    const deck = makeDeck();
    const plan = planSideDeck(deck, marks([["main", 1]], [0]), types);
    expect([...plan.deck.main].sort()).toEqual([1, 10, 3].sort());
    expect([...plan.deck.side].sort()).toEqual([11, 2]);
    expect(plan.counts).toEqual(deckCounts(deck));
    expect(plan.balanced).toBe(true);
    expect(plan.reason).toBeNull();
    expect(isValidSideChange(deck, plan.deck)).toBe(true);
  });

  it("sends an Extra Deck monster from the Side Deck into the Extra Deck", () => {
    const deck = makeDeck();
    const plan = planSideDeck(deck, marks([["extra", 0]], [1]), types);
    expect(plan.deck.extra).toEqual([101, 11]);
    expect(plan.deck.side).toEqual([10, 100]);
    expect(plan.destination.get(1)).toBe("extra");
    expect(plan.reason).toBeNull();
  });

  it("routes a Side Extra monster to Extra but rejects a changed Main count", () => {
    const deck = makeDeck();
    const plan = planSideDeck(deck, marks([["main", 0]], [1]), types);
    expect(plan.deck.main).toEqual([2, 3]);
    expect(plan.deck.extra).toEqual([100, 101, 11]);
    expect(plan.counts).toEqual({ main: 2, extra: 3, side: 2 });
    // Main and Extra must retain their last-game sizes.
    expect(plan.reason).toMatch(/Keep the Main Deck at 3 cards/);
  });

  it("says how many more cards must come in when fewer come in than go out", () => {
    const plan = planSideDeck(makeDeck(), marks([["main", 0], ["main", 1]], [0]), types);
    expect(plan.balanced).toBe(false);
    expect(plan.reason).toBe("Bring in 1 card from the Side Deck, or put 1 card back.");
  });

  it("says how many more cards must go out when more come in than go out", () => {
    const plan = planSideDeck(makeDeck(), marks([["main", 0]], [0, 1]), types);
    expect(plan.reason).toBe("Take out 1 card from the Main or Extra Deck, or put 1 card back.");
  });

  it("keeps a 40-card Main Deck at exactly 40 cards", () => {
    const main = Array.from({ length: 40 }, (_, i) => 1000 + i);
    const deck = { main, extra: [], side: [10, 11] };
    // One out and one in keeps 40: fine.
    expect(planSideDeck(deck, marks([["main", 0]], [0]), types, deck).reason).toBeNull();
    // Two out of Main and two in, one of them an Extra monster: Main drops to 39.
    const plan = planSideDeck(deck, marks([["main", 0], ["main", 1]], [0, 1]), types, deck);
    expect(plan.counts.main).toBe(39);
    expect(plan.reason).toMatch(/Keep the Main Deck at 40 cards/);
  });

  it("holds the Main Deck to 60 cards when the marks are even", () => {
    const deck = { main: Array.from({ length: 60 }, (_, i) => 1000 + i), extra: [100], side: [10, 12] };
    const plan = planSideDeck(deck, marks([["extra", 0]], [0]), types, deck);
    expect(plan.counts.main).toBe(61);
    expect(plan.reason).toMatch(/Keep the Main Deck at 60 cards/);
  });

  it("holds the Extra Deck to 15 cards", () => {
    const extra = Array.from({ length: 15 }, (_, i) => 2000 + i);
    const deck = { main: Array.from({ length: 41 }, (_, i) => 1000 + i), extra, side: [11, 5] };
    const plan = planSideDeck(deck, marks([["main", 0]], [0]), types, deck);
    expect(plan.counts.extra).toBe(16);
    expect(plan.reason).toMatch(/Keep the Main Deck at 41 cards/);
  });

  it("uses the base Main size as the floor when the registered deck is small", () => {
    const deck = makeDeck();
    expect(planSideDeck(deck, marks([["main", 0]], [0]), types, deck).reason).toBeNull();
  });

  it("keeps every card: the card multiset never changes", () => {
    const deck = makeDeck({ deckMaster: 999 });
    const plan = planSideDeck(deck, marks([["main", 2], ["extra", 1]], [0, 1]), types, deck);
    expect(cardMultiset(plan.deck)).toEqual(cardMultiset(deck));
    expect(plan.deck.deckMaster).toBe(999);
  });

  it("does not change the deck it was given", () => {
    const deck = makeDeck();
    planSideDeck(deck, marks([["main", 0]], [0]), types);
    expect(deck).toEqual(makeDeck());
  });

  it("waits for Side card types instead of guessing Main for an Extra monster", () => {
    const deck = makeDeck();
    const plan = planSideDeck(deck, marks([["extra", 0]], [1]), new Map());
    expect(plan.typesReady).toBe(false);
    expect(plan.reason).toBe("Loading card types…");
    expect(plan.destination.has(1)).toBe(false);
    expect(cardMultiset(plan.deck)).toEqual(cardMultiset(deck));
    const loaded = planSideDeck(deck, marks([["extra", 0]], [1]), types);
    expect(loaded.typesReady).toBe(true);
    expect(loaded.destination.get(1)).toBe("extra");
    expect(loaded.balanced).toBe(true);
    expect(loaded.reason).toBeNull();
  });

  it("waits for every Side type even when no cards are marked", () => {
    const deck = makeDeck();
    expect(planSideDeck(deck, NO_MARKS, new Map([[10, 1]])).reason).toBe("Loading card types…");
    expect(planSideDeck({ ...deck, side: [] }, NO_MARKS, new Map()).reason).toBeNull();
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

describe("sameDeck", () => {
  it("needs the same order", () => {
    const deck = makeDeck();
    expect(sameDeck(deck, makeDeck())).toBe(true);
    expect(sameDeck(deck, { ...deck, main: [3, 2, 1] })).toBe(false);
  });
});

describe("deckCodes", () => {
  it("lists each passcode once", () => {
    expect(deckCodes({ main: [1, 1, 2], extra: [100], side: [2, 3] }).sort((a, b) => a - b)).toEqual([1, 2, 3, 100]);
  });
});
