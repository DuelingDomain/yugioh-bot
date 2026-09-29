// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/font/google", () => {
  // ./fonts loads every duel family; the LP digits use Oxanium.
  const font = () => ({ className: "font", variable: "font-var", style: {} });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});

import {
  LifePoints,
  describeChange,
  formatGlyphs,
  mergeGlyphs,
  planReels,
  reelDistance,
  rollDurationMs,
} from "@/components/duel/life-points";

function keys(glyphs: ReturnType<typeof formatGlyphs>) {
  return glyphs.map((glyph) => glyph.key).join(",");
}

describe("life points glyph planning", () => {
  it("formats digits and commas from the right", () => {
    expect(keys(formatGlyphs(8000))).toBe("d3,c0,d2,d1,d0");
    expect(keys(formatGlyphs(0))).toBe("d0");
    expect(keys(formatGlyphs(-200))).toBe("sign,d2,d1,d0");
    expect(keys(formatGlyphs(null))).toBe("dash");
    expect(keys(formatGlyphs(Number.NaN))).toBe("dash");
  });

  it("keeps the dropped column while 10000 rolls down to 9000", () => {
    const merged = mergeGlyphs(formatGlyphs(10000), formatGlyphs(9000));
    expect(keys(merged)).toBe("d4,d3,c0,d2,d1,d0");
  });

  it("adds a new leading column when the digit count grows", () => {
    const merged = mergeGlyphs(formatGlyphs(900), formatGlyphs(1200));
    expect(keys(merged)).toBe("d3,c0,d2,d1,d0");
    const lead = merged[0];
    expect(lead?.kind === "digit" ? lead.digit : -1).toBe(0);
  });
});

describe("life points reel plan", () => {
  const col = (key: string, pos: number, target: number) => ({ key, pos, target });

  it("only spins columns whose digit changes", () => {
    const { reels } = planReels([col("d3", 8, 7), col("d2", 0, 2), col("d1", 0, 0), col("d0", 0, 0)], -1, 800);
    expect(reels.map((reel) => reel.key)).toEqual(["d3", "d2"]);
  });

  it("scrolls down for a loss and up for a gain, with whole extra cycles", () => {
    const loss = planReels([col("d0", 8, 7)], -1, 1).reels[0];
    const gain = planReels([col("d0", 8, 7)], 1, 1).reels[0];
    expect(loss?.travel).toBeLessThan(0);
    expect(gain?.travel).toBeGreaterThan(0);
    // 8 -> 7 going down is one step, going up is nine steps, each plus full cycles.
    expect(Math.abs(loss?.travel ?? 0) % 10).toBeCloseTo(1, 5);
    expect(Math.abs(gain?.travel ?? 0) % 10).toBeCloseTo(9, 5);
    expect(Math.abs(loss?.travel ?? 0)).toBeGreaterThanOrEqual(11);
  });

  it("stops reels one after another, left to right, within 1.0-1.5 s", () => {
    const cols = [col("d3", 8, 4), col("d2", 0, 5), col("d1", 0, 1), col("d0", 0, 9)];
    for (const magnitude of [1, 800, 4000, 8000]) {
      const { reels, total } = planReels(cols, -1, magnitude);
      const durations = reels.map((reel) => reel.duration);
      expect([...durations].sort((a, b) => a - b)).toEqual(durations);
      expect(new Set(durations).size).toBe(durations.length);
      expect(total).toBe(durations[durations.length - 1]);
      expect(total).toBeGreaterThanOrEqual(1000);
      expect(total).toBeLessThanOrEqual(1500);
    }
  });

  it("scales duration and spin count with the size of the hit", () => {
    expect(rollDurationMs(1)).toBeLessThan(rollDurationMs(800));
    expect(rollDurationMs(800)).toBeLessThan(rollDurationMs(8000));
    expect(rollDurationMs(1_000_000)).toBe(1500);
    const cols = [col("d0", 0, 5)];
    const small = planReels(cols, 1, 5).reels[0];
    const big = planReels(cols, 1, 8000).reels[0];
    expect(Math.abs(big?.travel ?? 0)).toBeGreaterThan(Math.abs(small?.travel ?? 0));
  });

  it("returns no reels when every digit is already on target", () => {
    expect(planReels([col("d0", 4, 4)], 1, 0).reels).toEqual([]);
  });

  it("runs past the target, then lands exactly on it", () => {
    const travel = 23;
    expect(reelDistance(0, travel)).toBe(0);
    expect(reelDistance(1, travel)).toBe(travel);
    let peak = 0;
    let last = 0;
    for (let t = 0; t <= 1; t += 0.01) {
      const d = reelDistance(t, travel);
      peak = Math.max(peak, d);
      if (t < 0.83) expect(d).toBeGreaterThanOrEqual(last);
      last = d;
    }
    expect(peak).toBeGreaterThan(travel);
    expect(peak).toBeLessThan(travel + 0.2);
  });

  it("describes a change with typographic signs", () => {
    expect(describeChange(8000, 7200)).toEqual({ tone: "loss", text: "−800", was: "8,000" });
    expect(describeChange(4000, 4500)).toEqual({ tone: "gain", text: "+500", was: "4,000" });
    expect(describeChange(100, -300).was).toBe("100");
    expect(describeChange(-200, -100).was).toBe("−200");
  });
});

describe("LifePoints", () => {
  it("announces the LP in a polite live region and hides the reels from AT", () => {
    const { container, rerender } = render(<LifePoints value={8000} reducedMotion />);
    const live = container.querySelector("[aria-live]");
    expect(live).toHaveAttribute("aria-live", "polite");
    expect(live).toHaveTextContent("8,000");
    expect(container.querySelector("[aria-hidden='true']")).not.toBeNull();
    rerender(<LifePoints value={7200} reducedMotion />);
    expect(live).toHaveTextContent("7,200");
  });

  it("renders an em dash for a missing value", () => {
    const { container } = render(<LifePoints value={null} reducedMotion={false} />);
    expect(container.querySelector("[aria-live]")).toHaveTextContent("—");
  });

  it("snaps to the new value and writes the tally when motion is reduced", () => {
    const { container, rerender } = render(<LifePoints value={8000} reducedMotion />);
    expect(screen.queryByText("−800")).toBeNull();
    rerender(<LifePoints value={7200} reducedMotion />);
    expect(screen.getByText("−800")).toBeInTheDocument();
    expect(screen.getByText("8,000")).toBeInTheDocument();
    const thousands = container.querySelector<HTMLElement>("[data-place='d3']");
    expect(thousands?.style.transform).toContain("-17.000em");
    rerender(<LifePoints value={7700} reducedMotion />);
    expect(screen.getByText("+500")).toBeInTheDocument();
    expect(screen.getByText("7,200")).toBeInTheDocument();
  });

  it("can hide the tally", () => {
    const { rerender } = render(<LifePoints value={8000} reducedMotion showChange={false} />);
    rerender(<LifePoints value={7200} reducedMotion showChange={false} />);
    expect(screen.queryByText("−800")).toBeNull();
  });

  it("survives a roll being replaced mid-flight and unmount", () => {
    const { container, rerender, unmount } = render(<LifePoints value={10000} reducedMotion={false} />);
    rerender(<LifePoints value={9000} reducedMotion={false} />);
    rerender(<LifePoints value={9900} reducedMotion={false} />);
    expect(container.querySelector("[aria-live]")).toHaveTextContent("9,900");
    unmount();
  });
});
