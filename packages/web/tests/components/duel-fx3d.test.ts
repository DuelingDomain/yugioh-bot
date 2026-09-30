// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { artWindowOnCard, parseRgbTriplet, pixelRatioFor, portraitTarget, rectToWorld, toWorldY } from "../../src/components/duel/fx3d/coords";
import { pickSummonRoute, summon3dKeyOf, summonEffectId } from "../../src/components/duel/fx3d/routing";
import { embodimentAt, shakeScaleOf, SUMMON3D_TIMELINE, summon3dHitMs, summon3dLockMs, type Summon3dKey } from "../../src/components/duel/fx3d/timeline";
import { resetWebglVerdict, webglSupported } from "../../src/components/duel/fx3d/loader";
import { slamHitMs } from "../../src/components/duel/summon-fx";

const KEYS = Object.keys(SUMMON3D_TIMELINE) as Summon3dKey[];

describe("fx3d coordinates", () => {
  it("flips y so the origin is bottom-left", () => {
    expect(toWorldY(0, 800)).toBe(800);
    expect(rectToWorld({ x: 100, y: 200, w: 60, h: 80 }, { w: 1000, h: 800 })).toEqual({ cx: 130, cy: 560, w: 60, h: 80 });
  });

  it("puts the art window inside the card", () => {
    const card = { x: 10, y: 20, w: 100, h: 146 };
    const art = artWindowOnCard(card);
    expect(art.cx).toBeGreaterThan(card.x);
    expect(art.cx).toBeLessThan(card.x + card.w);
    expect(art.size).toBeLessThanOrEqual(card.w);
  });

  it("keeps the portrait fully inside the viewport", () => {
    const vp = { w: 900, h: 700 };
    for (const card of [{ x: 0, y: 0, w: 80, h: 116 }, { x: 820, y: 640, w: 80, h: 116 }, { x: 400, y: 300, w: 80, h: 116 }]) {
      const p = portraitTarget(card, vp);
      expect(p.cx - p.size / 2).toBeGreaterThanOrEqual(0);
      expect(p.cx + p.size / 2).toBeLessThanOrEqual(vp.w);
      expect(p.cy - p.size / 2).toBeGreaterThanOrEqual(0);
      expect(p.cy + p.size / 2).toBeLessThanOrEqual(vp.h);
    }
  });

  it("caps and scales the pixel ratio, never below 1", () => {
    expect(pixelRatioFor(3, 2)).toBe(2);
    expect(pixelRatioFor(2, 2, 0.5)).toBe(1);
    expect(pixelRatioFor(Number.NaN, 2)).toBe(1);
  });

  it("parses rgb triplets", () => {
    expect(parseRgbTriplet("255 0 51")).toEqual([1, 0, 0.2]);
    expect(parseRgbTriplet("bad")).toEqual([1, 1, 1]);
  });
});

describe("fx3d timeline", () => {
  it.each(KEYS)("%s: hold is 500-700 ms and total is 1.3-1.8 s", (key) => {
    const tl = SUMMON3D_TIMELINE[key];
    const hold = tl.holdEnd - tl.rise1;
    expect(hold).toBeGreaterThanOrEqual(500);
    expect(hold).toBeLessThanOrEqual(700);
    expect(tl.total).toBeGreaterThanOrEqual(1300);
    expect(tl.total).toBeLessThanOrEqual(1800);
    expect(tl.handOver).toBeLessThan(tl.total);
    expect(summon3dHitMs(key)).toBe(tl.handOver);
    expect(summon3dLockMs(key)).toBeGreaterThan(tl.handOver);
  });

  it("walks the embodiment stages in order", () => {
    const tl = SUMMON3D_TIMELINE.fusion;
    expect(embodimentAt(tl, 0).stage).toBe("before");
    expect(embodimentAt(tl, (tl.rise0 + tl.rise1) / 2).stage).toBe("rise");
    expect(embodimentAt(tl, tl.rise1 + 10)).toEqual({ stage: "hold", grow: 1 });
    expect(embodimentAt(tl, (tl.holdEnd + tl.handOver) / 2).stage).toBe("shrink");
    expect(embodimentAt(tl, tl.handOver)).toEqual({ stage: "landed", grow: 0 });
  });

  it("maps the shake preference", () => {
    expect(shakeScaleOf("off")).toBe(0);
    expect(shakeScaleOf("low")).toBeLessThan(shakeScaleOf("default" as never));
    expect(shakeScaleOf("high")).toBeGreaterThan(1);
  });

  it("slamHitMs uses the 3D hand-over when 3D draws the summon", () => {
    expect(slamHitMs("heavy", null, "heavy")).toBe(SUMMON3D_TIMELINE.heavy.handOver);
    expect(slamHitMs("typed", "xyz", "xyz")).toBe(SUMMON3D_TIMELINE.xyz.handOver);
  });
});

describe("fx3d routing", () => {
  it("uses 3D only for big summons when ready and motion is allowed", () => {
    expect(pickSummonRoute({ kind: "heavy", reduced: false, ready: true })).toBe("three");
    expect(pickSummonRoute({ kind: "typed", reduced: false, ready: true })).toBe("three");
    expect(pickSummonRoute({ kind: "light", reduced: false, ready: true })).toBe("dom");
    expect(pickSummonRoute({ kind: "set", reduced: false, ready: true })).toBe("dom");
  });

  it("falls back to the DOM for reduced motion and a canvas that is not ready", () => {
    expect(pickSummonRoute({ kind: "heavy", reduced: true, ready: true })).toBe("dom");
    expect(pickSummonRoute({ kind: "typed", reduced: false, ready: false })).toBe("dom");
  });

  it("names the effect of a summon", () => {
    expect(summon3dKeyOf("heavy", null)).toBe("heavy");
    expect(summon3dKeyOf("heavy", "fusion")).toBe("fusion");
    expect(summon3dKeyOf("typed", null)).toBeNull();
    expect(summon3dKeyOf("light", null)).toBeNull();
    expect(summonEffectId("link")).toBe("summon:link");
  });
});

describe("webgl detection", () => {
  afterEach(() => {
    resetWebglVerdict();
    vi.restoreAllMocks();
  });

  it("is false when no context can be made", () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    expect(webglSupported()).toBe(false);
  });

  it("is false when context creation throws", () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => {
      throw new Error("no gl");
    });
    expect(webglSupported()).toBe(false);
  });

  it("is true with a context, and caches the answer", () => {
    const spy = vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ getExtension: () => null } as never);
    expect(webglSupported()).toBe(true);
    expect(webglSupported()).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
