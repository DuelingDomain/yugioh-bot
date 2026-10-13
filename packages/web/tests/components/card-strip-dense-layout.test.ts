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

  it("sizes the tile from a px floor of 70px and a 112px base, not from the pair unit alone", () => {
    const decl = rule(strip, dense);
    expect(decl).toMatch(/--cs-w:\s*clamp\(70px,/);
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

  it("keeps the two-line name under every tile: the dense block does not touch the name", () => {
    expect(strip).toMatch(/\.name \{[^}]*-webkit-line-clamp:\s*2/);
    const block = strip.slice(strip.indexOf("@media (min-width: 901px)"));
    expect(block).not.toMatch(/\.name\b/);
    expect(block).not.toMatch(/white-space:\s*nowrap/);
    expect(block).not.toMatch(/line-clamp:\s*1\b/);
  });

  it("keeps the chain response strip as it was: every rule of the dense block leaves it out", () => {
    const block = strip.slice(strip.indexOf("@media (min-width: 901px)"));
    const selectors = [...block.matchAll(/^\s*(:global\(\[data-prompt-dense\]\)[^{]*)\{/gm)].flatMap((match) => match[1].split(","));
    expect(selectors.length).toBeGreaterThan(5);
    for (const selector of selectors) expect(selector, selector).toContain(':not([data-tone="chain"])');
  });

  it("caps the panel on a dense host only, never a chain response or a precheck", () => {
    for (const css of [tableStage, gridStage]) {
      expect(css).toMatch(/\[data-prompt-dense\] :global\(\[data-prompt-panel\]\[data-strip="true"\]:not\(\[data-precheck\], \[data-tone="chain"\]\)\) \{/);
    }
  });

  it("keeps the panel in the pair box, and no taller than the box plus 28px (table) or minus 16px (grid) on a short window, so it keeps off the hand", () => {
    const caps = [
      [tableStage, "\\+ 28px"],
      [gridStage, "- 16px"],
    ] as const;
    for (const [css, term] of caps) {
      const at = css.indexOf("--pr-strip-h:");
      expect(at).toBeGreaterThan(-1);
      const decl = css.slice(at, css.indexOf("}", at));
      expect(decl).toMatch(new RegExp(`--pr-strip-h:\\s*max\\(calc\\(var\\(--pr-h[^)]*\\) - 40px\\), min\\(300px, calc\\(var\\(--pr-h[^)]*\\) ${term}\\)\\)\\);`));
      expect(decl).toMatch(/max-height:\s*min\(var\(--pr-strip-h\), calc\(100% - 24px\)\);/);
    }
  });

  it("sizes the tile from that cap and from the text scale", () => {
    expect(rule(strip, dense)).toMatch(/var\(--pr-strip-h, 300px\) - 204px \* var\(--tt, 1\)/);
  });

  it("lays the rows out as a centred grid of equal columns, so Up and Down keep the column in a short last row", () => {
    const list = rule(strip, `${dense} .strip`);
    expect(list).toMatch(/display:\s*grid;/);
    expect(list).toMatch(/grid-template-columns:\s*repeat\(auto-fill, var\(--cs-w\)\);/);
    expect(list).toMatch(/justify-content:\s*center;/);
    // The wrap check (stripWraps) reads flex-wrap, so it stays declared.
    expect(list).toMatch(/flex-wrap:\s*wrap;/);
  });

  it("centres a short list, and has no scroll bar that could push a card to the next row", () => {
    const list = rule(strip, `${dense} .strip`);
    expect(list).toMatch(/margin-inline:\s*auto;/);
    expect(list).toMatch(/scrollbar-width:\s*none;/);
    expect(strip).toMatch(/\.strip::-webkit-scrollbar \{ display: none; \}/);
  });

  it("puts the count and the up and down buttons in the caption line, not over the cards", () => {
    expect(strip).toMatch(/\.bar\[data-pager\] \{ display: flex;/);
    expect(strip).toMatch(/\.pageBtn \{/);
    expect(strip).not.toMatch(/\.arrow\[data-side="(up|down)"\]/);
  });

});

// jsdom: no layout, so the css itself is checked. These are guards against someone removing the room again, not proof that nothing clips: the proof
// is a browser measurement (the preview pages, at five window sizes). The owner's screenshot of "Select a card": the first row of the grid sat 10px
// under the top of the scroller (overflow clips the pick mark and the lift), and the number badge sat over the printed card name.
describe("card strip: nothing is cut at the top, and the number badge keeps off the card name", () => {
  // The smallest value of a pad: calc(N * unit [+ Mpx]) at the smallest unit (0.72), max(Npx, ...) at least N, a plain px as it is.
  const SMALLEST_UNIT = 0.72;
  const least = (value: string): number => {
    const scaled = value.replace(/calc\((\d+(?:\.\d+)?) \* var\(--cs-u\)(?: \+ (\d+(?:\.\d+)?)px)?\)/g, (_, n: string, add?: string) => `${Number(n) * SMALLEST_UNIT + Number(add ?? 0)}px`);
    const sizes = [...scaled.matchAll(/(-?\d+(?:\.\d+)?)px/g)].map((part) => Number(part[1]));
    expect(sizes.length, value).toBeGreaterThan(0);
    return value.startsWith("max(") ? Math.max(...sizes) : sizes[0];
  };
  const decls = (css: string, name: string) => [...css.matchAll(new RegExp(`${name}:\\s*([^;]+);`, "g"))].map((match) => match[1]);

  it("puts the number badge inside the art at the bottom left, away from the printed name and the pick mark", () => {
    const badge = rule(strip, ".num");
    expect(badge).toMatch(/bottom:\s*max\(\d+px, calc\(\d+ \* var\(--cs-u\)\)\);/);
    expect(badge).toMatch(/left:\s*max\(\d+px, calc\(\d+ \* var\(--cs-u\)\)\);/);
    expect(badge).not.toMatch(/\btop:/);
  });

  it("keeps the number badge at least 16px high, and the pick mark above a selected neighbour's ring", () => {
    const badge = rule(strip, ".num");
    expect(badge).toMatch(/min-width:\s*max\(16px, calc\(18 \* var\(--cs-u\)\)\);/);
    expect(badge).toMatch(/height:\s*max\(16px, calc\(18 \* var\(--cs-u\)\)\);/);
    expect(rule(strip, ".mark")).toMatch(/z-index:\s*1;/);
  });

  it("hangs the pick mark off the top right corner", () => {
    const mark = rule(strip, ".mark");
    expect(mark).toMatch(/top:\s*calc\(-\d+ \* var\(--cs-u\)\);/);
    expect(mark).toMatch(/right:\s*calc\(-\d+ \* var\(--cs-u\)\);/);
  });

  it("leaves room at the top for the lift (4px) and the pick mark (8px and its ring): every host keeps 14px at the smallest unit", () => {
    const tops = decls(strip, "--cs-pad-top");
    expect(tops.length).toBeGreaterThanOrEqual(4);
    for (const value of tops) expect(least(value), value).toBeGreaterThanOrEqual(14);
  });

  it("leaves room at the sides for the pick mark and its ring: every host keeps 14px at the smallest unit", () => {
    const sides = decls(strip, "--cs-pad-x");
    expect(sides.length).toBeGreaterThanOrEqual(4);
    for (const value of sides) expect(least(value), value).toBeGreaterThanOrEqual(14);
  });

  it("grows the top room of the wide dense grid with the unit, which passes 1px on a big window: the lift and the mark scale with it", () => {
    expect(rule(strip, dense)).toMatch(/--cs-pad-top:\s*max\(16px, calc\(12 \* var\(--cs-u\) \+ 4px\)\);/);
  });

  it("shrinks the bottom fade with a short panel, so the first row's names stay clear of it", () => {
    expect(rule(strip, dense)).toMatch(/--cs-fade:\s*clamp\(4px, calc\(var\(--pr-strip-h, 300px\) - 280px \* var\(--tt, 1\)\), 28px\);/);
  });

  it("keeps a followed row clear of the top edge by the same room", () => {
    for (const value of decls(strip, "scroll-padding-block")) expect(least(value), value).toBeGreaterThanOrEqual(14);
  });

  it("scrolls a focused card into view with the room above it (a phone scrolls the panel)", () => {
    expect(rule(strip, ".card")).toMatch(/scroll-margin-top:\s*var\(--cs-pad-top\);/);
  });
});
