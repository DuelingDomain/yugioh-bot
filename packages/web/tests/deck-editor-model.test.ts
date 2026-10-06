import { describe, expect, it } from "vitest";
import type { DeckCardInfo } from "@yugidraft/shared/duels";
import type { DeckMasterSelection } from "../src/components/duel/ydk";
import {
  TYPE_EFFECT,
  TYPE_FUSION,
  TYPE_LINK,
  TYPE_MONSTER,
  TYPE_SPELL,
  TYPE_TRAP,
  TYPE_XYZ,
} from "../src/components/duel/constants";
import {
  chooseMaster,
  clearSection,
  copyProblems,
  deckYdkText,
  placeCard,
  removeCard,
  sectionBreakdown,
  shuffled,
  sortDeck,
  type CardCatalog,
} from "../src/components/decks/model";

function card(code: number, name: string, type: number, level = 0, alias = 0): DeckCardInfo {
  return {
    code,
    name,
    description: "",
    type,
    attack: 0,
    defense: 0,
    level,
    attribute: 0,
    race: "",
    alias,
    setcodes: [],
    lscale: 0,
    rscale: 0,
    arrows: 0,
    ot: 3,
  };
}

const catalog: CardCatalog = new Map([
  [1, card(1, "Blue-Eyes White Dragon", TYPE_MONSTER, 8)],
  [2, card(2, "Blue-Eyes White Dragon", TYPE_MONSTER, 8, 1)],
  [3, card(3, "Pot of Greed", TYPE_SPELL)],
  [4, card(4, "Mirror Force", TYPE_TRAP)],
  [5, card(5, "Maiden with Eyes of Blue", TYPE_MONSTER | TYPE_EFFECT, 1)],
  [10, card(10, "Blue-Eyes Ultimate Dragon", TYPE_MONSTER | TYPE_FUSION, 12)],
  [11, card(11, "Number 38", TYPE_MONSTER | TYPE_XYZ, 8)],
  [12, card(12, "Knightmare Unicorn", TYPE_MONSTER | TYPE_LINK, 3)],
]);

function selection(main: number[], extra: number[] = [], side: number[] = [], deckMaster?: number): DeckMasterSelection {
  return { deck: { main, extra, side, ...(deckMaster != null ? { deckMaster } : {}) }, masterOrigin: null };
}

describe("YDK export", () => {
  it("preserves alternate artwork ids in every section and the Deck Master", () => {
    const text = deckYdkText(selection([81480461], [81480461], [81480461], 81480461).deck);
    expect(text).not.toContain("81480460");
    expect(text.match(/81480461/g)).toHaveLength(4);
  });
});

describe("placeCard", () => {
  it("adds a list card at the end, or at a position", () => {
    expect(placeCard(selection([1, 3]), { code: 4, from: "list" }, "main").deck.main).toEqual([1, 3, 4]);
    expect(placeCard(selection([1, 3]), { code: 4, from: "list" }, "main", 1).deck.main).toEqual([1, 4, 3]);
    expect(placeCard(selection([1, 3]), { code: 4, from: "list" }, "main", 99).deck.main).toEqual([1, 3, 4]);
  });

  it("moves the dragged copy, not another copy with the same code", () => {
    const next = placeCard(selection([3, 1, 3, 4]), { code: 3, from: "main", index: 2 }, "side");
    expect(next.deck.main).toEqual([3, 1, 4]);
    expect(next.deck.side).toEqual([3]);
  });

  it("reorders inside a section", () => {
    const start = selection([1, 3, 4, 5]);
    expect(placeCard(start, { code: 1, from: "main", index: 0 }, "main", 3).deck.main).toEqual([3, 4, 1, 5]);
    expect(placeCard(start, { code: 5, from: "main", index: 3 }, "main", 0).deck.main).toEqual([5, 1, 3, 4]);
  });

  it("returns the same selection for a drop on the card's own place", () => {
    const start = selection([1, 3, 4]);
    expect(placeCard(start, { code: 3, from: "main", index: 1 }, "main", 1)).toBe(start);
    expect(placeCard(start, { code: 3, from: "main", index: 1 }, "main", 2)).toBe(start);
    expect(placeCard(start, { code: 4, from: "main", index: 2 }, "main")).toBe(start);
  });

  it("moves the Deck Master into a section and forgets where it came from", () => {
    const start: DeckMasterSelection = { deck: { main: [1], extra: [], side: [], deckMaster: 5 }, masterOrigin: { section: "main", index: 0 } };
    const next = placeCard(start, { code: 5, from: "master" }, "side");
    expect(next.deck).toEqual({ main: [1], extra: [], side: [5] });
    expect(next.masterOrigin).toBeNull();
  });

  it("keeps the Deck Master's origin pointing at the same neighbours", () => {
    const start: DeckMasterSelection = { deck: { main: [1, 3], extra: [], side: [], deckMaster: 5 }, masterOrigin: { section: "main", index: 1 } };
    expect(placeCard(start, { code: 4, from: "list" }, "main", 0).masterOrigin).toEqual({ section: "main", index: 2 });
    expect(placeCard(start, { code: 1, from: "main", index: 0 }, "side").masterOrigin).toEqual({ section: "main", index: 0 });
  });
});

