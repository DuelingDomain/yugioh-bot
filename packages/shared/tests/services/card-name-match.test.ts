import { describe, expect, it } from "vitest";
import { rankCardsByTypo } from "../../src/services/card-name-match.js";

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
