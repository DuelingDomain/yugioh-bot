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
});