describe("removeCard", () => {
  it("removes the copy at the index", () => {
    expect(removeCard(selection([3, 1, 3]), { code: 3, from: "main", index: 2 }).deck.main).toEqual([3, 1]);
    expect(removeCard(selection([3, 1, 3]), { code: 3, from: "main" }).deck.main).toEqual([3, 1]);
  });

  it("ignores list cards and cards that are not in the section", () => {
    const start = selection([1]);
    expect(removeCard(start, { code: 1, from: "list" })).toBe(start);
    expect(removeCard(start, { code: 4, from: "main" })).toBe(start);
  });

  it("clears the Deck Master without putting it back", () => {
    const start: DeckMasterSelection = { deck: { main: [1], extra: [], side: [], deckMaster: 5 }, masterOrigin: { section: "main", index: 0 } };
    expect(removeCard(start, { code: 5, from: "master" })).toEqual({ deck: { main: [1], extra: [], side: [] }, masterOrigin: null });
  });
});

describe("chooseMaster", () => {
  it("takes the copy from the given section", () => {
    const next = chooseMaster(selection([5], [], [5]), 5, "side");
    expect(next.deck).toEqual({ main: [5], extra: [], side: [], deckMaster: 5 });
    expect(next.masterOrigin).toEqual({ section: "side", index: 0 });
  });

  it("puts the old Deck Master back where it came from", () => {
    const first = chooseMaster(selection([1, 5, 3]), 5, "main");
    expect(first.deck.main).toEqual([1, 3]);
    const second = chooseMaster(first, 1, "main");
    expect(second.deck).toEqual({ main: [5, 3], extra: [], side: [], deckMaster: 1 });
  });

  it("uses a card that is not in the deck", () => {
    expect(chooseMaster(selection([1]), 5).deck).toEqual({ main: [1], extra: [], side: [], deckMaster: 5 });
  });
});

describe("clearSection", () => {
  it("empties one section only", () => {
    expect(clearSection(selection([1, 3], [10], [4]), "main").deck).toEqual({ main: [], extra: [10], side: [4] });
  });
});

describe("copyProblems", () => {
  it("counts alternate artworks together", () => {
    const problems = copyProblems(selection([1, 1, 2, 2]).deck, catalog, null);
    expect(problems).toEqual([{ key: "name:Blue-Eyes White Dragon", name: "Blue-Eyes White Dragon", count: 4, max: 3 }]);
  });

  it("uses the banlist limit, also through an alias", () => {
    expect(copyProblems(selection([1, 2]).deck, catalog, { 1: 1 })).toEqual([
      { key: "name:Blue-Eyes White Dragon", name: "Blue-Eyes White Dragon", count: 2, max: 1 },
    ]);
    expect(copyProblems(selection([3]).deck, catalog, { 3: 0 })).toHaveLength(1);
    expect(copyProblems(selection([3, 3]).deck, catalog, { 3: 2 })).toEqual([]);
  });

  it("allows one copy of each card in a singleton (Domain) deck, alternate arts and the Deck Master included", () => {
    expect(copyProblems(selection([1, 4]).deck, catalog, null, true)).toEqual([]);
    expect(copyProblems(selection([1, 2]).deck, catalog, null, true)).toEqual([
      { key: "name:Blue-Eyes White Dragon", name: "Blue-Eyes White Dragon", count: 2, max: 1 },
    ]);
    expect(copyProblems({ ...selection([1]).deck, deckMaster: 2 }, catalog, null, true)).toHaveLength(1);
    // A banlist limit of 0 still wins over the singleton rule.
    expect(copyProblems(selection([3]).deck, catalog, { 3: 0 }, true)).toEqual([
      { key: "name:Pot of Greed", name: "Pot of Greed", count: 1, max: 0 },
    ]);
    // Without the flag two copies stay fine.
    expect(copyProblems(selection([1, 1]).deck, catalog, null)).toEqual([]);
  });
});

describe("sectionBreakdown", () => {
  it("counts Monster, Spell and Trap cards", () => {
    expect(sectionBreakdown("main", [1, 5, 3, 3, 4, 999], catalog)).toEqual([
      { key: "monster", label: "Monster", count: 2 },
      { key: "spell", label: "Spell", count: 2 },
      { key: "trap", label: "Trap", count: 1 },
    ]);
  });

  it("counts Extra Deck frames once each", () => {
    expect(sectionBreakdown("extra", [10, 11, 12, 12], catalog)).toEqual([
      { key: "fusion", label: "Fusion", count: 1 },
      { key: "xyz", label: "Xyz", count: 1 },
      { key: "link", label: "Link", count: 2 },
    ]);
  });
});

describe("sortDeck", () => {
  it("sorts by card type, then Level, then name, with unknown passcodes last", () => {
    const next = sortDeck(selection([4, 999, 3, 5, 1]), catalog);
    expect(next.deck.main).toEqual([1, 5, 3, 4, 999]);
  });

  it("returns the same selection when the deck is already sorted", () => {
    const start = selection([1, 5, 3, 4, 999]);
    expect(sortDeck(start, catalog)).toBe(start);
  });
});

describe("shuffled", () => {
  it("keeps every card and does not change the input", () => {
    const input = [1, 2, 3, 4, 5];
    let seed = 7;
    const out = shuffled(input, () => (seed = (seed * 16807) % 2147483647) / 2147483647);
    expect(out.slice().sort()).toEqual(input);
    expect(input).toEqual([1, 2, 3, 4, 5]);
  });
});
