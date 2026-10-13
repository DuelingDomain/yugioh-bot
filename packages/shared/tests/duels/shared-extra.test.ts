import { describe, expect, it } from "vitest";
import { DUEL_FORMATS, seatCountFor, sharedExtraSeatOf } from "../../src/duels/index.js";

describe("shared Extra Monster Zones", () => {
  it("pairs facing FFA3, FFA4 and Tag seats", () => {
    for (const format of DUEL_FORMATS) {
      expect(Array.from({ length: seatCountFor(format) }, (_, seat) => sharedExtraSeatOf(format, seat)))
        .toEqual(format === "ffa4" || format === "tag" ? [1, 0, 3, 2] : format === "ffa3" ? [1, 0, null] : [null, null]);
    }
  });

  it("keeps seat numbers fixed for every set of eliminated seats", () => {
    for (const format of ["ffa3", "ffa4", "tag"] as const) for (let mask = 0; mask < 16; mask += 1) {
      const eliminated = new Set([0, 1, 2, 3].filter((seat) => (mask & (1 << seat)) !== 0));
      expect(Array.from({ length: seatCountFor(format) }, (_, seat) => sharedExtraSeatOf(format, seat, eliminated)))
        .toEqual(Array.from({ length: seatCountFor(format) }, (_, seat) => (seat ^ 1) >= seatCountFor(format) || eliminated.has(seat) || eliminated.has(seat ^ 1) ? null : seat ^ 1));
    }
  });

  it("does not pair invalid seats", () => {
    for (const format of ["ffa3", "ffa4", "tag"] as const) {
      for (const seat of [-1, seatCountFor(format), 255, 0.5, NaN]) expect(sharedExtraSeatOf(format, seat)).toBeNull();
    }
  });
});
