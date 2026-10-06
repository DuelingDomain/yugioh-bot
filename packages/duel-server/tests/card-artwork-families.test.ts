import { describe, expect, it } from "vitest";
import { emptyCardQuery, type DeckCardInfo } from "@yugidraft/shared/duels";
import type { CardDatabase } from "../src/cards.js";
import { cardArtworkFamily } from "../src/card-artworks.js";
import { queryCards } from "../src/card-search.js";

const card = (code: number, alias = 0, name = "Dragon", type = 17): DeckCardInfo => ({
  code, alias, name, type, description: "", attack: 3000, defense: 2500, level: 8,
  attribute: 16, race: "dragon", setcodes: [], lscale: 0, rscale: 0, arrows: 0, ot: 3,
});
const rows = [card(12, 11), card(10), card(11, 10), card(20, 10, "Other Dragon"),
  card(30, 10, "Dragon", 33), card(40, 41, "Cycle"), card(41, 40, "Cycle"), card(50, 999, "Orphan")];
const cards = {
  all: () => rows, deckCard: (id: number) => rows.find(c => c.code === id),
  cardData: () => null, setnames: () => new Map(),
} as unknown as CardDatabase;

describe("engine artwork families", () => {
  it("accepts every member and orders main first then numeric alts", () => {
    for (const id of [10, 11, 12]) expect(cardArtworkFamily(cards, id)).toEqual({
      passcode: 10, artworks: [{ passcode: 10, isMain: true }, { passcode: 11, isMain: false }, { passcode: 12, isMain: false }],
    });
    expect(cardArtworkFamily(cards, 999)).toBeUndefined();
  });
  it("does not merge different game cards, missing aliases or cycles", () => {
    for (const id of [20, 30, 40, 41, 50]) expect(cardArtworkFamily(cards, id)).toEqual({
      passcode: id, artworks: [{ passcode: id, isMain: true }],
    });
  });
  it("adds counts without expanding search results, including exact alt lookups", () => {
    const search = (text: string) => queryCards(cards, { ...emptyCardQuery(), text });
    const result = search("Dragon");
    expect(result.cards.map(c => c.code).sort()).toEqual([10, 20, 30]);
    expect(result.cards.find(c => c.code === 10)?.altArtCount).toBe(2);
    expect(result.cards.find(c => c.code === 20)?.altArtCount).toBe(0);
    expect(search("12").cards[0]).toMatchObject({ code: 12, altArtCount: 2 });
    expect(search("Cycle").cards).toHaveLength(2);
  });
});

it("does not repeat the main when an exact alternate code also partially matches it", () => {
  const both = [card(10), card(1, 10)];
  const database = { ...cards, all: () => both, deckCard: (id: number) => both.find(c => c.code === id) } as CardDatabase;
  const result = queryCards(database, { ...emptyCardQuery(), text: "1" });
  expect(result.cards.map(card => card.code)).toEqual([1]);
  expect(result.cards[0].altArtCount).toBe(1);
});
