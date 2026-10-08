import { describe, expect, it } from "vitest";
import { deckNameFromFile, pastedDeckName, sameDeckCards, uniqueDeckName } from "../../src/components/duel/import-save";

describe("import save names and matching", () => {
  it("drops .ydk from a file name", () => {
    expect(deckNameFromFile("Red Eyes.YDK")).toBe("Red Eyes");
    expect(deckNameFromFile(".ydk")).toBe("Imported deck");
  });

  it("formats a paste name", () => {
    expect(pastedDeckName(new Date(2026, 9, 8, 7, 5))).toBe("Imported deck 2026-10-08 07:05");
  });

  it("counts up until a name is free and keeps the 100 character limit", () => {
    expect(uniqueDeckName("A", ["A", "A (2)"])).toBe("A (3)");
    const long = "x".repeat(100);
    const name = uniqueDeckName(long, [long]);
    expect(name).toHaveLength(100);
    expect(name.endsWith(" (2)")).toBe(true);
  });

  it("compares cards in any order, with the Deck Master", () => {
    expect(sameDeckCards({ main: [1, 2], extra: [], side: [] }, { main: [2, 1], extra: [], side: [] })).toBe(true);
    expect(sameDeckCards({ main: [1], extra: [], side: [] }, { main: [1], extra: [], side: [3] })).toBe(false);
    expect(sameDeckCards({ main: [1], extra: [], side: [], deckMaster: 5 }, { main: [1], extra: [], side: [] })).toBe(false);
  });
});
