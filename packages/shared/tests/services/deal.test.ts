import { describe, expect, it } from "vitest";
import { mulberry32, seededShuffle, analyzeCube, buildDeal } from "../../src/services/deal.js";

describe("cube engine", () => {
  it("mulberry32 is deterministic for a seed", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const seqA = [a(), a(), a()];
    const seqB = [b(), b(), b()];
    expect(seqA).toEqual(seqB);
    expect(seqA[0]).toBeGreaterThanOrEqual(0);
    expect(seqA[0]).toBeLessThan(1);
  });

  it.each([99, "a".repeat(64)])("seededShuffle is deterministic and a permutation (%s)", (seed) => {
    const input = [1, 2, 3, 4, 5, 6, 7, 8];
    const s1 = seededShuffle(input, seed);
    const s2 = seededShuffle(input, seed);
    expect(s1).toEqual(s2);
    expect([...s1].sort((x, y) => x - y)).toEqual(input);
    expect(input).toEqual([1, 2, 3, 4, 5, 6, 7, 8]); // input not mutated
  });

  it("accepts ten names with ten copies for 2 × 3 × 15", () => {
    const r = analyzeCube(Array.from({ length: 10 }, (_, i) => Array(10).fill(i + 1)).flat(), 2, 3, 15);
    expect(r).toEqual({ ok: true, errors: [], warnings: ["A player cannot make a legal 45-card deck from this cube."] });
  });

  it("rejects a thirty-singleton cube for 2 × 5 × 15", () => {
    const r = analyzeCube(Array.from({ length: 30 }, (_, i) => i), 2, 5, 15);
    expect(r.ok).toBe(false);
    expect(r.errors).toEqual(["The cube has 30 cards. 2 players × 5 packs × 15 cards needs 150. Add cards, or use fewer packs or smaller packs."]);
  });

  it("rejects a pick total larger than the packs", () => {
    const r = analyzeCube(Array.from({ length: 80 }, (_, i) => i), 2, 5, 8, 60);
    expect(r.errors).toEqual(["Each player opens 5 packs of 8 = 40 cards, but needs 60."]);
  });

  it("warns only for a deck that cannot be legal, without a wave cap", () => {
    const cube = Array(100).fill(1);
    expect(analyzeCube(cube, 2, 5, 8, 3)).toEqual({ ok: true, errors: [], warnings: [] });
    expect(analyzeCube(cube, 2, 5, 8, 40).warnings).toEqual(["A player cannot make a legal 40-card deck from this cube."]);
  });

  it("deals the top of one full shuffle in wave then seat order", () => {
    const cube = Array.from({ length: 100 }, (_, i) => i);
    const packs = buildDeal(cube, { players: 2, waves: 3, packSize: 15, seed: 7 });
    expect(packs).toHaveLength(6);
    expect(packs.every((pack) => pack.length === 15)).toBe(true);
    expect(packs.flat()).toEqual(seededShuffle(cube, 7).slice(0, 90));
  });

  it("allows duplicates in a pack and deals authored copies without a wave cap", () => {
    const cube = [...Array(10).fill(1), ...Array(10).fill(2)];
    const packs = buildDeal(cube, { players: 2, waves: 1, packSize: 10, seed: 34 });
    expect(packs.flat().filter((id) => id === 1)).toHaveLength(10);
    expect(packs.every((pack) => new Set(pack).size < pack.length)).toBe(true);
  });

  it("draft-34 regression: singleton cubes never deal duplicates", () => {
    const cube = Array.from({ length: 364 }, (_, i) => i + 1);
    const packs = buildDeal(cube, { players: 7, waves: 4, packSize: 13, seed: 34 });
    expect(packs).toHaveLength(28);
    expect(packs.flat()).toHaveLength(364);
    expect(new Set(packs.flat()).size).toBe(364);
    expect(() => buildDeal(cube.slice(0, 239), { players: 7, waves: 4, packSize: 13, seed: 34 })).toThrow(/239.*364/);
  });

  it("throws instead of padding a small cube", () => {
    expect(() => buildDeal([1, 2], { players: 2, waves: 2, packSize: 2, seed: 7 })).toThrow(/2.*8/);
  });

  it("gives each authored copy the same deal rate over 2000 fixed seeds", () => {
    const cube = [...Array.from({ length: 100 }, (_, i) => i + 1), ...Array.from({ length: 60 }, (_, i) => Array(3).fill(i + 101)).flat()];
    const hits = new Map<number, number>();
    for (let seed = 1; seed <= 2000; seed++) {
      for (const id of buildDeal(cube, { players: 4, waves: 5, packSize: 8, seed }).flat()) hits.set(id, (hits.get(id) ?? 0) + 1);
    }
    for (let id = 1; id <= 160; id++) {
      const rate = (hits.get(id) ?? 0) / (2000 * (id <= 100 ? 1 : 3));
      expect(Math.abs(rate - 160 / 280)).toBeLessThan(0.05);
    }
  });

  it.each([555, "a".repeat(64)])("buildDeal is deterministic for a fixed seed (%s)", (seed) => {
    const cube = Array.from({ length: 80 }, (_, i) => i + 1);
    expect(buildDeal(cube, { players: 2, waves: 5, packSize: 8, seed }))
      .toEqual(buildDeal(cube, { players: 2, waves: 5, packSize: 8, seed }));
  });

  it.each([[555, 556], ["a".repeat(64), "b".repeat(64)]])("buildDeal differs across seeds (%s, %s)", (first, second) => {
    const cube = Array.from({ length: 80 }, (_, i) => i + 1);
    expect(buildDeal(cube, { players: 2, waves: 5, packSize: 8, seed: first }))
      .not.toEqual(buildDeal(cube, { players: 2, waves: 5, packSize: 8, seed: second }));
  });
});
