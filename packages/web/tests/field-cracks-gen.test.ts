import { describe, expect, it } from "vitest";
import { genField, hashSeed, layoutKey, maskImageUrl, rectDist, toRefLayout, type CrackField, type FieldLayout, type Pt, type Rect } from "@/components/duel/field-cracks/gen";
import { crackStage, nextStage, STAGE_THRESHOLDS } from "@/components/duel/field-cracks/stage";

/* ---------- layouts that mirror the real fields (zone rects in the mat's own coordinates) */

/** The demo mat: 5 monster + 5 spell columns, 2 EMZ above, pile columns left and right. */
const DEMO: FieldLayout = (() => {
  const colC = [52, 151, 241, 326, 411, 501, 600];
  const rowC = [65, 190, 315];
  const zones: Rect[] = [];
  const add = (c: number, r: number) => zones.push([colC[c] - 38.4, rowC[r] - 56, colC[c] + 38.4, rowC[r] + 56]);
  [1, 2, 3, 4, 5].forEach((c) => { add(c, 1); add(c, 2); });
  add(2, 0); add(4, 0); add(0, 1); add(6, 1); add(0, 2); add(6, 2);
  return { w: 653, h: 380, zones };
})();

/** A grid of zones: columns x rows, with a gap, margins and optional extra zones. */
function grid(cols: number, rows: number, zw: number, zh: number, gap: number, margin: number, extra: Rect[] = []): FieldLayout {
  const zones: Rect[] = [...extra];
  for (let c = 0; c < cols; c++) for (let r = 0; r < rows; r++) zones.push([margin + c * (zw + gap), margin + r * (zh + gap), margin + c * (zw + gap) + zw, margin + r * (zh + gap) + zh]);
  return { w: margin * 2 + cols * zw + (cols - 1) * gap, h: margin * 2 + rows * zh + (rows - 1) * gap, zones };
}

/** 1v1: two 7-column halves (piles + 5 zones), an EMZ band in the middle (3 columns). */
const ONE_V_ONE: FieldLayout = (() => {
  const zw = 88; const zh = 112; const gap = 8; const m = 12;
  const zones: Rect[] = [];
  const rowsY = [m, m + (zh + gap), m + 2 * (zh + gap) + 20, m + 3 * (zh + gap) + 20, m + 4 * (zh + gap) + 20];
  rowsY.forEach((y, ri) => {
    for (let c = 0; c < 7; c++) {
      if (ri === 2 && (c === 0 || c === 6)) continue;
      zones.push([m + c * (zw + gap), y, m + c * (zw + gap) + zw, y + zh]);
    }
  });
  return { w: m * 2 + 7 * zw + 6 * gap, h: rowsY[4] + zh + m, zones };
})();

/** Domain extra zones: the shared EMZ band sits across two facing halves (Tag). */
const TAG: FieldLayout = grid(7, 4, 70, 98, 10, 10, [[10 + 2 * 80, 10 + 2 * 108 - 4, 10 + 2 * 80 + 70, 10 + 2 * 108 + 90]]);
/** Pendulum zones: the two outer spell/trap slots double as pendulum slots, drawn as taller zones on the outer columns of a third row. */
const PEND_BASE = grid(5, 2, 76, 108, 12, 14, [[14, 14 + 2 * 120, 14 + 76, 14 + 2 * 120 + 100], [14 + 4 * 88, 14 + 2 * 120, 14 + 4 * 88 + 76, 14 + 2 * 120 + 100]]);
const PEND: FieldLayout = { ...PEND_BASE, h: 14 + 3 * 120 + 14 };

/** The top half of the 1v1 mat as measured at 1920x1080: a full-width hand strip over five hand cards, rows of zones below. */
const ONE_V_ONE_TOP: FieldLayout = {
  w: 1072,
  h: 456,
  zones: [
    [472, 0, 535, 52], [538, 0, 601, 52], [605, 0, 668, 52], [671, 0, 734, 52], [738, 0, 801, 52], [22, 3, 1062, 60],
    [22, 63, 127, 215], [138, 63, 290, 215], [302, 63, 454, 215], [466, 63, 618, 215], [630, 63, 782, 215], [793, 63, 945, 215], [957, 63, 1062, 215],
    [22, 222, 127, 374], [138, 222, 290, 374], [302, 222, 454, 374], [466, 222, 618, 374], [630, 222, 782, 374], [793, 222, 945, 374], [957, 222, 1062, 374],
    [22, 380, 127, 456], [302, 380, 454, 456], [630, 380, 782, 456],
  ],
};

