import { describe, expect, it } from "vitest";
import {
  addCopyLine,
  addOneCopy,
  addedLine,
  changesText,
  clampCopies,
  cubeCardCount,
  diffPools,
  editedHeadline,
  extraNote,
  freeCubeName,
  listRows,
  mergeAdd,
  mergePasscodes,
  passcodesLine,
  poolFromEntries,
  poolFromIds,
  poolToEntries,
  poolToIds,
  railPool,
  seatCheck,
  stepCopies,
  tallyCopies,
  tallyDistinct,
  totalCopies,
  type CardInfo,
} from "@/components/draft/pool/pool-model";

const card = (id: number, name: string, type = "Effect Monster", frameType = "effect"): CardInfo => ({
  id,
  name,
  type,
  frameType,
  imageUrl: "",
  imageUrlSmall: "",
});

describe("pool conversions", () => {
  it("counts repeated passcodes as copies and expands back in order", () => {
    const pool = poolFromIds([5, 5, 7, 5]);
    expect(pool.get(5)).toBe(3);
    expect(pool.get(7)).toBe(1);
    expect(poolToIds(pool)).toEqual([5, 5, 5, 7]);
    expect(totalCopies(pool)).toBe(4);
  });

  it("caps copies at 99 and drops entries that are not valid", () => {
    expect(clampCopies(500)).toBe(99);
    expect(clampCopies(0)).toBe(1);
    const pool = poolFromEntries([
      { id: 1, copies: 80 },
      { id: 1, copies: 80 },
      { id: -4, copies: 1 },
      { id: 2, copies: 0 },
    ]);
    expect(poolToEntries(pool)).toEqual([{ id: 1, copies: 99 }]);
  });
});

describe("stepping", () => {
  it("steps up to 99, not 3", () => {
    let pool = poolFromEntries([{ id: 1, copies: 3 }]);
    pool = stepCopies(pool, 1, 1);
    expect(pool.get(1)).toBe(4);
    pool = stepCopies(poolFromEntries([{ id: 1, copies: 99 }]), 1, 1);
    expect(pool.get(1)).toBe(99);
  });

  it("removes the card when stepping down from 1 and never mutates the input", () => {
    const pool = poolFromEntries([{ id: 1, copies: 1 }]);
    const next = stepCopies(pool, 1, -1);
    expect(next.has(1)).toBe(false);
    expect(pool.get(1)).toBe(1);
  });

  it("adds one copy and reports when a card is at the cap", () => {
    const at99 = poolFromEntries([{ id: 1, copies: 99 }]);
    expect(addOneCopy(at99, 1).changed).toBe(false);
    expect(addOneCopy(poolFromIds([]), 9).pool.get(9)).toBe(1);
  });
});

