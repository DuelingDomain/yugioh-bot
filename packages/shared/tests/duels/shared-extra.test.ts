import { describe, expect, it } from "vitest";
import { DUEL_FORMATS, seatCountFor, sharedExtraSeatOf } from "../../src/duels/index.js";

describe("shared Extra Monster Zones", () => {
  it("pairs only FFA4 seats 0/1 and 2/3", () => {
    for (const format of DUEL_FORMATS) {
      expect(Array.from({ length: seatCountFor(format) }, (_, seat) => sharedExtraSeatOf(format, seat)))
        .toEqual(format === "ffa4" ? [1, 0, 3, 2] : Array(seatCountFor(format)).fill(null));
    }
  });

  it("keeps seat numbers fixed for every set of eliminated seats", () => {
    for (let mask = 0; mask < 16; mask += 1) {
      const eliminated = new Set([0, 1, 2, 3].filter((seat) => (mask & (1 << seat)) !== 0));
      expect([0, 1, 2, 3].map((seat) => sharedExtraSeatOf("ffa4", seat, eliminated)))
        .toEqual([0, 1, 2, 3].map((seat) => eliminated.has(seat) || eliminated.has((seat ^ 1)) ? null : (seat ^ 1)));
    }
  });

  it("does not pair invalid seats", () => {
    for (const seat of [-1, 4, 255, 0.5, NaN]) expect(sharedExtraSeatOf("ffa4", seat)).toBeNull();
  });
});
