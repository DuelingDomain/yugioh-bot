import { describe, expect, it } from "vitest";
import { anchorFor, measureTable, packSlots, themeStackPoint } from "../../../src/components/draft/room/table-geometry";

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

const stages = [
  { width: 1440, height: 900, phone: false, diskH: 112, floor: 64, rows: 8, tilt: 12 },
  { width: 390, height: 844, phone: true, diskH: 84, floor: 60, rows: 15, tilt: 8 },
];

describe("pack capacity", () => {
  it.each(stages)("keeps standard packs in place at $width x $height", (stage) => {
    const opts = { ...stage, theme: false };
    const original = measureTable(opts);
    expect(original.tall).toBe(false);
    expect(original.tw).toBe(stage.phone ? 366 : 980);
    expect(original.cw).toBe(stage.phone ? 78.5 : 106.25);
    expect(original.th).toBeCloseTo(stage.phone ? 569.694915 : 465.745763);
    for (const packSize of [5, 8, 15]) {
      const g = measureTable({ ...opts, packSize });
      expect(g).toEqual(original);
      expect(packSlots(g, packSize, false)).toEqual(packSlots(original, packSize, false));
    }
  });

  it.each(stages.flatMap((stage) => [false, true].map((theme) => ({ ...stage, theme }))))(
    "fits all 60 cards at $width x $height with theme $theme",
    (stage) => {
      const g = measureTable({ ...stage, packSize: 60 });
      expect(g.rows).toBe(stage.rows);
      expect(g.tall).toBe(true);
      expect(g.tilt).toBe(stage.tilt);
      expect(g.cw).toBeGreaterThanOrEqual(stage.floor);
      const zoneEnd = g.top + g.rows * g.ch + (g.rows - 1) * g.gap;
      const slots = packSlots(g, 60, stage.theme);
      expect(slots).toHaveLength(60);
      for (const s of slots) {
        expect(s.w).toBeGreaterThanOrEqual(stage.floor);
        expect(s.x).toBeGreaterThanOrEqual(0);
        expect(s.x + s.w).toBeLessThanOrEqual(g.tw);
        expect(s.y).toBeGreaterThanOrEqual(g.top);
        expect(s.y + s.h).toBeLessThanOrEqual(zoneEnd + 0.000001);
        expect(s.y + s.h).toBeLessThanOrEqual(g.th);
      }
      if (stage.theme) {
        const stack = themeStackPoint(g);
        expect(stack.y).toBeGreaterThanOrEqual(zoneEnd);
        expect(stack.y + stack.h).toBeLessThanOrEqual(g.th);
      }
    },
  );

  it("keeps the usual tilt when a larger pack can shrink without reaching the floor", () => {
    const g = measureTable({ width: 1440, height: 900, phone: false, theme: false, diskH: 112, packSize: 40 });
    expect(g.rows).toBe(5);
    expect(g.tall).toBe(false);
    expect(g.cw).toBeGreaterThan(64);
    expect(g.cw).toBeLessThan(106.25);
    expect(g.tilt).toBe(40);
  });

  it("expands the row budget in theme mode", () => {
    const opts = { width: 390, height: 844, phone: true, theme: true, diskH: 84 };
    expect(measureTable(opts).rows).toBe(2);
    expect(measureTable({ ...opts, packSize: 15 }).rows).toBe(4);
  });

  it.each(stages)("keeps theme packs that fit the base rows in place at $width x $height", (stage) => {
    const original = measureTable({ ...stage, theme: true });
    for (const packSize of stage.phone ? [5, 8] : [5, 8, 15]) {
      const g = measureTable({ ...stage, theme: true, packSize });
      expect(g).toEqual(original);
      expect(packSlots(g, packSize, true)).toEqual(packSlots(original, packSize, true));
    }
  });

  it("keeps large packs above the desktop width floor in a narrow, tall stage", () => {
    const g = measureTable({ width: 820, height: 1200, phone: false, theme: false, diskH: 112, packSize: 60 });
    expect(g.cw).toBeGreaterThanOrEqual(64);
    expect(g.tw).toBeLessThanOrEqual(820);
    expect(g.tall).toBe(false);
  });

  it("clamps an oversized block to the start of the card zone", () => {
    const g = measureTable({ width: 1440, height: 900, phone: false, theme: false, diskH: 112 });
    expect(packSlots({ ...g, rows: 1 }, 4, false)[0].y).toBe(g.top);
  });

  it("places anchors using the enlarged table dimensions", () => {
    const g = measureTable({ width: 1440, height: 900, phone: false, theme: false, diskH: 112, packSize: 60 });
    expect(anchorFor(g, 0, 12)).toEqual({ x: g.tw / 2, y: g.th + 30 });
    expect(anchorFor(g, 1, 12).y).toBeCloseTo(g.th * 0.78);
    expect(anchorFor(g, 4, 12)).toEqual({ x: g.tw * 0.1, y: -14 });
  });
});
