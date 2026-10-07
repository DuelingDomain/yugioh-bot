import { describe, expect, it } from "vitest";
import {
  EMPTY_LEDGER,
  cardKey,
  record,
  remaining,
  settle,
  withoutEntry,
  type CountOf,
  type Ledger,
} from "@/components/card-list-import/import-ledger";
import { gainMap, gainsBetween, subtractEntries } from "@/components/cubes/cube-import-model";
import type { CubePoolsDto } from "@/lib/cube-pools";

const K = cardKey("main", 1);
const counts = (n: number, key = K): CountOf => (k) => (k === key ? n : 0);
const gains = (n: number, key = K) => new Map([[key, n]]);

describe("import ledger", () => {
  it("keeps the gain when nothing changed, and Remove takes all of it", () => {
    const ledger = record(EMPTY_LEDGER, 1, gains(2), counts(5));
    expect(remaining(settle(ledger, counts(5)), 1, counts(5)).get(K)).toBe(2);
  });

  it("pool 3, import +2 = 5, lowered to 3: nothing is left to remove", () => {
    const ledger = record(EMPTY_LEDGER, 1, gains(2), counts(5));
    const settled = settle(ledger, counts(3));
    expect(remaining(settled, 1, counts(3)).size).toBe(0);
  });

  it("a card the owner raised again keeps the whole gain", () => {
    const ledger = settle(record(EMPTY_LEDGER, 1, gains(2), counts(5)), counts(8));
    expect(remaining(ledger, 1, counts(8)).get(K)).toBe(2);
  });

  it("lowering by hand takes from the newest import first", () => {
    let ledger: Ledger = record(EMPTY_LEDGER, 1, gains(2), counts(5));
    ledger = record(settle(ledger, counts(5)), 2, gains(2), counts(7));
    ledger = settle(ledger, counts(6));
    expect(remaining(ledger, 2, counts(6)).get(K)).toBe(1);
    expect(remaining(ledger, 1, counts(6)).get(K)).toBe(2);
    ledger = settle(ledger, counts(4));
    expect(remaining(ledger, 2, counts(4)).size).toBe(0);
    expect(remaining(ledger, 1, counts(4)).get(K)).toBe(1);
  });

  it("removes stacked imports in any order, never below zero", () => {
    let ledger: Ledger = record(EMPTY_LEDGER, 1, gains(2), counts(5));
    ledger = record(settle(ledger, counts(5)), 2, gains(2), counts(7));
    // Remove the oldest first: 7 - 2 = 5, and the newest keeps its 2.
    const first = remaining(ledger, 1, counts(7)).get(K)!;
    ledger = withoutEntry(ledger, 1);
    expect(first).toBe(2);
    expect(settle(ledger, counts(7 - first))).toBe(ledger);
    expect(remaining(ledger, 2, counts(5)).get(K)).toBe(2);
    ledger = withoutEntry(ledger, 2);
    expect(ledger.entries).toHaveLength(0);
    expect(ledger.seen.size).toBe(0);
  });

  it("never returns more than the pool holds", () => {
    const ledger = record(EMPTY_LEDGER, 1, gains(4), counts(4));
    expect(remaining(ledger, 1, counts(1)).get(K)).toBe(1);
  });

  it("tracks the main and extra copy of a card apart", () => {
    const extra = cardKey("extra", 1);
    const both: CountOf = (k) => (k === K ? 3 : k === extra ? 2 : 0);
    const ledger = record(EMPTY_LEDGER, 1, new Map([[K, 3], [extra, 2]]), both);
    const lowered: CountOf = (k) => (k === K ? 3 : k === extra ? 1 : 0);
    const left = remaining(settle(ledger, lowered), 1, lowered);
    expect(left.get(K)).toBe(3);
    expect(left.get(extra)).toBe(1);
    expect(subtractEntries(left)).toEqual([
      { id: 1, copies: 3, pool: "main" },
      { id: 1, copies: 1, pool: "extra" },
    ]);
  });
});

const pools = (main: Array<[number, number]>, extra: Array<[number, number]> = []): CubePoolsDto => ({
  main: main.map(([catalogCardId, maxCopies]) => ({ catalogCardId, maxCopies })) as CubePoolsDto["main"],
  extra: extra.map(([catalogCardId, maxCopies]) => ({ catalogCardId, maxCopies })) as CubePoolsDto["extra"],
});

describe("gainsBetween", () => {
  it("counts a rise in copies, and nothing for a card that lost copies or did not change", () => {
    const found = gainsBetween(pools([[1, 2], [2, 3], [3, 1]]), pools([[1, 5], [2, 3], [3, 0 + 1], [4, 2]]));
    expect(found).toEqual([
      { id: 1, pool: "main", copies: 3 },
      { id: 4, pool: "main", copies: 2 },
    ]);
  });

  it("does not count a card that only moved from Main to Extra", () => {
    expect(gainsBetween(pools([[7, 3]]), pools([], [[7, 3]]))).toEqual([]);
  });

  it("counts only the real rise when a card moved and also gained", () => {
    const found = gainsBetween(pools([[7, 3]]), pools([], [[7, 5]]));
    expect(found).toEqual([{ id: 7, pool: "extra", copies: 2 }]);
    expect(gainMap(found, "extra").get(7)).toBe(2);
  });
});