describe("mergeAdd", () => {
  const items = [
    { card: card(1, "A"), copies: 3 },
    { card: card(2, "B"), copies: 3 },
    { card: card(3, "Fusion", "Fusion Monster", "fusion"), copies: 3 },
    { card: card(4, "Pendulum fusion", "Pendulum Effect Fusion Monster", "fusion_pendulum"), copies: 3 },
    { card: card(5, "Link", "Link Monster", "link"), copies: 3 },
  ];

  it("leaves Extra Deck cards out, including pendulum variants, and keeps copies of cards already in", () => {
    const base = poolFromEntries([{ id: 2, copies: 1 }]);
    const out = mergeAdd(base, items);
    expect(out.added).toBe(1);
    expect(out.alreadyIn).toBe(1);
    expect(out.extraSkipped).toBe(3);
    expect(out.pool.get(1)).toBe(3);
    expect(out.pool.get(2)).toBe(1);
    expect(out.pool.has(3)).toBe(false);
    expect(out.pool.has(4)).toBe(false);
    expect(out.pool.has(5)).toBe(false);
    expect(base.size).toBe(1);
  });

  it("words the result", () => {
    expect(addedLine("Blue-Eyes", { added: 34, alreadyIn: 0, extraSkipped: 6 })).toBe(
      "Added 34 cards from Blue-Eyes. 6 Extra Deck cards stay out.",
    );
    expect(addedLine("Blue-Eyes", { added: 1, alreadyIn: 1, extraSkipped: 1 })).toBe(
      "Added 1 card from Blue-Eyes. 1 Extra Deck card stays out. 1 was already in the pool.",
    );
    expect(extraNote(38)).toBe("38 Extra Deck cards stay out. Cube drafts deal main-deck cards.");
    expect(extraNote(0)).toBeNull();
    expect(addCopyLine("Mirror Force", true)).toBe("Added 1 copy of Mirror Force.");
    expect(addCopyLine("Mirror Force", false)).toBe("Mirror Force is already at 99 copies.");
    expect(passcodesLine({ added: 3, copies: 5, unknown: 1, extraSkipped: 2, atCap: 0 })).toBe(
      "Added 5 copies of 3 cards. 1 passcode isn't in the card list yet. 2 Extra Deck cards stay out.",
    );
    expect(passcodesLine({ added: 12, copies: 12, unknown: 0, extraSkipped: 0, atCap: 0, invalid: 2 })).toBe(
      "Added 12 cards. 2 entries aren't passcodes.",
    );
  });

  it("adds a copy for every time a passcode is pasted, to new and existing cards", () => {
    const base = poolFromEntries([
      { id: 1, copies: 2 },
      { id: 2, copies: 99 },
    ]);
    const out = mergePasscodes(
      base,
      new Map([
        [1, 2],
        [2, 1],
        [3, 1],
        [4, 1],
      ]),
      [card(1, "A"), card(2, "B"), card(3, "C"), card(4, "Link", "Link Monster", "link")],
      [77, 77, 78],
    );
    expect(out.pool.get(1)).toBe(4);
    expect(out.pool.get(2)).toBe(99);
    expect(out.pool.get(3)).toBe(1);
    expect(out.pool.has(4)).toBe(false);
    expect(out).toMatchObject({ added: 2, copies: 3, unknown: 2, extraSkipped: 1, atCap: 1 });
  });
});

describe("diffPools", () => {
  it("counts copies added and removed and lists gone cards", () => {
    const base = poolFromEntries([
      { id: 1, copies: 3 },
      { id: 2, copies: 3 },
      { id: 3, copies: 1 },
    ]);
    const pool = poolFromEntries([
      { id: 1, copies: 5 },
      { id: 2, copies: 2 },
      { id: 9, copies: 3 },
    ]);
    const d = diffPools(base, pool);
    expect(d.added).toBe(2 + 3);
    expect(d.removed).toBe(1 + 1);
    expect(d.goneIds).toEqual([3]);
    expect(d.changedIds.sort()).toEqual([1, 2, 3, 9]);
    expect(d.any).toBe(true);
  });

  it("is not edited when the pools match", () => {
    const base = poolFromIds([1, 1, 2]);
    expect(diffPools(base, new Map(base)).any).toBe(false);
  });

  it("words the status headline", () => {
    expect(editedHeadline({ added: 24, removed: 3 })).toBe("Edited for this draft. 24 cards added, 3 removed.");
    expect(editedHeadline({ added: 0, removed: 3 })).toBe("Edited for this draft. 3 cards removed.");
    expect(changesText({ added: 1, removed: 0 })).toBe("1 card added");
  });
});

describe("seat check", () => {
  it("says it seats 8 when total copies cover 8 x cards per player", () => {
    expect(seatCheck(360, 45)).toEqual({ supported: 8, enough: true, text: "Enough cards for 8 players" });
  });

  it("uses the owner's wording for a pool that is too small", () => {
    const r = seatCheck(200, 45);
    expect(r.enough).toBe(false);
    expect(r.supported).toBe(4);
    expect(r.text).toBe("Only enough cards for 4 players. Add 160 more cards to seat 8.");
  });

  it("follows the cards dealt per player and counts copies", () => {
    expect(seatCheck(360, 60).text).toBe("Only enough cards for 6 players. Add 120 more cards to seat 8.");
    expect(seatCheck(45, 45).text).toBe("Only enough cards for 1 player. Add 315 more cards to seat 8.");
  });
});

