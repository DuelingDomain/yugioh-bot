import { describe, expect, it } from "vitest";
import { LEFT_TAB_ORDER, leftTabOffset } from "@/components/duel/tag/tag-drawers";

describe("the left edge tabs of the Tag Rooftop", () => {
  it("lists log, card, settings and camera, top to bottom", () => {
    expect(LEFT_TAB_ORDER).toEqual(["log", "card", "settings", "camera"]);
  });

  it("centres the first tab below the top bar, with the guess heights", () => {
    expect(leftTabOffset(0)).toBe("115px");
  });

  it("stacks each tab under the one above with a gap, using the measured heights", () => {
    const heights = [70, 80, 118, 100];
    expect(leftTabOffset(0, heights)).toBe("119px");
    expect(leftTabOffset(1, heights)).toBe(`${84 + 70 + 10 + 40}px`);
    expect(leftTabOffset(2, heights)).toBe(`${84 + 70 + 10 + 80 + 10 + 59}px`);
  });

  it("never lets two tabs overlap, whatever the heights", () => {
    const heights = [140, 90, 200, 60];
    const centres = heights.map((_, i) => parseInt(leftTabOffset(i, heights), 10));
    for (let i = 1; i < centres.length; i += 1) {
      const gap = centres[i] - heights[i] / 2 - (centres[i - 1] + heights[i - 1] / 2);
      expect(gap).toBeGreaterThanOrEqual(9);
    }
  });
});
