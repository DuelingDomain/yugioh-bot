import { describe, expect, it } from "vitest";
import {
  groupTop,
  measureTable,
  TOP_CLEAR,
  TRAY_GAP,
} from "../../../src/components/draft/room/table-geometry";

const desk = (width: number, height: number, extra: Partial<Parameters<typeof measureTable>[0]> = {}) =>
  measureTable({ width, height, phone: false, theme: false, diskH: 112, ...extra });

/** Empty space above the far seat labels and below the tray once the group has been lifted. */
const gaps = (height: number, g: ReturnType<typeof desk>) => ({
  above: groupTop({ height, th: g.th, tilt: g.tilt, diskH: 112 }) - g.lift,
  below: TRAY_GAP + g.lift,
});

describe("the table group sits centred in the stage", () => {
  it.each([
    [1232, 1022, "1920 x 1080"],
    [1256, 1127, "the owner's wide window"],
    [1912, 1382, "2560 x 1440"],
    [1232, 1142, "1920 x 1200"],
    [1440, 900, "a 1440 x 900 stage"],
    [996, 742, "1280 x 800"],
  ])("evens the space above and below at %i x %i (%s)", (width, height) => {
    const g = desk(width, height);
    const { above, below } = gaps(height, g);
    expect(g.lift).toBeGreaterThan(0);
    expect(Math.abs(above - below)).toBeLessThanOrEqual(1.5);
    // the seat labels stay clear of the status pill
    expect(above).toBeGreaterThanOrEqual(TOP_CLEAR);
  });

  it("reads the owner's screenshot: the far seat labels began about 440px down a 1127px stage", () => {
    const g = desk(1256, 1127);
    const top = groupTop({ height: 1127, th: g.th, tilt: g.tilt, diskH: 112 });
    expect(top).toBeGreaterThan(425);
    expect(top).toBeLessThan(465);
    // about 220px of empty space above and below once centred
    expect(g.lift).toBeGreaterThan(200);
    expect(g.lift).toBeLessThan(235);
  });

  it("does not lift a window with no spare height", () => {
    expect(desk(740, 560).lift).toBe(0);
  });

  it("never lifts the phone layout or the flat scrolling table", () => {
    expect(measureTable({ width: 390, height: 734, phone: true, theme: false, diskH: 84 }).lift).toBe(0);
    const flat = desk(1440, 900, { packSize: 60 });
    expect(flat.tall).toBe(true);
    expect(flat.lift).toBe(0);
  });

  it("lifts theme mode by the same rule", () => {
    const g = desk(1232, 1022, { theme: true });
    const { above, below } = gaps(1022, g);
    expect(Math.abs(above - below)).toBeLessThanOrEqual(1.5);
  });

  it("never lifts the group closer to the top than it already was or than the status pill allows", () => {
    for (const packSize of [10, 20, 30]) {
      const g = desk(1232, 1022, { theme: true, packSize });
      const before = groupTop({ height: 1022, th: g.th, tilt: g.tilt, diskH: 112 });
      const { above, below } = gaps(1022, g);
      expect(above).toBeGreaterThanOrEqual(Math.min(TOP_CLEAR, before) - 1);
      expect(below).toBeGreaterThanOrEqual(TRAY_GAP);
    }
  });
});

describe("the table grows into spare height", () => {
  it("keeps the old size up to 900px of stage height", () => {
    for (const height of [600, 742, 842, 900]) {
      expect(desk(1440, height).tw).toBe(980);
    }
  });

  it("grows with the stage height, held by the width the seats need", () => {
    expect(desk(1232, 1022).tw).toBeCloseTo(1012); // 1920 x 1080: width - 220 binds
    expect(desk(1912, 1100).tw).toBeCloseTo(980 * 1.25); // growth is proportional between 900 and 1140
    expect(desk(1912, 1382).tw).toBeCloseTo(980 * 1.3); // 2560 x 1440: the 30% cap binds
    expect(desk(1912, 1700).tw).toBeCloseTo(980 * 1.3);
  });

  it("makes the cards larger and keeps their ratio", () => {
    const base = desk(1912, 900);
    const big = desk(1912, 1382);
    expect(big.cw).toBeGreaterThan(base.cw);
    expect(big.ch / big.cw).toBeCloseTo(86 / 59);
    expect(big.tilt).toBe(40);
    expect(big.tall).toBe(false);
  });

  it("leaves narrow stages (under 820 wide) and the phone as they were", () => {
    const narrow = desk(792, 1100);
    const narrowShort = desk(792, 842);
    expect(narrow.tw).toBe(narrowShort.tw);
    expect(narrow.cols).toBe(5);
    expect(narrow.rows).toBe(3);
    const phoneTall = measureTable({ width: 390, height: 1100, phone: true, theme: false, diskH: 84 });
    const phoneShort = measureTable({ width: 390, height: 734, phone: true, theme: false, diskH: 84 });
    expect(phoneTall.tw).toBe(phoneShort.tw);
    expect(phoneTall.cols).toBe(4);
  });

  it("still fits the table in the height it is given", () => {
    for (const [w, h] of [[1912, 1382], [1232, 1022], [1912, 1142]] as const) {
      const g = desk(w, h);
      expect(g.th * 0.8 + 150).toBeLessThanOrEqual(h);
    }
  });
});
