import { describe, expect, it } from "vitest";
import { measureTable, packSlots } from "../../../src/components/draft/room/table-geometry";

const fits = (width: number, height: number, phone: boolean, narrowTheme = false) => {
  const g = measureTable({ width, height, phone, theme: narrowTheme, diskH: 112 });
  for (let n = 1; n <= 15; n++) {
    const slots = packSlots(g, n, narrowTheme);
    for (const s of slots) {
      expect(s.x).toBeGreaterThanOrEqual(g.pad - 0.5);
      expect(s.x + s.w).toBeLessThanOrEqual(g.tw - g.pad + 0.5);
    }
  }
};

describe("pack layout stays inside the mat", () => {
  it.each([[390, 780], [375, 700], [390, 1100], [360, 640]])("phone %i x %i", (w, h) => fits(w, h, true));
  it.each([[1024, 700], [1440, 900], [900, 700]])("desktop %i x %i", (w, h) => fits(w, h, false));
  it("does not change a four card desktop pack", () => {
    const g = measureTable({ width: 1440, height: 900, phone: false, theme: false, diskH: 112 });
    expect(packSlots(g, 4, false)[0].w).toBeCloseTo(g.cw * 1.5);
  });
});
