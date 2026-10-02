import { describe, expect, it } from "vitest";
import type { SavedDeck } from "@yugidraft/shared/duels";
import { deckFanCodes, deckStatus } from "@/components/decks/library-status";
import { guidanceNotes } from "@/components/decks/model";

const codes = (n: number, start = 1) => Array.from({ length: n }, (_, i) => start + i);
function deck(mode: SavedDeck["mode"], main: number, extra = 0, side = 0, deckMaster?: number): SavedDeck["deck"] {
  return { main: codes(main), extra: codes(extra, 1000), side: codes(side, 2000), ...(deckMaster != null ? { deckMaster } : {}) };
}

describe("deckStatus", () => {
  it("says sizes fit when the editor has no notes", () => {
    const d = deck("normal", 41, 15, 15);
    expect(guidanceNotes("normal", d)).toEqual([]);
    expect(deckStatus({ mode: "normal", deck: d })).toMatchObject({ ok: true, head: "Sizes fit a Standard table", more: 0 });
  });

  it("splits the editor's first note", () => {
    const d = deck("normal", 33);
    const notes = guidanceNotes("normal", d);
    const s = deckStatus({ mode: "normal", deck: d });
    expect(s.ok).toBe(false);
    expect(notes[0]).toBe(`${s.head}; ${s.rest}`);
    expect(s.head).toBe("Main is 33");
  });

  it("counts the notes after the first", () => {
    const d = deck("domain", 58, 3, 1);
    const notes = guidanceNotes("domain", d);
    const s = deckStatus({ mode: "domain", deck: d });
    expect(notes.length).toBeGreaterThan(1);
    expect(s.more).toBe(notes.length - 1);
  });
});

describe("deckFanCodes", () => {
  it("takes three distinct codes, Deck Master first", () => {
    expect(deckFanCodes({ main: [5, 5, 6, 7, 8], extra: [9], side: [], deckMaster: 4 })).toEqual([4, 5, 6]);
    expect(deckFanCodes({ main: [], extra: [], side: [] })).toEqual([]);
  });
});