const LAYOUTS: Record<string, FieldLayout> = {
  "1v1 top half": ONE_V_ONE_TOP,
  demo: DEMO,
  "1v1": ONE_V_ONE,
  "ffa3 seat": grid(7, 3, 78, 110, 12, 16),
  "ffa4 seat": grid(7, 3, 64, 90, 9, 10),
  tag: TAG,
  pendulum: PEND,
  "domain dmz": grid(6, 3, 70, 96, 11, 12, [[260, 140, 330, 236]]),
  tight: grid(7, 3, 80, 110, 5, 6),
  wide: grid(9, 2, 70, 100, 14, 22),
};

/* ---------- geometry helpers (exact, independent of the generator) */

function parsePath(d: string): Pt[] {
  return d.replace(/^M/, "").split(/L/).map((p) => p.trim().split(/\s+/).map(Number) as unknown as Pt);
}
function segRectDist(a: Pt, b: Pt, z: Rect): number {
  const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.25));
  let d = Infinity;
  for (let k = 0; k <= n; k++) d = Math.min(d, rectDist(a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n, z));
  return d;
}
function pointInPoly(x: number, y: number, poly: readonly Pt[]): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}
/** Smallest distance between a closed polygon and a rect (0 when they overlap). */
function polyRectDist(poly: readonly Pt[], z: Rect): number {
  let d = Infinity;
  for (let i = 0; i < poly.length; i++) d = Math.min(d, segRectDist(poly[i], poly[(i + 1) % poly.length], z));
  for (const [x, y] of [[z[0], z[1]], [z[2], z[1]], [z[2], z[3]], [z[0], z[3]], [(z[0] + z[2]) / 2, (z[1] + z[3]) / 2]] as Pt[]) if (pointInPoly(x, y, poly)) return 0;
  return d;
}

function clearanceOf(field: CrackField, layout: FieldLayout): { cracks: number; chunks: number } {
  const ref = toRefLayout(layout);
  let cracks = Infinity;
  let chunks = Infinity;
  for (const seg of field.segs) {
    const pts = parsePath(seg.d);
    for (let i = 1; i < pts.length; i++) for (const z of ref.zones) cracks = Math.min(cracks, segRectDist(pts[i - 1], pts[i], z));
  }
  for (const c of field.chunks) for (const z of ref.zones) chunks = Math.min(chunks, polyRectDist(c.poly, z));
  return { cracks, chunks };
}

