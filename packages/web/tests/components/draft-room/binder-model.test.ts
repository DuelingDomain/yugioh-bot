import { describe, expect, it } from "vitest";
import { EMPTY_FILTER, filterWords, matchesFilter, orderEntries, poolEntries, type RoomCard, type RoomFilter } from "../../../src/components/draft/room/room-model";

const card = (id: number, name: string, frameType: string, over: Partial<RoomCard> = {}): RoomCard => ({
  id,
  name,
  type: "Effect Monster",
  frameType,
  level: 4,
  attribute: "DARK",
  effectText: "",
  imageUrl: "",
  imageUrlSmall: "",
  ...over,
});

describe("binder ordering helpers", () => {
  const cards = [
    card(1, "Zebra", "spell", { type: "Normal Spell Card" }),
    card(2, "Beta", "normal"),
    card(3, "Alpha", "trap", { type: "Normal Trap Card" }),
    card(4, "Omega", "effect", { level: 8 }),
    card(5, "Gamma", "fusion", { type: "Fusion Monster", level: 6 }),
    card(6, "Delta", "effect"),
  ];

  it.each([
    { order: "type", want: [4, 2, 6, 1, 3, 5] },
    { order: "oldest", want: [1, 2, 3, 4, 5, 6] },
    { order: "newest", want: [6, 5, 4, 3, 2, 1] },
    { order: "name", want: [3, 2, 6, 5, 4, 1] },
  ] as const)("orders by $order without changing pick indices or the input", ({ order, want }) => {
    const entries = poolEntries(cards);
    const sorted = orderEntries(entries, order);
    expect(sorted.map((e) => e.card.id)).toEqual(want);
    expect(sorted.map((e) => e.index)).toEqual(want.map((id) => id - 1));
    expect(entries.map((e) => e.card.id)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(cards.map((c) => c.id)).toEqual([1, 2, 3, 4, 5, 6]);
  });
});

describe("binder subtype filtering helpers", () => {
  const cards = [
    card(1, "Effect", "effect", { type: "Normal Monster" }),
    card(2, "Effect pendulum", "effect_pendulum"),
    card(3, "Normal", "normal"),
    card(4, "Normal pendulum", "normal_pendulum"),
    card(5, "Ritual", "ritual", { type: "Ritual Effect Monster" }),
    card(6, "Fusion", "fusion", { type: "Fusion Effect Monster" }),
    card(7, "Spell", "spell", { type: "Normal Spell Card" }),
  ];
  const monsterFilter: RoomFilter = { ...EMPTY_FILTER, kinds: new Set(["monster"]) };

  it.each([
    { subtype: "all", want: [1, 2, 3, 4, 5] },
    { subtype: "effect", want: [1, 2] },
    { subtype: "normal", want: [3, 4] },
  ] as const)("filters $subtype monsters using frame type", ({ subtype, want }) => {
    expect(cards.filter((c) => matchesFilter(c, { ...monsterFilter, monsterSubtype: subtype })).map((c) => c.id)).toEqual(want);
  });

  it("ignores stale subtypes when Monster is not the only selected kind", () => {
    expect(cards.filter((c) => matchesFilter(c, { ...EMPTY_FILTER, monsterSubtype: "effect" })).map((c) => c.id)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(cards.filter((c) => matchesFilter(c, { ...monsterFilter, kinds: new Set(["monster", "spell"]), monsterSubtype: "normal" })).map((c) => c.id)).toEqual([1, 2, 3, 4, 5, 7]);
  });

  it("combines subtype with the existing text, level and attribute filters", () => {
    const filter: RoomFilter = { ...monsterFilter, monsterSubtype: "effect", q: "pendulum", lvl: new Set(["low"]), attr: new Set(["DARK"]) };
    expect(cards.filter((c) => matchesFilter(c, filter)).map((c) => c.id)).toEqual([2]);
    expect(matchesFilter(cards[1], { ...filter, attr: new Set(["LIGHT"]) })).toBe(false);
    expect(matchesFilter(cards[1], { ...filter, lvl: new Set(["high"]) })).toBe(false);
    expect(filterWords(filter)).toContain("Effect monsters");
  });
});
