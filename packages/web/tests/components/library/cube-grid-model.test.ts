import { describe, expect, it } from "vitest";
import type { CardSummary } from "@/lib/card-types";
import { DEFAULT_VIEW, viewIsDefault, viewPool } from "@/components/cubes/cube-grid-model";

function c(id: number, name: string, type: string, frameType: string): CardSummary {
  return { id, name, type, frameType, effectText: "", imageUrl: "i", imageUrlSmall: "i" } as CardSummary;
}

const cards = [
  c(1, "Beta Normal", "Normal Monster", "normal"),
  c(2, "Alpha Spell", "Spell Card", "spell"),
  c(3, "Gamma Trap", "Trap Card", "trap"),
  c(4, "Delta Xyz", "XYZ Monster", "xyz"),
];

describe("viewPool", () => {
  it("lists newest first by default", () => {
    expect(viewPool(cards, DEFAULT_VIEW).map((x) => x.id)).toEqual([4, 3, 2, 1]);
  });
  it("keeps added order for oldest", () => {
    expect(viewPool(cards, { ...DEFAULT_VIEW, sort: "oldest" }).map((x) => x.id)).toEqual([1, 2, 3, 4]);
  });
  it("sorts by name", () => {
    expect(viewPool(cards, { ...DEFAULT_VIEW, sort: "name" }).map((x) => x.name)[0]).toBe("Alpha Spell");
  });
  it("filters by type and search", () => {
    expect(viewPool(cards, { ...DEFAULT_VIEW, filter: "spell" }).map((x) => x.id)).toEqual([2]);
    expect(viewPool(cards, { ...DEFAULT_VIEW, filter: "trap" }).map((x) => x.id)).toEqual([3]);
    expect(viewPool(cards, { ...DEFAULT_VIEW, search: "xyz" }).map((x) => x.id)).toEqual([4]);
  });
  it("knows the default view", () => {
    expect(viewIsDefault(DEFAULT_VIEW)).toBe(true);
    expect(viewIsDefault({ ...DEFAULT_VIEW, search: "a" })).toBe(false);
  });
});
