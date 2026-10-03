// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { installTimeShim } from "@/components/duel/fx-lab/time-shim";
import { duelFxClock } from "@/components/duel/fx-clock";

afterEach(() => { duelFxClock.setReviewSpeed(null); duelFxClock.resetReviewTimeline(); vi.restoreAllMocks(); });
it("uses the shared presentation clock for review without patching browser or decision clocks", () => {
  const originals = [window.setTimeout, window.setInterval, window.requestAnimationFrame, Date.now, performance.now, Element.prototype.animate];
  const shim = installTimeShim();
  try {
    shim.setFactor(0.25);
    expect(shim.factor()).toBe(0.25);
    expect(duelFxClock.realMs(1000)).toBe(4000);
    expect([window.setTimeout, window.setInterval, window.requestAnimationFrame, Date.now, performance.now, Element.prototype.animate]).toEqual(originals);
  } finally { shim.uninstall(); }
});
