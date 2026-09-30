// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { emptyCardQuery, type CardArchetype } from "@yugidraft/shared/duels";
import { clearFilters, filterChips, loadEditorPrefs, queryKey, saveEditorPrefs } from "../src/components/decks/filter-model";

const archetypes: CardArchetype[] = [
  { name: "Blue-Eyes", codes: [0xdd, 0x10dd], count: 60 },
  { name: "Dragon Maid", codes: [0x133], count: 20 },
];

afterEach(() => window.localStorage.clear());

describe("filterChips", () => {
  it("makes no chips for an empty query", () => {
    expect(filterChips(emptyCardQuery(), archetypes)).toEqual([]);
  });

  it("shows an archetype with several setcodes once, and its chip removes all of them", () => {
    const query = { ...emptyCardQuery(), archetypes: [0xdd, 0x10dd, 0x133], archetypeMode: "related" as const };
    const chips = filterChips(query, archetypes);
    expect(chips.map((chip) => chip.label)).toEqual(["Blue-Eyes + related", "Dragon Maid + related"]);
    expect(chips[0]!.clear(query).archetypes).toEqual([0x133]);
  });

  it("names ranges, arrows and banlist status", () => {
    const query = {
      ...emptyCardQuery(),
      kind: "monster" as const,
      level: { min: 4, max: 4 },
      atk: { min: 2500, max: null },
      arrows: 0x2 | 0x80,
      arrowMatch: "all" as const,
      limits: ["limited" as const],
    };
    const labels = filterChips(query, archetypes).map((chip) => chip.label);
    expect(labels).toContain("Monsters");
    expect(labels.some((label) => label.startsWith("Level/Rank"))).toBe(true);
    expect(labels.some((label) => label.startsWith("ATK"))).toBe(true);
    expect(labels.find((label) => label.startsWith("Arrows"))).toMatch(/\(all\)$/);
    expect(labels).toContain("Limited");
  });
});

describe("clearFilters", () => {
  it("keeps the text, sort and banlist and resets the rest", () => {
    const query = {
      ...emptyCardQuery(),
      text: "dragon",
      sort: "atk" as const,
      order: "desc" as const,
      banlist: "tcg-2026-09",
      kind: "spell" as const,
      archetypes: [0xdd],
      offset: 120,
    };
    const cleared = clearFilters(query);
    expect(cleared).toMatchObject({ text: "dragon", sort: "atk", order: "desc", banlist: "tcg-2026-09", kind: "any", archetypes: [], offset: 0 });
  });
});

describe("queryKey", () => {
  it("does not change when only the page changes", () => {
    const query = emptyCardQuery();
    expect(queryKey({ ...query, offset: 60 })).toBe(queryKey(query));
    expect(queryKey({ ...query, text: "a" })).not.toBe(queryKey(query));
  });
});

describe("editor preferences", () => {
  it("saves and loads the sort, view and banlist", () => {
    saveEditorPrefs({ sort: "atk", order: "desc", view: "list", banlist: "tcg-2026-09", scope: "name" });
    expect(loadEditorPrefs()).toEqual({ sort: "atk", order: "desc", view: "list", banlist: "tcg-2026-09", scope: "name" });
  });

  it("drops values it does not know", () => {
    window.localStorage.setItem("yugidraft.deck-editor.v1", JSON.stringify({ sort: "power", view: "list", banlist: "goat" }));
    expect(loadEditorPrefs()).toEqual({ view: "list" });
    window.localStorage.setItem("yugidraft.deck-editor.v1", "{not json");
    expect(loadEditorPrefs()).toEqual({});
  });
});
