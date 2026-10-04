import { describe, expect, it } from "vitest";
import { rowsForShard } from "./shard.js";

describe("Table row shards", () => {
  it("runs every row once across six shards, in its original order", () => {
    const rows = Array.from({ length: 431 }, (_, index) => index);
    const shards = Array.from({ length: 6 }, (_, index) => rowsForShard(rows, `${index + 1}/6`));
    expect(shards.flat().sort((a, b) => a - b)).toEqual(rows);
    expect(new Set(shards.flat()).size).toBe(rows.length);
    for (const shard of shards) expect(shard).toEqual([...shard].sort((a, b) => a - b));
    expect(Math.max(...shards.map((shard) => shard.length)) - Math.min(...shards.map((shard) => shard.length))).toBeLessThanOrEqual(1);
  });

  it("keeps the complete table for local runs without a shard", () => {
    const rows = [1, 2, 3];
    expect(rowsForShard(rows)).toEqual(rows);
  });

  it.each(["0/6", "7/6", "1/0", "1.5/6", "1/6junk", "", "1"])("rejects invalid shard %s", (shard) => {
    expect(() => rowsForShard([1], shard)).toThrow(/shard/i);
  });
});
