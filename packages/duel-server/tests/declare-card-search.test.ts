import { rmSync } from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import { deckSearchCodes, loadCardDatabase } from "../src/cards.js";
import { createHostDataFixture } from "./helpers/host-data-fixture.js";

const directory = createHostDataFixture([
  { code: 1, name: "Blue-Eyes White Dragon" },
  { code: 2, name: "Hárpie’s Feather-Duster", type: 2 },
  { code: 3, name: "Blue" },
  { code: 4, name: "Blue Dragon" },
  { code: 5, name: "A Blue" },
  { code: 6, name: "Z Blue" },
  { code: 7, name: "Skyblue" },
  { code: 8, name: "Dragon Blue" },
  { code: 9, name: "Trueblue Dragon" },
  { code: 10, name: "Blue-Eyes White Dragon", alias: 1 },
  ...Array.from({ length: 60 }, (_, index) => ({ code: 100 + index, name: `The Long Filler ${index}` })),
  { code: 900, name: "The" },
  { code: 901, name: "The Side" },
]);
const cards = loadCardDatabase(directory);
afterAll(() => { cards.close(); rmSync(directory, { recursive: true, force: true }); });
const codes = (query: string, deck?: ReadonlySet<number>) => cards.search(query, undefined, deck).map(card => card.code);

describe("card name autocomplete", () => {
  it.each(["blue eyes", "eyes blue", "blu ey dra", "  BLU---ey   drá  "])("matches word prefixes for %s", query => {
    expect(codes(query)).toContain(1);
  });
  it.each(["harpies feather duster", "hárpie's feather-duster", "duster har", "harpie s"])("normalizes accents and apostrophes for %s", query => {
    if (query === "harpie s") expect(codes(query)).not.toContain(2);
    else expect(codes(query)).toContain(2);
  });
  it("requires every query word to match a name word prefix", () => {
    expect(codes("eyes red")).not.toContain(1);
  });
  it("keeps a contiguous substring fallback", () => {
    expect(codes("ue eyes")).toContain(1);
  });
  it("ranks exact names, starts, word prefixes, then substrings, with length and alphabet ties", () => {
    expect(codes("blue")).toEqual([3, 4, 1, 10, 5, 6, 8, 7, 9]);
    expect(codes("blue dra")).toEqual([4, 8, 1, 10, 9]);
  });
  it("ranks all candidates before applying the 50-result cap", () => {
    const result = codes("the");
    expect(result).toHaveLength(50);
    expect(result.slice(0, 2)).toEqual([900, 901]);
  });
  it("puts own deck matches first before the cap without changing cached card metadata", () => {
    const result = cards.search("the", undefined, new Set([901]));
    expect(result).toHaveLength(50);
    expect(result.slice(0, 2).map(card => card.code)).toEqual([901, 900]);
    expect(result[0].inDeck).toBe(true);
    expect(result[1].inDeck).not.toBe(true);
    expect(cards.get(901)?.inDeck).toBeUndefined();
  });
  it.each(["", " ", "b"])("returns only matching own deck suggestions for a short query %j", query => {
    const result = cards.search(query, undefined, new Set([1, 2, 4]));
    expect(result.map(card => card.code)).toEqual(query.trim() ? [4, 1] : [4, 1, 2]);
    expect(result.every(card => card.inDeck)).toBe(true);
    expect(cards.search(query, undefined, new Set())).toEqual([]);
  });
  it("applies the legal-name predicate to deck suggestions and exact passcodes", () => {
    const monsters = (card: { type: number }) => (card.type & 1) !== 0;
    expect(cards.search("", monsters, new Set([1, 2])).map(card => card.code)).toEqual([1]);
    expect(cards.search("2", monsters, new Set([2]))).toEqual([]);
    expect(cards.search("feather", monsters, new Set([2]))).toEqual([]);
  });
  it("keeps exact passcodes ahead of deck and partial passcode matches", () => {
    expect(codes("900", new Set([901]))[0]).toBe(900);
    expect(codes("1")).toContain(1);
  });
  it("suggests a legal canonical name for an own alternate artwork", () => {
    const own = deckSearchCodes(cards, { main: [10], extra: [], side: [] });
    const result = cards.search("", data => data.alias === 0, own);
    expect(result.map(card => card.code)).toEqual([1]);
    expect(result[0].inDeck).toBe(true);
  });
});
