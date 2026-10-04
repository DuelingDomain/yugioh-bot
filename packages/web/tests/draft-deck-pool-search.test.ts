import { describe, expect, it } from "vitest";
import { CARD_TYPE_BITS as T, emptyCardQuery, type CardQuery, type DeckCardInfo } from "@yugidraft/shared/duels";
import { queryPoolCards } from "../src/components/decks/pool-search";

function card(code: number, name: string, extra: Partial<DeckCardInfo> = {}): DeckCardInfo {
  return {
    code,
    name,
    description: `${name} text`,
    type: T.monster | T.normal,
    attack: 1000,
    defense: 1000,
    level: 4,
    attribute: 0x20,
    race: "Dragon",
    alias: 0,
    setcodes: [],
    lscale: 0,
    rscale: 0,
    arrows: 0,
    ot: 3,
    ...extra,
  };
}

const cards = [
  card(3, "Zeta Wall", { attack: 500 }),
  card(1, "Alpha Dragon", { description: "Discard one card.", attack: 2500 }),
  card(2, "Beta Charm", { type: T.spell, attack: 0, defense: 0, level: 0 }),
];
const query = (patch: Partial<CardQuery>): CardQuery => ({ ...emptyCardQuery(), ...patch });
const codes = (found: DeckCardInfo[]) => found.map((entry) => entry.code);

describe("queryPoolCards", () => {
  it("returns every pool card when the query is empty", () => {
    expect(codes(queryPoolCards(cards, query({}))).sort()).toEqual([1, 2, 3]);
  });

  it("filters by the search words in the name and the text", () => {
    expect(codes(queryPoolCards(cards, query({ text: "discard" })))).toEqual([1]);
    expect(codes(queryPoolCards(cards, query({ text: "zeta" })))).toEqual([3]);
    expect(codes(queryPoolCards(cards, query({ text: "zeta", scope: "name" })))).toEqual([3]);
    expect(codes(queryPoolCards(cards, query({ text: "discard", scope: "name" })))).toEqual([]);
  });

  it("filters by card kind and by attack range", () => {
    expect(codes(queryPoolCards(cards, query({ kind: "spell" })))).toEqual([2]);
    expect(codes(queryPoolCards(cards, query({ kind: "monster", atk: { min: 1000, max: null } })))).toEqual([1]);
  });

  it("sorts by name", () => {
    expect(codes(queryPoolCards(cards, query({ sort: "name", order: "asc" })))).toEqual([1, 2, 3]);
    expect(codes(queryPoolCards(cards, query({ sort: "name", order: "desc" })))).toEqual([3, 2, 1]);
  });

  it("ignores the banlist and limit filters", () => {
    const found = queryPoolCards(cards, query({ banlist: "tcg", limits: ["forbidden"] }));
    expect(found).toHaveLength(3);
  });

  it("puts the exact name first, then starts-with, then contains, then names with every word in another order", () => {
    const pool = [
      card(10, "Skilled Dark Magician"),
      card(11, "Dark Magician Girl"),
      card(12, "Dark Magician of Chaos"),
      card(13, "Dark Magician"),
      card(14, "Magician of Dark Illusion"),
    ];
    expect(codes(queryPoolCards(pool, query({ text: "dark magician", scope: "name" })))).toEqual([13, 11, 12, 10, 14]);
  });

  it("finds a name from a lowercase partial with no hyphen", () => {
    const pool = [card(20, "Pot of Greed"), card(21, "Blue-Eyes White Dragon"), card(22, "Sage with Eyes of Blue")];
    // Every word must be in the name, in any order; the name with the words together is first.
    expect(codes(queryPoolCards(pool, query({ text: "blue eyes" })))).toEqual([21, 22]);
    expect(codes(queryPoolCards(pool, query({ text: "BLUE-EYES white" })))).toEqual([21]);
    expect(codes(queryPoolCards(pool, query({ text: "eyes" }))).sort()).toEqual([21, 22]);
  });
});
