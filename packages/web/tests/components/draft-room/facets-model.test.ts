import { describe, expect, it } from "vitest";
import {
  EMPTY_FILTER,
  archetypeChips,
  attributeChips,
  facetChips,
  facetCount,
  filterWords,
  isFiltering,
  matchesFilter,
  type RoomCard,
} from "../../../src/components/draft/room/room-model";

const card = (id: number, over: Partial<RoomCard> = {}): RoomCard => ({
  id,
  passcode: id + 100000,
  name: `Card ${id}`,
  type: "Effect Monster",
  frameType: "effect",
  attribute: "DARK",
  level: 4,
  effectText: "",
  imageUrl: "",
  imageUrlSmall: "",
  ...over,
});

describe("archetype filter", () => {
  const dm = card(1, { name: "Dark Magician", archetype: "Dark Magician" });
  const be = card(2, { name: "Blue-Eyes White Dragon", archetype: "Blue-Eyes" });
  const none = card(3, { archetype: null });
  const missing = card(4);

  it("matches only cards of a chosen archetype", () => {
    const f = { ...EMPTY_FILTER, arch: new Set(["Blue-Eyes"]) };
    expect([dm, be, none, missing].filter((c) => matchesFilter(c, f)).map((c) => c.id)).toEqual([2]);
    const either = { ...EMPTY_FILTER, arch: new Set(["Blue-Eyes", "Dark Magician"]) };
    expect([dm, be, none, missing].filter((c) => matchesFilter(c, either)).map((c) => c.id)).toEqual([1, 2]);
  });

  it("counts as an active filter, a facet, and reads in the lens text", () => {
    const f = { ...EMPTY_FILTER, arch: new Set(["Blue-Eyes", "Branded"]), q: "dragon" };
    expect(isFiltering(f)).toBe(true);
    expect(facetCount(f)).toBe(2);
    expect(filterWords(f)).toBe("Blue-Eyes or Branded, “dragon”");
  });

  it("finds a card by its archetype name through search", () => {
    const f = { ...EMPTY_FILTER, q: "branded" };
    expect(matchesFilter(card(5, { archetype: "Branded", name: "Fallen of Albaz" }), f)).toBe(true);
    expect(matchesFilter(card(6, { archetype: "Other", name: "Fallen of Albaz" }), f)).toBe(false);
  });
});

describe("chip rows", () => {
  it("counts from your picks, adds keys found in the pack at zero, and sorts by count then name", () => {
    const list = [card(1, { archetype: "Zeta" }), card(2, { archetype: "Zeta" }), card(3, { archetype: "Alpha" })];
    const inPack = [card(4, { archetype: "Beta" })];
    expect(archetypeChips(list, inPack, new Set())).toEqual([
      { key: "Zeta", n: 2 },
      { key: "Alpha", n: 1 },
      { key: "Beta", n: 0 },
    ]);
  });

  it("keeps the eight biggest archetypes and never cuts one that is switched on", () => {
    const list = Array.from({ length: 10 }, (_, i) => card(i + 1, { archetype: `A${String(i).padStart(2, "0")}` }));
    const chips = archetypeChips(list, [], new Set(["A09"]));
    expect(chips).toHaveLength(9);
    expect(chips.slice(0, 8).map((c) => c.key)).toEqual(["A00", "A01", "A02", "A03", "A04", "A05", "A06", "A07"]);
    expect(chips[8]).toEqual({ key: "A09", n: 1 });
    expect(archetypeChips(list, [], new Set())).toHaveLength(8);
  });

  it("returns nothing when no card has the key, so the row hides", () => {
    expect(archetypeChips([card(1)], [card(2)], new Set())).toEqual([]);
    expect(attributeChips([card(1)], [], new Set())).toEqual([{ key: "DARK", n: 1 }]);
    expect(facetChips({ list: [], inPack: [], selected: new Set(), keyOf: () => "x" })).toEqual([]);
  });
});
