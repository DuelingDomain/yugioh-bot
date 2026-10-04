import { describe, expect, it } from "vitest";
import {
  PREVIEW_DELAY_MS,
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

  it("grows up out of the card: centred on it, bottom edge on the card's bottom edge", () => {
    const p = placePreview(card, stage, w);
    expect(p.width).toBe(w);
    expect(p.height).toBe(h);
    expect(p.left + p.width / 2).toBe(card.left + card.width / 2);
    expect(p.top + p.height).toBe(card.top + card.height);
    expect(p.originX).toBeCloseTo(50);
    expect(p.originY).toBeCloseTo(100);
  });

  it("clamps to the stage sides", () => {
    const left = placePreview({ ...card, left: 4 }, stage, w);
    expect(left.left).toBe(PREVIEW_MARGIN);
    expect(left.originX).toBeLessThan(50);
    const right = placePreview({ ...card, left: 700 }, stage, w);
    expect(right.left + right.width).toBe(stage.width - PREVIEW_MARGIN);
    expect(right.originX).toBeGreaterThan(50);
  });

  it("pushes down to the top margin when a top-row card has no room above", () => {
    const p = placePreview({ left: 350, top: 100, width: 100, height: 140 }, stage, w);
    expect(p.top).toBe(PREVIEW_MARGIN);
    expect(p.height).toBe(h);
    // the card is now inside the box, so the scale-in grows from where it sits
    expect(p.originY).toBeCloseTo(((240 - PREVIEW_MARGIN) / h) * 100);
    expect(p.originY).toBeLessThan(100);
  });

  it("keeps the bottom margin for a card low in the stage", () => {
    const p = placePreview({ left: 350, top: 760, width: 100, height: 140 }, stage, w);
    expect(p.top + p.height).toBe(stage.height - PREVIEW_MARGIN);
  });

  it("always fits inside the stage when the width comes from previewWidth", () => {
    for (const s of [{ width: 792, height: 842 }, { width: 1232, height: 1022 }, { width: 700, height: 420 }]) {
      const pw = previewWidth(s);
      for (const top of [0, s.height / 2, s.height - 140]) {
        const p = placePreview({ left: 0, top, width: 90, height: 130 }, s, pw);
        expect(p.left).toBeGreaterThanOrEqual(PREVIEW_MARGIN);
        expect(p.top).toBeGreaterThanOrEqual(PREVIEW_MARGIN);
        expect(p.left + p.width).toBeLessThanOrEqual(s.width - PREVIEW_MARGIN);
        expect(p.top + p.height).toBeLessThanOrEqual(s.height - PREVIEW_MARGIN + 1);
      }
    }
  });
});
