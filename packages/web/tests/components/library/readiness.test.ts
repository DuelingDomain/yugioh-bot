import { describe, expect, it } from "vitest";
import { cardsToRaise, clampCopies, cubeReadiness, poolTotals } from "@/components/cubes/readiness";

describe("cubeReadiness", () => {
  it("needs 42 main and 17 extra copies", () => {
    const r = cubeReadiness(0, 0);
    expect(r.main.need).toBe(42);
    expect(r.extra.need).toBe(17);
  });

  it("is blocked when main is short, even if extra is fine", () => {
    const r = cubeReadiness(41, 40);
    expect(r.state).toBe("blocked");
    expect(r.main.short).toBe(1);
  });

  it("is only a soft warning when extra is short", () => {
    const r = cubeReadiness(42, 16);
    expect(r.state).toBe("soft");
    expect(r.extra.short).toBe(1);
  });

  it("is ready at exactly 42 and 17", () => {
    expect(cubeReadiness(42, 17).state).toBe("ready");
  });
});

describe("cardsToRaise", () => {
  it("counts the cards raised to x3 that cover the shortfall", () => {
    const entries = [{ maxCopies: 2 }, { maxCopies: 2 }, { maxCopies: 1 }, { maxCopies: 3 }];
    expect(cardsToRaise(entries, 2)).toBe(1);
    expect(cardsToRaise(entries, 3)).toBe(2);
    expect(cardsToRaise(entries, 4)).toBe(3);
    expect(cardsToRaise(entries, 5)).toBeNull();
    expect(cardsToRaise(entries, 0)).toBe(0);
  });
});

describe("poolTotals and clampCopies", () => {
  it("sums copies, and the copies one player can be given count a card at most three times", () => {
    expect(poolTotals([{ maxCopies: 3 }, { maxCopies: 1 }])).toEqual({ cards: 2, copies: 4, usable: 4 });
    expect(poolTotals([{ maxCopies: 30 }, { maxCopies: 1 }])).toEqual({ cards: 2, copies: 31, usable: 4 });
  });
  it("clamps to 1..99", () => {
    expect([0, 1, 2, 3, 4, 50, 99, 100, 250].map(clampCopies)).toEqual([1, 1, 2, 3, 4, 50, 99, 99, 99]);
  });
});
