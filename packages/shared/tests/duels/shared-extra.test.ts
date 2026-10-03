import { describe, expect, it } from "vitest";
import { DUEL_FORMATS, seatCountFor, sharedExtraSeatOf } from "../../src/duels/index.js";

describe("shared Extra Monster Zones", () => {
  it("pairs only FFA4 seats across the table", () => {
    for (const format of DUEL_FORMATS) {
      expect(Array.from({ length: seatCountFor(format) }, (_, seat) => sharedExtraSeatOf(format, seat)))
        .toEqual(format === "ffa4" ? [2, 3, 0, 1] : Array(seatCountFor(format)).fill(null));
    }
  });

  it("keeps seat numbers fixed for every set of eliminated seats", () => {
    for (let mask = 0; mask < 16; mask += 1) {
      const eliminated = new Set([0, 1, 2, 3].filter((seat) => (mask & (1 << seat)) !== 0));
      expect([0, 1, 2, 3].map((seat) => sharedExtraSeatOf("ffa4", seat, eliminated)))
        .toEqual([0, 1, 2, 3].map((seat) => eliminated.has(seat) || eliminated.has((seat + 2) % 4) ? null : (seat + 2) % 4));
    }
  });

  it("does not pair invalid seats", () => {
    for (const seat of [-1, 4, 255, 0.5, NaN]) expect(sharedExtraSeatOf("ffa4", seat)).toBeNull();
  });
});