describe("field cracks generator", () => {
  it("is deterministic for a seed and layout, and differs between seeds", () => {
    const a = genField(1234, DEMO);
    const b = genField(1234, DEMO);
    expect(a).toEqual(b);
    expect(genField(1235, DEMO).segs.map((s) => s.d).join()).not.toEqual(a.segs.map((s) => s.d).join());
  });

  it("gives the same cracks when the field is only resized", () => {
    const scaled: FieldLayout = { w: DEMO.w * 1.7, h: DEMO.h * 1.7, zones: DEMO.zones.map((z) => z.map((n) => n * 1.7) as unknown as Rect) };
    expect(layoutKey(scaled)).toBe(layoutKey(DEMO));
    expect(genField(77, scaled)).toEqual(genField(77, DEMO));
  });

  it("builds 4 / 5 / 8 chunks at stages 1 / 2 / 3 on the demo mat", () => {
    for (const seed of [1, 2, 3, 4, 5, 99, 1000]) {
      const f = genField(seed, DEMO);
      const n = (s: number) => f.chunks.filter((c) => c.stage === s).length;
      expect([n(1), n(2), n(3)]).toEqual([4, 5, 8]);
      // The shatter at 0 LP is a few more bites, drawn after the others (so stages 1 to 3 stay as they were).
      expect(n(4)).toBeGreaterThanOrEqual(3);
      expect(n(4)).toBeLessThanOrEqual(6);
    }
  });

  it("still cracks a half mat whose hand strip spans the whole width", () => {
    for (const seed of [1, 5, 9, 33]) {
      const f = genField(seed, ONE_V_ONE_TOP, [true, true, false, true]);
      expect(f.segs.length).toBeGreaterThan(0);
      expect(f.chunks.length).toBeGreaterThan(0);
    }
  });

  it("never crumbles a closed side (a half of a shared mat keeps its inner edge)", () => {
    const ref = toRefLayout(DEMO);
    for (const seed of [1, 2, 3, 4, 5, 99, 1000]) {
      const f = genField(seed, DEMO, [true, true, false, true]);
      const n = (s: number) => f.chunks.filter((c) => c.stage === s).length;
      expect([n(1), n(2), n(3)]).toEqual([4, 5, 8]);
      for (const c of f.chunks) for (const [, y] of c.poly) expect(y).toBeLessThanOrEqual(ref.h + 0.01);
      expect(clearanceOf(f, DEMO).chunks).toBeGreaterThanOrEqual(1.5);
    }
  });

  for (const [name, layout] of Object.entries(LAYOUTS)) {
    it(`keeps every crack and chunk at least 1.5 px from a zone: ${name}`, () => {
      let worstCrack = Infinity;
      let worstChunk = Infinity;
      for (let seed = 1; seed <= 40; seed++) {
        const f = genField(seed * 2654435761 + 7, layout);
        const { cracks, chunks } = clearanceOf(f, layout);
        worstCrack = Math.min(worstCrack, cracks);
        worstChunk = Math.min(worstChunk, chunks);
      }
      expect(worstCrack).toBeGreaterThanOrEqual(1.5);
      expect(worstChunk).toBeGreaterThanOrEqual(1.5);
    }, 60_000);
  }

  it("holds for random layouts and random seeds", () => {
    let s = 20240611;
    const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
    for (let n = 0; n < 50; n++) {
      const cols = 3 + Math.floor(rnd() * 6);
      const rows = 2 + Math.floor(rnd() * 4);
      const layout = grid(cols, rows, 50 + rnd() * 50, 70 + rnd() * 50, 4 + rnd() * 16, 4 + rnd() * 24);
      const f = genField(Math.floor(rnd() * 1e9), layout);
      const { cracks, chunks } = clearanceOf(f, layout);
      expect(cracks).toBeGreaterThanOrEqual(1.5);
      expect(chunks).toBeGreaterThanOrEqual(1.5);
      expect(f.segs.length).toBeGreaterThan(0);
    }
  });

  it("draws the stage 4 connecting cracks only in free lanes", () => {
    const f = genField(5, DEMO);
    expect(f.segs.some((g) => g.stage === 4)).toBe(true);
    expect(f.segs.every((g) => g.t0 >= 0 && g.t1 <= 1 && g.t1 >= g.t0)).toBe(true);
  });

  it("never crashes on an empty or degenerate layout", () => {
    expect(genField(1, { w: 400, h: 200, zones: [] }).chunks.length).toBeGreaterThanOrEqual(0);
    expect(genField(1, { w: 100, h: 100, zones: [[0, 0, 100, 100]] }).segs).toEqual([]);
  });

  it("builds a mask only when a chunk is gone", () => {
    const f = genField(3, DEMO);
    expect(maskImageUrl(f, 0)).toBeUndefined();
    expect(maskImageUrl(f, 1)).toMatch(/^url\("data:image\/svg\+xml,/);
  });

  it("hashes seeds stably", () => {
    expect(hashSeed("abc-slug:0")).toBe(hashSeed("abc-slug:0"));
    expect(hashSeed("abc-slug:0")).not.toBe(hashSeed("abc-slug:1"));
  });
});

describe("crack stage", () => {
  it("steps at 50 / 25 / 10 percent of the starting LP and ends at 0", () => {
    expect(STAGE_THRESHOLDS).toEqual([0.5, 0.25, 0.1]);
    expect(crackStage(8000, 8000)).toBe(0);
    expect(crackStage(4001, 8000)).toBe(0);
    expect(crackStage(4000, 8000)).toBe(1);
    expect(crackStage(2001, 8000)).toBe(1);
    expect(crackStage(2000, 8000)).toBe(2);
    expect(crackStage(801, 8000)).toBe(2);
    expect(crackStage(800, 8000)).toBe(3);
    expect(crackStage(1, 8000)).toBe(3);
    expect(crackStage(0, 8000)).toBe(4);
    expect(crackStage(-300, 8000)).toBe(4);
  });
  it("scales for Tag team LP and ignores unknown values", () => {
    expect(crackStage(8000, 16000)).toBe(1);
    expect(crackStage(1600, 16000)).toBe(3);
    expect(crackStage(null, 8000)).toBe(0);
    expect(crackStage(4000, 0)).toBe(0);
  });
  it("keep mode never goes back; mend mode follows the LP", () => {
    expect(nextStage(3, 0, "keep")).toBe(3);
    expect(nextStage(1, 2, "keep")).toBe(2);
    expect(nextStage(3, 1, "mend")).toBe(1);
  });
});
