import { describe, expect, it } from "vitest";
import { COIN_TIMING, COIN_TOSS_MS, COIN_SUMMARY_MS, COIN_CHAIN_BEAT_MAX_MS, MIN_DUEL_FX_SPEED, coinTossDurationMs } from "../../src/duels/index.js";

describe("coin toss timing", () => {
  it("matches the web coin, summary and slowest speed", () => {
    expect(COIN_TOSS_MS).toBe(3_180);
    expect(COIN_TIMING.summaryHoldMs).toBe(1_000);
    expect(COIN_SUMMARY_MS).toBe(1_520);
    expect(MIN_DUEL_FX_SPEED).toBe(0.5);
    expect(COIN_CHAIN_BEAT_MAX_MS).toBe(1_170);
  });

  it.each([
    [0, 1, 0], [1, 1, 3_180], [2, 1, 7_880], [3, 1, 11_060],
    [3, 0.5, 22_120], [3, 2, 5_530], [5, 1, 17_420],
  ])("covers %i coins at %sx in %i ms", (count, speed, expected) => {
    expect(coinTossDurationMs(count, speed)).toBe(expected);
  });

  it.each([-1, 1.5, NaN, Infinity])("rejects invalid count %s", (count) => {
    expect(() => coinTossDurationMs(count, 1)).toThrow(RangeError);
  });

  it.each([0, -1, NaN, Infinity])("rejects invalid speed %s", (speed) => {
    expect(() => coinTossDurationMs(3, speed)).toThrow(RangeError);
  });
});
