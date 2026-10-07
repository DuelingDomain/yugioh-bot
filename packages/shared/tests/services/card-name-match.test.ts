import { describe, expect, it } from "vitest";
import { createImportedCardNameMatcher, normalizeImportedCardName, rankCardsByTypo } from "../../src/services/card-name-match.js";

const names = (list: string[]) => list.map((name) => ({ name }));
const pool = names([
  "Dark Hole",
  "Black Hole",
  "Dark Magician",
  "Dark Magician Girl",
  "Blue-Eyes White Dragon",
  "Harpie's Feather Duster",
  "Pot of Greed",
]);

describe("rankCardsByTypo", () => {
  it("finds a card from a typo in a word and puts the closest name first", () => {
    expect(rankCardsByTypo(pool, "drak hole").map((c) => c.name)).toEqual(["Dark Hole"]);
    expect(rankCardsByTypo(pool, "dark magican").map((c) => c.name)).toEqual(["Dark Magician", "Dark Magician Girl"]);
  });

  it("allows a half-typed word and ignores case, hyphens and quotes", () => {
    expect(rankCardsByTypo(pool, "blu eyes whit").map((c) => c.name)).toEqual(["Blue-Eyes White Dragon"]);
    expect(rankCardsByTypo(pool, "harpies feathr duster").map((c) => c.name)).toEqual(["Harpie's Feather Duster"]);
  });

  it("leaves out names with no near match for a word, and short words must be exact", () => {
    expect(rankCardsByTypo(pool, "pot of greeed").map((c) => c.name)).toEqual(["Pot of Greed"]);
    expect(rankCardsByTypo(pool, "pot xx greed")).toEqual([]);
    expect(rankCardsByTypo(pool, "zzzzzz")).toEqual([]);
    expect(rankCardsByTypo(pool, "   ")).toEqual([]);
  });
});


describe("prepared import name matcher", () => {
  it("reuses normalized names and handles unique, short and ambiguous corrections across length groups", () => {
    const cards = names(["Dark Hole", "Artifact Moralltach", "Artifact Moralltech", "White Dragon Wyverburster", "Gluey"]);
    const match = createImportedCardNameMatcher(new Map(cards.map((card) => [normalizeImportedCardName(card.name), card])));
    for (let i = 0; i < 1000; i++) expect(match(" DARK-HOLE ")).toBe(cards[0]);
    expect(match("White Drragon Wyverburster")).toBe(cards[3]);
    expect(match("Artifact Moralltich")).toBeUndefined();
    expect(match("Glue")).toBeUndefined();
    expect(match("Dark")).toBeUndefined();
    expect(match("   ")).toBeUndefined();
  });
});
