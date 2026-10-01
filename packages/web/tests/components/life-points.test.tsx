// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";

vi.mock("next/font/google", () => {
  // ./fonts loads every duel family; the LP digits use Oxanium.
  const font = () => ({ className: "font", variable: "font-var", style: {} });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});

import { formatLp } from "@/components/duel/constants";
import {
  LifePoints,
  describeChange,
  formatGlyphs,
  hiddenLeading,
  type FrameColumn,
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
      expect(total).toBeGreaterThanOrEqual(600);
      expect(total).toBeLessThanOrEqual(900);
    }
  });

  it("scales duration and spin count with the size of the hit", () => {
    expect(rollDurationMs(1)).toBeLessThan(rollDurationMs(800));
    expect(rollDurationMs(800)).toBeLessThan(rollDurationMs(8000));
    expect(rollDurationMs(1_000_000)).toBe(900);
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

/* ---------- no padded zeros while a number rolls (3,100 -> 0 once showed "000") ---------- */

/** What the plate reads at `t` ms into a roll: the same plan, reel maths and blanking the component uses. */
function frameAt(from: number, to: number, t: number): string {
  const fromDigits = new Map(formatGlyphs(from).flatMap((g) => (g.kind === "digit" ? [[g.key, g.digit] as const] : [])));
  const toDigits = new Map(formatGlyphs(to).flatMap((g) => (g.kind === "digit" ? [[g.key, g.digit] as const] : [])));
  const glyphs = mergeGlyphs(formatGlyphs(from), formatGlyphs(to));
  const columns = glyphs.flatMap((g) =>
    g.kind === "digit" ? [{ key: g.key, pos: fromDigits.get(g.key) ?? g.digit, target: toDigits.get(g.key) ?? 0 }] : [],
  );
  const { reels } = planReels(columns, to >= from ? 1 : -1, Math.abs(to - from));
  const frameColumns = glyphs.flatMap((g): FrameColumn[] => {
    if (g.kind === "comma") return [{ key: g.key, kind: "comma", digit: 0 }];
    if (g.kind !== "digit") return [];
    const column = columns.find((c) => c.key === g.key)!;
    const reel = reels.find((r) => r.key === g.key);
    const over = reel != null && t < reel.duration;
    const pos = reel && over ? reel.from + Math.sign(reel.travel) * reelDistance(t / reel.duration, Math.abs(reel.travel)) : column.target;
    return [
      {
        key: g.key,
        kind: "digit",
        digit: Math.round(((pos % 10) + 10) % 10) % 10,
      },
    ];
  });
  const hidden = hiddenLeading(frameColumns);
  let text = "";
  for (const g of glyphs) {
    if (g.kind === "sign") text += "−";
    else if (hidden.has(g.key)) continue;
    else if (g.kind === "comma") text += ",";
    else if (g.kind === "digit") text += String(frameColumns.find((c) => c.key === g.key)?.digit);
  }
  return text;
}

const NORMAL_INT = /^(−)?(0|[1-9]\d{0,2}(,\d{3})*)$/;

describe("life points never show padded zeros", () => {
  const cases: Array<[number, number]> = [
    [3100, 0],
    [8000, 0],
    [10000, 999],
    [10000, 9000],
    [1000, 950],
    [1000, 0],
    [0, 3100],
    [900, 1200],
    [999, 10000],
    [950, 1000],
  ];

  it.each(cases)("%i -> %i: every frame is a normal integer and the last one is exact", (from, to) => {
    const total = Math.max(...planReels([{ key: "d9", pos: 0, target: 1 }], 1, Math.abs(to - from)).reels.map((r) => r.duration), 1000);
    for (let t = 0; t <= total + 200; t += 8) {
      // No "000", "00", "0,000", "080": a leading 0 only ever shows as the whole number "0".
      expect(frameAt(from, to, t), `${from} -> ${to} at ${t} ms`).toMatch(NORMAL_INT);
    }
    expect(frameAt(from, to, total + 200)).toBe(formatLp(to));
  });

  it("3,100 -> 0 counts straight down to a single 0 (the old plate showed 000 first)", () => {
    const texts = new Set<string>();
    for (let t = 0; t <= 1200; t += 4) texts.add(frameAt(3100, 0, t));
    expect(texts.has("000")).toBe(false);
    expect(texts.has("00")).toBe(false);
    expect(frameAt(3100, 0, 0)).toBe("3,100");
    expect(frameAt(3100, 0, 1200)).toBe("0");
  });

  it("blanks leading zeros, never the units column", () => {
    const col = (key: string, digit: number) => ({ key, kind: "digit" as const, digit });
    const comma = { key: "c0", kind: "comma" as const, digit: 0 };
    expect([...hiddenLeading([col("d3", 0), comma, col("d2", 0), col("d1", 0), col("d0", 0)])].sort()).toEqual([
      "c0",
      "d1",
      "d2",
      "d3",
    ]);
    expect(hiddenLeading([col("d1", 0), col("d0", 0)]).has("d0")).toBe(false);
    // A zero inside the number stays.
    expect(hiddenLeading([col("d2", 1), col("d1", 0), col("d0", 0)]).size).toBe(0);
  });
});

describe("LifePoints roll in the DOM", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  /** Digits the plate shows right now: columns that are not blank, read off the strip positions. */
  function shownText(container: HTMLElement): string {
    const roll = container.querySelector("[aria-hidden='true']")!;
    let text = "";
    for (const el of Array.from(roll.querySelectorAll<HTMLElement>("[data-place], [data-comma]"))) {
      if (el.dataset.comma != null) {
        if (el.style.visibility !== "hidden") text += ",";
        continue;
      }
      if (el.parentElement?.style.visibility === "hidden") continue;
      const em = Number(/-([\d.]+)em/.exec(el.style.transform)?.[1] ?? 0);
      text += String(Math.round(em - 10) % 10);
    }
    return text;
  }

  it("3,100 -> 0 never shows 000 and lands on a single 0", () => {
    vi.useFakeTimers();
    const { container, rerender } = render(<LifePoints value={3100} reducedMotion={false} />);
    expect(shownText(container)).toBe("3,100");
    rerender(<LifePoints value={0} reducedMotion={false} />);
    const seen: string[] = [shownText(container)];
    for (let i = 0; i < 80; i++) {
      act(() => {
        vi.advanceTimersByTime(16);
      });
      seen.push(shownText(container));
    }
    act(() => {
      vi.advanceTimersByTime(500);
    });
    seen.push(shownText(container));
    expect(seen.filter((text) => /^[0,]{2,}$/.test(text))).toEqual([]);
    expect(shownText(container)).toBe("0");
    expect(container.querySelector("[aria-live]")).toHaveTextContent("0");
  });
});
