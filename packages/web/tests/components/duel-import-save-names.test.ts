import { describe, expect, it } from "vitest";
import { pastedDeckName, prepareImportSave, sameDeckCards, uniqueDeckName } from "../../src/components/duel/import-save";

describe("import save names and matching", () => {
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

  it("trims the cut name before the suffix and never cuts an emoji", () => {
    const spaced = `${"x".repeat(95)}  tail`;
    expect(uniqueDeckName(spaced, [spaced.slice(0, 100)])).toBe(`${"x".repeat(95)} (2)`);
    const emoji = `${"x".repeat(99)}😀😀`;
    const cut = uniqueDeckName(emoji, [uniqueDeckName(emoji, [])]);
    expect(cut).toBe(`${"x".repeat(96)} (2)`);
    expect(uniqueDeckName(emoji, [])).toBe("x".repeat(99));
  });

  it("prepares the save in the Manage decks shape", () => {
    expect(prepareImportSave({ main: [1], extra: [], side: [9] }, "domain")).toEqual({ ok: true, mode: "domain", deck: { main: [1], extra: [], side: [], deckMaster: 9 } });
    expect(prepareImportSave({ main: [1], extra: [], side: [9, 8] }, "domain")).toEqual({ ok: false });
    expect(prepareImportSave({ main: [1], extra: [], side: [9, 8] }, "normal")).toEqual({ ok: true, mode: "normal", deck: { main: [1], extra: [], side: [9, 8] } });
    expect(prepareImportSave({ main: [1], extra: [], side: [], deckMaster: 5 }, "normal")).toMatchObject({ ok: true, mode: "domain" });
  });

  it("compares cards in any order, with the Deck Master", () => {
    expect(sameDeckCards({ main: [1, 2], extra: [], side: [] }, { main: [2, 1], extra: [], side: [] })).toBe(true);
    expect(sameDeckCards({ main: [1], extra: [], side: [] }, { main: [1], extra: [], side: [3] })).toBe(false);
    expect(sameDeckCards({ main: [1], extra: [], side: [], deckMaster: 5 }, { main: [1], extra: [], side: [] })).toBe(false);
  });
});