describe("names", () => {
  it("picks a free copy name without regard to case", () => {
    expect(freeCubeName("Goat cube", ["Goat cube"])).toBe("Goat cube 2");
    expect(freeCubeName("Goat cube", ["Goat cube", "goat cube 2", "Goat cube 3"])).toBe("Goat cube 4");
    expect(freeCubeName(null, [])).toBe("My cube");
    expect(freeCubeName(null, ["my cube"])).toBe("My cube 2");
  });

  it("words the rail pool row", () => {
    expect(railPool({ baseName: "Goat cube", edited: false, total: 412, empty: false })).toEqual({ name: "Goat cube", count: "412 cards" });
    expect(railPool({ baseName: "Goat cube", edited: true, total: 433, empty: false })).toEqual({ name: "Goat cube, edited", count: "433 cards" });
    expect(railPool({ baseName: null, edited: false, total: 120, empty: false })).toEqual({ name: "Built for this draft", count: "120 cards" });
    expect(railPool({ baseName: null, edited: false, total: 0, empty: true }).name).toBe("Nothing yet");
  });

  it("shows a picker count, or nothing for a pool that is only sets", () => {
    expect(cubeCardCount({ mainCopies: 412, setNames: [], customCardIds: [] })).toBe(412);
    expect(cubeCardCount({ mainCopies: 0, setNames: [], customCardIds: [1, 2] })).toBe(2);
    expect(cubeCardCount({ mainCopies: 0, setNames: ["LOB"], customCardIds: [] })).toBeNull();
  });
});

describe("rows and tallies", () => {
  const infos = new Map<number, CardInfo>([
    [1, card(1, "Zombie", "Effect Monster")],
    [2, card(2, "Mirror Force", "Trap Card", "trap")],
    [3, card(3, "Pot of Greed", "Spell Card", "spell")],
    [4, card(4, "Alpha", "Normal Monster", "normal")],
  ]);
  const info = (id: number) => infos.get(id);
  const pool = poolFromEntries([
    { id: 1, copies: 2 },
    { id: 2, copies: 3 },
    { id: 3, copies: 1 },
    { id: 4, copies: 3 },
  ]);

  it("tallies copies and different cards by kind", () => {
    expect(tallyCopies(pool, info)).toEqual({ total: 9, monsters: 5, spells: 1, traps: 3 });
    expect(tallyDistinct(pool, info)).toEqual({ all: 4, monster: 2, spell: 1, trap: 1 });
  });

  it("sorts by name, filters by kind and query, and pins changed cards first", () => {
    expect(listRows(pool, info, { query: "", filter: "all", pinned: new Set() })).toEqual([4, 2, 3, 1]);
    expect(listRows(pool, info, { query: "", filter: "all", pinned: new Set([3]) })).toEqual([3, 4, 2, 1]);
    expect(listRows(pool, info, { query: "", filter: "monster", pinned: new Set() })).toEqual([4, 1]);
    expect(listRows(pool, info, { query: "mirror", filter: "all", pinned: new Set() })).toEqual([2]);
  });

  it("handles 200 different cards with 500 copies", () => {
    const big = poolFromEntries(Array.from({ length: 200 }, (_, i) => ({ id: i + 1, copies: i < 100 ? 3 : 2 })));
    expect(totalCopies(big)).toBe(500);
    const rows = listRows(big, (id) => card(id, `Card ${id}`), { query: "", filter: "all", pinned: new Set() });
    expect(rows).toHaveLength(200);
  });
});
