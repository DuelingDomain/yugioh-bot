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
  typeChips,
  typeKey,
  typeKeyName,
  typeParts,
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

describe("monster type and spell/trap type", () => {
  const dragon = card(1, { name: "Blue-Eyes", race: "Dragon" });
  const mage = card(2, { name: "Dark Magician", race: "Spellcaster" });
  const quick = card(3, { name: "Mystical Space Typhoon", type: "Spell Card", frameType: "spell", spellTrapType: "Quick-Play" });
  const counter = card(4, { name: "Magic Jammer", type: "Trap Card", frameType: "trap", spellTrapType: "Counter" });
  const noData = card(5, { name: "Mystery" });
  const all = [dragon, mage, quick, counter, noData];

  it("keys cards by row and type, and nothing without engine data", () => {
    expect([dragon, quick, counter, noData].map(typeKey)).toEqual(["monster:Dragon", "spell:Quick-Play", "trap:Counter", null]);
    expect(typeKeyName("spell:Quick-Play")).toBe("Quick-Play");
  });

  it("matches the chosen types, across rows as any-of", () => {
    const f = { ...EMPTY_FILTER, type: new Set(["monster:Dragon"]) };
    expect(all.filter((c) => matchesFilter(c, f)).map((c) => c.id)).toEqual([1]);
    const either = { ...EMPTY_FILTER, type: new Set(["monster:Dragon", "trap:Counter"]) };
    expect(all.filter((c) => matchesFilter(c, either)).map((c) => c.id)).toEqual([1, 4]);
  });

  it("counts as a facet, as filtering, and reads in the filter words", () => {
    const f = { ...EMPTY_FILTER, type: new Set(["spell:Quick-Play"]) };
    expect(facetCount(f)).toBe(1);
    expect(isFiltering(f)).toBe(true);
    expect(filterWords(f)).toContain("Quick-Play Spell");
  });

  it("searches by monster type and by spell or trap kind", () => {
    const hit = (q: string) => all.filter((c) => matchesFilter(c, { ...EMPTY_FILTER, q })).map((c) => c.id);
    expect(hit("dragon")).toContain(1);
    expect(hit("spellcaster")).toEqual([2]);
    expect(hit("quick-play")).toEqual([3]);
    expect(hit("counter")).toEqual([4]);
  });

  it("shows the types on the card's type line when the engine gave them", () => {
    expect(typeParts(dragon)).toContain("Dragon");
    expect(typeParts(quick)).toEqual(["Quick-Play Spell"]);
    expect(typeParts(counter)).toEqual(["Counter Trap"]);
    expect(typeParts(card(6, { type: "Spell Card", frameType: "spell" }))).toEqual(["Spell"]);
  });

  it("builds a chip row per kind, biggest first, and no chips without data", () => {
    const list = [dragon, card(6, { race: "Dragon" }), mage, quick, counter, noData];
    expect(typeChips("monster", list, [], new Set()).map((c) => [c.key, c.n])).toEqual([
      ["monster:Dragon", 2],
      ["monster:Spellcaster", 1],
    ]);
    expect(typeChips("spell", list, [], new Set()).map((c) => c.key)).toEqual(["spell:Quick-Play"]);
    expect(typeChips("trap", list, [], new Set()).map((c) => c.key)).toEqual(["trap:Counter"]);
    expect(typeChips("monster", [noData, quick], [], new Set())).toEqual([]);
  });
});
