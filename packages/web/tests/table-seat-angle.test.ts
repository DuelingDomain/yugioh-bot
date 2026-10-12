import { describe, expect, it } from "vitest";
import { hexToRgbTriplet, normalizeDeg, textScale } from "@/components/duel/table/seat-angle";

describe("seat angle rules", () => {
  it("normalizes angles to -180..180", () => {
    expect(normalizeDeg(202)).toBe(-158);
    expect(normalizeDeg(-190)).toBe(170);
    expect(normalizeDeg(360)).toBe(0);
    expect(normalizeDeg(180)).toBe(-180);
  });

  it("grows text on small fields and caps it", () => {
    expect(textScale(1)).toBe(1);
    expect(textScale(0.66)).toBeCloseTo(1.3636, 3);
    expect(textScale(0.2)).toBe(2.3);
    expect(textScale(0)).toBe(1);
  });

  it("converts a hex colour to an rgb triplet", () => {
    expect(hexToRgbTriplet("#9b7eff")).toBe("155 126 255");
    expect(hexToRgbTriplet("#fff")).toBe("255 255 255");
  });
});
