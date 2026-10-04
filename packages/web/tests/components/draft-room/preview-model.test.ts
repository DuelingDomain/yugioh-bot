import { describe, expect, it } from "vitest";
import {
  PREVIEW_DELAY_MS,
  PREVIEW_GAP,
  PREVIEW_GRACE_MS,
  PREVIEW_MARGIN,
  placePreview,
  previewDelay,
  previewWidth,
} from "../../../src/components/draft/room/preview-model";

describe("previewDelay", () => {
  it("waits about 120ms the first time", () => {
    expect(PREVIEW_DELAY_MS).toBe(120);
    expect(previewDelay({ visible: false, hiddenAt: null, now: 5000 })).toBe(120);
  });
  it("shows at once when a preview is already up", () => {
    expect(previewDelay({ visible: true, hiddenAt: null, now: 5000 })).toBe(0);
  });
  it("shows at once when moving to the next card just after leaving one", () => {
    expect(previewDelay({ visible: false, hiddenAt: 5000, now: 5000 + PREVIEW_GRACE_MS })).toBe(0);
    expect(previewDelay({ visible: false, hiddenAt: 5000, now: 5003 })).toBe(0);
  });
  it("waits again after the pointer has been away a while", () => {
    expect(previewDelay({ visible: false, hiddenAt: 5000, now: 5000 + PREVIEW_GRACE_MS + 1 })).toBe(120);
  });
});

describe("previewWidth", () => {
  it("is about 300px on a 1440 x 900 window", () => {
    const w = previewWidth({ width: 792, height: 842 });
    expect(w).toBeGreaterThanOrEqual(290);
    expect(w).toBeLessThanOrEqual(315);
  });
  it("grows on a bigger stage and is capped", () => {
    expect(previewWidth({ width: 1232, height: 1022 })).toBeGreaterThan(previewWidth({ width: 792, height: 842 }));
    expect(previewWidth({ width: 1912, height: 1382 })).toBe(460);
    expect(previewWidth({ width: 3000, height: 3000 })).toBe(460);
  });
  it("shrinks to fit a short or narrow stage", () => {
    const w = previewWidth({ width: 700, height: 420 });
    expect(Math.round(w * (86 / 59))).toBeLessThanOrEqual(420 - PREVIEW_MARGIN * 2);
    expect(previewWidth({ width: 200, height: 900 })).toBeLessThanOrEqual(200 - PREVIEW_MARGIN * 2);
  });
});

describe("placePreview", () => {
  const stage = { width: 800, height: 840 };
  const w = 300;
  const h = Math.round(300 * (86 / 59));
  const card = { left: 350, top: 600, width: 100, height: 140 };

  it("sits just above the card, centred on it", () => {
    const p = placePreview(card, stage, w);
    expect(p.side).toBe("above");
    expect(p.width).toBe(w);
    expect(p.height).toBe(h);
    expect(p.top + p.height).toBe(card.top - PREVIEW_GAP);
    expect(p.left + p.width / 2).toBe(card.left + card.width / 2);
  });

  it("clamps to the stage edges", () => {
    const left = placePreview({ ...card, left: 4 }, stage, w);
    expect(left.left).toBe(PREVIEW_MARGIN);
    const right = placePreview({ ...card, left: 700 }, stage, w);
    expect(right.left + right.width).toBe(stage.width - PREVIEW_MARGIN);
  });

  it("stays above, a little smaller, when the full size is just too tall", () => {
    // 400px of room above holds 0.92 of the 437px preview
    const p = placePreview({ ...card, top: 426 }, stage, w);
    expect(p.side).toBe("above");
    expect(p.height).toBeLessThan(h);
    expect(p.height).toBeGreaterThanOrEqual(Math.floor(h * 0.75));
    expect(p.top).toBeGreaterThanOrEqual(PREVIEW_MARGIN);
    expect(p.top + p.height).toBe(426 - PREVIEW_GAP);
  });

  it("flips below when there is no room above", () => {
    const p = placePreview({ left: 350, top: 100, width: 100, height: 140 }, { width: 800, height: 840 }, w);
    expect(p.side).toBe("below");
    expect(p.top).toBe(100 + 140 + PREVIEW_GAP);
    expect(p.top + p.height).toBeLessThanOrEqual(840 - PREVIEW_MARGIN);
  });

  it("goes to the side when neither above nor below holds it", () => {
    const short = { width: 900, height: 520 };
    const p = placePreview({ left: 100, top: 200, width: 100, height: 140 }, short, 220);
    expect(p.side).toBe("right");
    expect(p.left).toBe(100 + 100 + PREVIEW_GAP);
    expect(p.top).toBeGreaterThanOrEqual(PREVIEW_MARGIN);
    expect(p.top + p.height).toBeLessThanOrEqual(short.height - PREVIEW_MARGIN);
    const l = placePreview({ left: 700, top: 200, width: 100, height: 140 }, short, 220);
    expect(l.side).toBe("left");
    expect(l.left + l.width).toBe(700 - PREVIEW_GAP);
  });

  it("scales down when no side holds the full size, and never covers the card", () => {
    const tiny = { width: 400, height: 460 };
    const c = { left: 150, top: 160, width: 90, height: 130 };
    const p = placePreview(c, tiny, 300);
    expect(p.width).toBeLessThan(300);
    expect(p.width).toBeGreaterThan(0);
    const overlapX = p.left < c.left + c.width && p.left + p.width > c.left;
    const overlapY = p.top < c.top + c.height && p.top + p.height > c.top;
    expect(overlapX && overlapY).toBe(false);
    expect(p.left).toBeGreaterThanOrEqual(PREVIEW_MARGIN - 0.5);
    expect(p.top).toBeGreaterThanOrEqual(PREVIEW_MARGIN - 0.5);
  });
});
