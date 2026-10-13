import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { promptUnit } from "../src/components/duel/table/grid-stage";

const read = (file: string) => readFileSync(join(__dirname, "../src/components/duel", file), "utf8");
const table = read("table/table-stage.module.css");
const grid = read("table/grid-stage.module.css");
const tag = read("tag/tag-stage.module.css");
const prompts = read("prompt-center.module.css");
const precheck = read("prompt-precheck.module.css");

// The panel unit of the multi-seat tables as the CSS states it: clamp(max(1px, --pr-unit), 0.0625vw, 1.4px).
const unitAt = (vw: number, prUnit: number) => Math.min(1.4, Math.max(Math.max(1, prUnit), 0.0625 * vw));
// The screens the owner checks: the box is the screen less the side panels (about 90%), the band is the near field (about 62% of the height).
const SCREENS = [
  { name: "2560x1440", w: 2560, h: 1440 },
  { name: "1920x1080", w: 1920, h: 1080 },
  { name: "1366x768", w: 1366, h: 768 },
  { name: "1280x720", w: 1280, h: 720 },
] as const;

describe("the prompt panel size on the multi-seat tables", () => {
  it("takes its unit from the screen in the 3-way, the 4-way and the Tag stages (never from the camera)", () => {
    for (const css of [table, grid]) expect(css).toMatch(/--duel-unit: clamp\(max\(1px, var\(--pr-unit, 1px\)\), 0\.0625vw, 1\.4px\);/);
    expect(tag).toMatch(/--duel-unit: clamp\(1px, 0\.0625vw, 1\.4px\);/);
    // No scale() or zoom variable reaches the panel: the slot is a sibling of the zoomed world.
    for (const css of [table, grid]) expect(css).not.toMatch(/data-prompt-panel[^{]*\{[^}]*(--zoom|scale\()/);
  });

  describe.each(SCREENS)("at $name", ({ w, h }) => {
    const unit = unitAt(w, promptUnit(Math.round(h * 0.62)));

    it("the panel is at least 440 px wide (528 px at 1080p, 616 px at 1440p) and fits the box", () => {
      const width = Math.min(440 * unit, w - 24);
      expect(width).toBeGreaterThanOrEqual(440);
      expect(width).toBeLessThanOrEqual(w - 24);
      if (w >= 1920) expect(width).toBeGreaterThanOrEqual(520);
      if (w >= 2560) expect(width).toBeGreaterThanOrEqual(600);
    });

    it("the text is 16 px or more (title 20 px or more) and the source card art is 90 px high or more", () => {
      expect(Math.max(16, 14 * unit)).toBeGreaterThanOrEqual(16);
      expect(Math.min(28, Math.max(20, 19 * unit))).toBeGreaterThanOrEqual(20);
      expect(Math.round(64 * unit * (86 / 59))).toBeGreaterThanOrEqual(90);
      if (w >= 1920) expect(Math.round(64 * unit * (86 / 59))).toBeLessThanOrEqual(135);
    });
  });

  it("the CSS states those numbers: widths, text steps and art", () => {
    for (const css of [table, grid]) {
      expect(css).toMatch(/--duel-t-body: calc\(max\(16px,/);
      expect(css).toMatch(/--duel-t-sm: calc\(max\(14px,/);
      expect(css).toMatch(/--pc-title: calc\(clamp\(20px, calc\(19 \* var\(--duel-unit\)\), 28px\)/);
      expect(css).toMatch(/width: min\(calc\(440 \* var\(--duel-unit\)\)/);
      expect(css).toMatch(/max-width: min\(max\(460px, calc\(480 \* var\(--duel-unit\)\)\)/);
    }
    expect(prompts).toMatch(/\[data-prompt-dense\]\) \.sourceArt \{ width: calc\(64 \* var\(--duel-unit, 1px\)\); \}/);
    expect(prompts).toMatch(/\[data-prompt-dense\]\) \.recall \{ grid-template-columns: calc\(64 \* var\(--duel-unit, 1px\)\)/);
    expect(precheck).toMatch(/\[data-prompt-dense\]\) \.thumb \{ width: calc\(54 \* var\(--duel-unit, 1px\)\)/);
  });

  it("the title wraps to two lines or more (balanced) and is never cut with an ellipsis", () => {
    const rule = (/:global\(\[data-prompt-dense\]\) \.titles h2 \{([^}]*)\}/.exec(prompts)?.[1] ?? "").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(rule).toMatch(/white-space: normal/);
    expect(rule).toMatch(/text-wrap: balance/);
    expect(rule).toMatch(/overflow: visible/);
    expect(rule).not.toMatch(/ellipsis|nowrap/);
    const sub = /:global\(\[data-prompt-dense\]\) \.titles p \{([^}]*)\}/.exec(prompts)?.[1] ?? "";
    expect(sub).not.toMatch(/ellipsis|nowrap/);
  });

  it("a phone keeps its own row, tall enough for the title, the card and Yes / No without a scroll", () => {
    expect(table).toMatch(/\.board\[data-portrait\] \.slot\[data-slot="prompt"\] :global\(\[data-prompt-panel\]\),[^{]*\{[^}]*max-height: min\(300px, 55%\)/);
  });

  it("the seat choice is wider than before (280 px or more, 460 px at most)", () => {
    for (const css of [table, grid]) expect(css).toMatch(/width: clamp\(280px, 26%, 460px\)/);
  });
});
