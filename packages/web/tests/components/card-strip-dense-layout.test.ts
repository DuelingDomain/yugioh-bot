import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const dir = join(__dirname, "../../src/components/duel");
const strip = readFileSync(join(dir, "card-strip.module.css"), "utf8");
const tableStage = readFileSync(join(dir, "table/table-stage.module.css"), "utf8");
const gridStage = readFileSync(join(dir, "table/grid-stage.module.css"), "utf8");

/** The declarations of the rule that starts with this selector text (jsdom has no layout, so the css itself is checked). */
function rule(css: string, selector: string): string {
  const start = css.indexOf(`${selector} {`);
  expect(start, `${selector} rule`).toBeGreaterThan(-1);
  return css.slice(start, css.indexOf("}", start));
}

const dense = ':global([data-prompt-dense]) .wrap:not([data-tone="chain"])';

describe("card strip in a dense host (3-way, Tag, 4-way)", () => {
  // jsdom: no layout. The owner's 1267x596 window made 65px tiles, because the tile was 92 * the pair unit (0.72 at most sizes).
  it("applies on a window wider than a phone only, so the phone strip is unchanged", () => {
    const at = strip.indexOf("@media (min-width: 901px)");
    expect(at).toBeGreaterThan(-1);
    expect(strip.indexOf(dense, at)).toBeGreaterThan(at);
  });

  it("sizes the tile from a px floor of 96px and a 112px base, not from the pair unit alone", () => {
    const decl = rule(strip, dense);
    expect(decl).toMatch(/--cs-w:\s*clamp\(96px,/);
    expect(decl).toMatch(/max\(112px, calc\(128 \* var\(--cs-u\)\)\)/);
  });

  it("wraps the cards into rows that scroll up and down inside the panel", () => {
    const decl = rule(strip, `${dense} .strip`);
    expect(decl).toMatch(/flex-wrap:\s*wrap/);
    expect(decl).toMatch(/overflow-y:\s*auto/);
    expect(decl).toMatch(/overflow-x:\s*hidden/);
    expect(decl).toMatch(/min-height:\s*0/);
    expect(decl).toMatch(/scroll-snap-type:\s*none/);
  });

  it("lets the list shrink, so the title and the Confirm button stay in view", () => {
    expect(rule(strip, dense)).toMatch(/flex:\s*1 1 auto/);
    const frame = rule(strip, `${dense} .frame`);
    expect(frame).toMatch(/min-height:\s*0/);
    expect(frame).toMatch(/flex:\s*1 1 auto/);
  });

  it("keeps the two-line name under every tile", () => {
    expect(strip).toMatch(/-webkit-line-clamp:\s*2/);
    expect(strip).not.toMatch(/\.name\s*\{[^}]*white-space:\s*nowrap/);
  });

  it("keeps the chain response strip and its panel as they were", () => {
    expect(strip).not.toMatch(/\.wrap\[data-tone="chain"\][^{]*\{[^}]*flex-wrap/);
    expect(tableStage).toMatch(/\[data-strip="true"\]:not\(\[data-precheck\], \[data-tone="chain"\]\)/);
    expect(gridStage).toMatch(/\[data-strip="true"\]:not\(\[data-precheck\], \[data-tone="chain"\]\)/);
  });

  it("keeps the panel inside the pair box (at least 300px tall on a small window), so it does not reach the hand", () => {
    for (const css of [tableStage, gridStage]) {
      const at = css.indexOf(':not([data-precheck], [data-tone="chain"])) {');
      expect(at).toBeGreaterThan(-1);
      const decl = css.slice(at, css.indexOf("}", at));
      expect(decl).toMatch(/max-height:\s*min\(max\(calc\(var\(--pr-h[^)]*\) - 40px\), 300px\), calc\(100% - 24px\)\)/);
    }
  });
});
