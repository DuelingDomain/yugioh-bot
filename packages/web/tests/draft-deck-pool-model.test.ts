import { describe, expect, it } from "vitest";
import {
  canAddFromPool,
  deckUsage,
  draftDeckNotes,
  draftMainMinimum,
  draftMainTone,
  draftRuleShort,
  draftRuleText,
  poolCounts,
  remainingCopies,
} from "../src/components/decks/pool-model";

const pool = poolCounts([
  { code: 100, count: 2 },
  { code: 200, count: 1 },
  { code: 100, count: 1 },
]);
const deck = (main: number[], extra: number[] = [], side: number[] = []) => ({ main, extra, side });

describe("draft deck pool model", () => {
  it("shares the drafted copies across alternate art and alias codes", () => {
    const catalog = new Map([
      [81480460, { name: "Barrel Dragon", type: 33, alias: 0 }],
      [81480461, { name: "Barrel Dragon", type: 33, alias: 81480460 }],
    ]);
    const cards = poolCounts([{ code: 81480460, count: 1 }, { code: 81480461, count: 1 }], catalog);
    const used = deckUsage(deck([81480461], [], [81480460]), catalog);
    expect(cards).toEqual(new Map([[81480460, 2]]));
    expect(remainingCopies(cards, used, 81480460)).toBe(0);
    expect(canAddFromPool(cards, used, 81480460)).toBe(false);
  });
  it("adds the copies of a card that appears twice in the pool list", () => {
    expect(pool.get(100)).toBe(3);
    expect(pool.get(200)).toBe(1);
  });

  it("counts the remaining copies across Main, Extra and Side", () => {
    const used = new Map([[100, 2]]);
    expect(remainingCopies(pool, used, 100)).toBe(1);
    expect(remainingCopies(pool, used, 200)).toBe(1);
  });

  it("never gives a negative count and gives 0 for a card outside the pool", () => {
    expect(remainingCopies(pool, new Map([[200, 4]]), 200)).toBe(0);
    expect(remainingCopies(pool, new Map(), 999)).toBe(0);
  });

  it("blocks a fourth copy even when the pool has five", () => {
    const big = poolCounts([{ code: 7, count: 5 }]);
    expect(canAddFromPool(big, new Map([[7, 3]]), 7)).toBe(false);
    expect(canAddFromPool(big, new Map([[7, 5]]), 7)).toBe(false);
    expect(canAddFromPool(pool, new Map(), 999)).toBe(false);
  });

  it("sets the main minimum to 40, or to the whole main pool when it is smaller", () => {
    expect(draftMainMinimum(60)).toBe(40);
    expect(draftMainMinimum(40)).toBe(40);
    expect(draftMainMinimum(28)).toBe(28);
    expect(draftMainMinimum(0)).toBe(0);
  });

  it("states the size rule", () => {
    expect(draftRuleText(50)).toBe("Main deck: 40 to 60 cards. Extra deck: up to 15.");
    expect(draftRuleText(30)).toContain("all 30 main deck cards");
  });

  it("states the size rule short enough for one line", () => {
    expect(draftRuleShort(50)).toBe("Main: 40 to 60. Extra: up to 15.");
    expect(draftRuleShort(30)).toBe("Main: all 30 cards. Extra: up to 15.");
    expect(draftRuleShort(50).length).toBeLessThanOrEqual(36);
  });

  it("lists the size notes of a deck", () => {
    expect(draftDeckNotes(deck(Array(40).fill(1)), 50)).toEqual([]);
    expect(draftDeckNotes(deck(Array(39).fill(1)), 50)).toEqual(["Main is 39; a draft deck needs at least 40."]);
    expect(draftDeckNotes(deck(Array(30).fill(1)), 30)).toEqual([]);
    expect(draftDeckNotes(deck(Array(61).fill(1), Array(16).fill(2)), 70)).toEqual([
      "Main is 61; the most is 60.",
      "Extra is 16; the most is 15.",
    ]);
  });

  it("picks a tone for the Main Deck count", () => {
    expect(draftMainTone(39, 50)).toBe("warn");
    expect(draftMainTone(40, 50)).toBe("ok");
    expect(draftMainTone(30, 30)).toBe("ok");
    expect(draftMainTone(61, 70)).toBe("bad");
  });
});
