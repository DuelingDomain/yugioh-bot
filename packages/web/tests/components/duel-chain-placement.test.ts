import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// jsdom does not lay anything out, so the placement rules are read from the stylesheet.
const duel = join(fileURLToPath(new URL("../../", import.meta.url)), "src/components/duel");
const chainCss = readFileSync(join(duel, "chain-fx.module.css"), "utf8");
const panelCss = readFileSync(join(duel, "chain-panel.module.css"), "utf8");
const promptCss = readFileSync(join(duel, "prompt-center.module.css"), "utf8");

function rule(css: string, selector: string): string {
  const escaped = selector.replace(/[.[\]="()*]/g, "\\$&");
  const match = new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`).exec(css);
  expect(match, `rule ${selector}`).not.toBeNull();
  return match![1];
}

describe("chain stack placement", () => {
  it("anchors the stack to the left side of the board, never the middle where the prompt opens", () => {
    const dock = rule(chainCss, ".dock");
    expect(dock).toMatch(/inset:\s*var\(--chain-dock-gap, 16%\) auto 14% calc\(/);
    expect(dock).toMatch(/pointer-events:\s*none/);
  });

  it("starts the panel near the top of the gutter, grows it downward and keeps the bottom corner free", () => {
    const dock = rule(chainCss, ".dock");
    expect(dock).toMatch(/inset:\s*var\(--chain-dock-gap, 16%\) auto 14% calc\(/);
    expect(dock).toMatch(/align-items:\s*flex-start/);
  });

  it("puts the strip in the top left corner when there is no free gutter, and stops it short of the board edge", () => {
    const dock = rule(chainCss, '.front[data-size="strip"] .dock');
    expect(dock).toMatch(/inset:\s*var\(--chain-dock-top, 4px\) auto auto var\(--chain-dock-left, 4px\)/);
    // The strip stops short of the board edge wherever the corner moved to.
    expect(dock).toMatch(/max-width:\s*calc\(100% - var\(--chain-dock-left, 4px\) - 4px\)/);
    // No viewport media query decides it: the measured gutter does.
    expect(chainCss).not.toMatch(/@media \(max-width: 760px\)/);
    expect(rule(panelCss, ".strip")).toMatch(/min-height:\s*44px/);
    expect(panelCss).toMatch(/\.strip::after \{ content: ""; position: absolute; inset: -2px; \}/);
  });

  it("sizes the panel by the measured gutter and never by a fixed px width alone", () => {
    expect(rule(panelCss, ".cr")).toMatch(/width:\s*clamp\(214px,\s*calc\(var\(--chain-gutter,\s*230px\) - 16px\),\s*292px\)/);
    expect(panelCss).toMatch(/\.cr\[data-shape="narrow"\] \{ width: clamp\(142px,\s*calc\(var\(--chain-gutter,\s*164px\) - 8px\),\s*214px\); \}/);
  });

  it("lets the card text use the free height, and lets the rows give way before the outcome", () => {
    expect(panelCss).not.toMatch(/--chain-text-lines|data-length/);
    expect(rule(panelCss, ".cardText")).not.toMatch(/max-height/);
    expect(rule(panelCss, ".stack")).toMatch(/flex:\s*0 1000 auto/);
    expect(panelCss).toMatch(/\.cr:not\(\[data-shape="sheet"\]\) \.hero > \* \{ flex: none; \}/);
  });

  it("scales the narrow hero name with the text scale", () => {
    expect(panelCss).toMatch(/\.cr\[data-shape="narrow"\] \.name \{ font-size: calc\(17px \* var\(--tt, 1\)\); \}/);
    expect(panelCss).not.toMatch(/\.name \{ font-size: \d+px; \}/);
  });

  it("hides a target ring that sits under an open prompt panel", () => {
    expect(chainCss).toMatch(/\.target\[data-covered="true"\]\s*\{\s*visibility:\s*hidden/);
  });

  it("keeps the panel off the middle lane the prompt uses, and inside the board's height", () => {
    // The prompt panel is centred; the panel is a bounded column on the left edge.
    expect(promptCss).toMatch(/left:\s*50%/);
    const panel = rule(panelCss, ".cr");
    expect(panel).toMatch(/max-height:\s*calc\(100% - 12px\)/);
    expect(panel).toMatch(/overflow:\s*hidden/);
  });

  it("draws the numbered badge at least 28px wide and the callout over its card", () => {
    const source = readFileSync(join(duel, "chain-fx.tsx"), "utf8");
    expect(source).toMatch(/const MIN_BADGE = 28;/);
    expect(source).toMatch(/const MAX_BADGE = 46;/);
    expect(rule(chainCss, ".tag")).toMatch(/position:\s*absolute/);
    expect(chainCss).toMatch(/\.slot\[data-half="low"\] \.tag \{ top: auto; bottom:/);
  });

  it("animates only transform and opacity in the new glow and callout", () => {
    for (const name of ["chainGlowIn", "chainTagIn", "chainDrop", "chainClink", "crIn", "crSheetIn", "crHeroIn", "crFade", "crPulse"]) {
      const block = new RegExp(`@keyframes ${name} \\{([\\s\\S]*?)\\n\\}`).exec(chainCss + "\n" + panelCss);
      expect(block, name).not.toBeNull();
      const props = [...block![1].matchAll(/([a-z-]+):/g)].map((m) => m[1]);
      expect(props.every((p) => p === "opacity" || p === "transform"), `${name}: ${props.join(",")}`).toBe(true);
    }
  });

  it("switches the glow and callout animations off on reduced motion", () => {
    expect(chainCss).toMatch(/\.layer\[data-reduced="true"\] \.glow/);
    expect(chainCss).toMatch(/\.layer\[data-reduced="true"\] \.tag/);
    expect(chainCss).toMatch(/\.glow, \.tag,/);
  });

  it("keeps every entry animation short, between 150 and 250 ms with its delay under 150 ms", () => {
    const entries: Array<[string, string, string]> = [
      [chainCss, ".badge", "chainDrop"], [chainCss, ".ring", "chainStrike"], [chainCss, ".tag", "chainTagIn"], [chainCss, ".chip", "chainClink"],
      [panelCss, ".cr", "crIn"], [panelCss, ".hero", "crHeroIn"], [panelCss, ".strip", "crIn"],
    ];
    for (const [css, selector, name] of entries) {
      const body = rule(css, selector);
      const m = new RegExp(`animation:\\s*${name}\\s+([\\d.]+)s[^;]*?(?:\\s([\\d.]+)s)?\\s*(?:both|backwards);`).exec(body);
      expect(m, `${selector} ${name}`).not.toBeNull();
      const ms = parseFloat(m![1]) * 1000;
      expect(ms, `${selector} duration`).toBeGreaterThanOrEqual(150);
      expect(ms, `${selector} duration`).toBeLessThanOrEqual(250);
      expect(parseFloat(m![2] ?? "0") * 1000, `${selector} delay`).toBeLessThan(150);
    }
    const glow = /\.slot\[data-status="pending"\]\[data-top="true"\] \.glow \{[^}]*animation: chainGlowIn ([\d.]+)s/.exec(chainCss);
    expect(parseFloat(glow![1]) * 1000).toBeLessThanOrEqual(250);
    const wire = /animation: chainWireIn ([\d.]+)s ease ([\d.]+)s/.exec(chainCss);
    expect(parseFloat(wire![1]) * 1000).toBeLessThanOrEqual(250);
    expect(parseFloat(wire![2]) * 1000).toBeLessThan(150);
  });

  it("switches the panel animations off on reduced motion, by the media query and by the app's own setting", () => {
    expect(panelCss).toMatch(/:global\(\[data-chain-front\]\[data-reduced="true"\]\) \.cr,/);
    expect(panelCss).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*\.cr, \.hero, \.out, \.strip, \.scrim, \.wait i \{ animation: none !important; \}/);
  });

  it("takes a pointer only on the strip, the sheet, its scrim and a box the layout really cuts", () => {
    const auto = [...panelCss.matchAll(/(^|\n)([^\n{}]+)\{[^}]*pointer-events:\s*auto/g)].map((m) => m[2].trim());
    expect(auto).toEqual(['.cardText[data-overflow="true"]', '.stack[data-overflow="true"]', ".strip", ".scrim", ".sheet"]);
    expect(rule(panelCss, ".cr")).not.toMatch(/pointer-events:\s*auto/);
  });

  it("never lets a chain cosmetic take a pointer: the layers and the stack do not catch input", () => {
    for (const selector of [".layer", ".dock"]) expect(rule(chainCss, selector)).toMatch(/pointer-events:\s*none/);
    expect(chainCss).not.toMatch(/pointer-events:\s*auto/);
  });

  it("keeps the front layer inside the board box, and treats the room notices as a prompt surface", () => {
    expect(rule(chainCss, '.front[data-portal="true"]')).toMatch(/overflow:\s*clip/);
    expect(readFileSync(join(duel, "room.tsx"), "utf8")).toMatch(/className=\{styles\.notices\} data-prompt-surface/);
    expect(readFileSync(join(duel, "table/table-shell.tsx"), "utf8")).toMatch(/className=\{`\$\{roomStyles\.notices\}[^`]*`\} data-prompt-surface/);
  });
});
