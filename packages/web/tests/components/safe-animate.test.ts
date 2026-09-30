import { describe, expect, it, vi } from "vitest";
import { safeAnimate, sanitizeKeyframes } from "../../src/components/duel/safe-animate";

describe("sanitizeKeyframes", () => {
  it("clamps negative and out-of-order offsets into [0, 1] ascending", () => {
    const out = sanitizeKeyframes([{ opacity: 1 }, { opacity: 1, offset: -0.2 }, { opacity: 0, offset: 0.5 }, { opacity: 0, offset: 0.3 }, { opacity: 0, offset: 1.4 }]);
    expect(out.map((f) => f.offset)).toEqual([undefined, 0, 0.5, 0.5, 1]);
  });

  it("drops offsets that are not finite and keeps valid frames untouched", () => {
    const valid = [{ opacity: 0 }, { opacity: 1, offset: 0.4 }, { opacity: 0 }];
    expect(sanitizeKeyframes(valid)).toBe(valid);
    expect(sanitizeKeyframes([{ opacity: 0, offset: Number.NaN }])[0]).not.toHaveProperty("offset");
  });
});

describe("safeAnimate", () => {
  it("returns null instead of throwing when the browser rejects the animation", () => {
    const el = { animate: vi.fn(() => { throw new TypeError("bad"); }) } as unknown as Element;
    expect(safeAnimate(el, [{ opacity: 0 }], { duration: 100 })).toBeNull();
  });

  it("passes sanitized frames and finite timing to animate", () => {
    const animate = vi.fn(() => ({}) as Animation);
    safeAnimate({ animate } as unknown as Element, [{ opacity: 0, offset: -1 }, { opacity: 1 }], { duration: Number.NaN, delay: Number.POSITIVE_INFINITY });
    expect(animate).toHaveBeenCalledWith([{ opacity: 0, offset: 0 }, { opacity: 1 }], { duration: 0, delay: 0 });
  });
});
