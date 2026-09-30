import { describe, expect, it } from "vitest";
import { HEAVY_TIMELINE, impactLifeMs, joltFalloff, slamHitMs, SHAKE_AMPLITUDE_PX, TYPED_TIMELINE } from "../../src/components/duel/summon-fx";

describe("slam timing", () => {
  it("hits when the heavy hologram lands and when a typed card takes over", () => {
    expect(slamHitMs("heavy", null)).toBe(HEAVY_TIMELINE.impact);
    expect(slamHitMs("heavy", "fusion")).toBe(HEAVY_TIMELINE.impact);
    expect(slamHitMs("typed", "xyz")).toBe(TYPED_TIMELINE.xyz.handOver - 60);
    expect(slamHitMs("typed", null)).toBe(0);
  });

  it("keeps the whole slam under about 1.7 s for every summon type", () => {
    const hits = [slamHitMs("heavy", null), ...(Object.keys(TYPED_TIMELINE) as Array<keyof typeof TYPED_TIMELINE>).map((s) => slamHitMs("typed", s))];
    for (const hit of hits) {
      expect(impactLifeMs(hit)).toBeGreaterThanOrEqual(600);
      expect(hit + impactLifeMs(hit)).toBeLessThanOrEqual(1700);
    }
    expect(HEAVY_TIMELINE.impact + impactLifeMs(HEAVY_TIMELINE.impact)).toBeLessThanOrEqual(HEAVY_TIMELINE.total);
  });
});

describe("joltFalloff", () => {
  it("jolts adjacent zones most and far zones not at all", () => {
    const adjacent = joltFalloff(1.2);
    expect(adjacent).toBeGreaterThan(0.4);
    expect(joltFalloff(2.4)).toBeLessThan(adjacent);
    expect(joltFalloff(3.6)).toBeLessThan(joltFalloff(2.4));
    expect(joltFalloff(8)).toBe(0);
  });
  it("is silent when shake is off", () => {
    expect(SHAKE_AMPLITUDE_PX.off).toBe(0);
  });
});
