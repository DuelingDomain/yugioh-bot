import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// jsdom does not lay anything out, so the placement rules are read from the stylesheet.
const duel = join(fileURLToPath(new URL("../../", import.meta.url)), "src/components/duel");
const chainCss = readFileSync(join(duel, "chain-fx.module.css"), "utf8");
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
    expect(dock).toMatch(/inset:\s*0 auto 0 calc\(/);
    expect(dock).toMatch(/pointer-events:\s*none/);
  });

  it("turns the stack into a row of numbered chips in the top left corner when there is no free gutter", () => {
    expect(rule(chainCss, ".front[data-size=\"compact\"] .dock")).toMatch(/inset:\s*var\(--chain-dock-top, 4px\) auto auto var\(--chain-dock-left, 4px\)/);
    const panel = /\.front\[data-size="compact"\] \.panel,[^{]*\{([^}]*)\}/.exec(chainCss);
    expect(panel).not.toBeNull();
    expect(panel![1]).toMatch(/flex-direction:\s*row/);
    expect(panel![1]).toMatch(/max-height:\s*none/);
    expect(panel![1]).toMatch(/max-width:\s*100%/);
    // A long chain wraps; nothing is clipped by overflow, so Chain Link 1 can never drop off the row.
    expect(panel![1]).toMatch(/flex-wrap:\s*wrap/);
    expect(panel![1]).toMatch(/overflow:\s*visible/);
    // The row stops short of the board edge wherever the corner moved to.
    expect(rule(chainCss, ".front[data-size=\"compact\"] .dock")).toMatch(/max-width:\s*calc\(100% - var\(--chain-dock-left, 4px\) - 4px\)/);
    // The text and the thumbnail go; the number, its state and the head count stay.
    expect(chainCss).toMatch(/\.front\[data-size="compact"\] \.thumb,\s*\n\.front\[data-size="compact"\] \.text \{ display: none; \}/);
    // No viewport media query decides it: the measured gutter does.
    expect(chainCss).not.toMatch(/@media \(max-width: 760px\)/);
  });

  it("sizes the full stack by the measured gutter and never by a fixed px width alone", () => {
    expect(rule(chainCss, ".panel")).toMatch(/width:\s*clamp\(150px,\s*calc\(var\(--chain-gutter,\s*200px\) - 16px\),\s*264px\)/);
  });

  it("hides a target ring that sits under an open prompt panel", () => {
    expect(chainCss).toMatch(/\.target\[data-covered="true"\]\s*\{\s*visibility:\s*hidden/);
  });

  it("keeps the stack off the middle lane the prompt uses", () => {
    // The prompt panel is centred; the stack is a fixed-width panel on the left edge.
    expect(promptCss).toMatch(/left:\s*50%/);
    const panel = rule(chainCss, ".panel");
    expect(panel).toMatch(/width:\s*clamp\(150px/);
    expect(panel).toMatch(/max-height:\s*72%/);
  });

  it("draws the numbered badge at least 28px wide and the callout over its card", () => {
    const source = readFileSync(join(duel, "chain-fx.tsx"), "utf8");
    expect(source).toMatch(/const MIN_BADGE = 28;/);
    expect(source).toMatch(/const MAX_BADGE = 46;/);
    expect(rule(chainCss, ".tag")).toMatch(/position:\s*absolute/);
    expect(chainCss).toMatch(/\.slot\[data-half="low"\] \.tag \{ top: auto; bottom:/);
  });

  it("animates only transform and opacity in the new glow and callout", () => {
    for (const name of ["chainGlowIn", "chainTagIn", "chainDrop", "chainClink", "chainIn"]) {
      const block = new RegExp(`@keyframes ${name} \\{([\\s\\S]*?)\\n\\}`).exec(chainCss);
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
    const entries: Array<[string, string]> = [
      [".badge", "chainDrop"], [".ring", "chainStrike"], [".tag", "chainTagIn"], [".chip", "chainClink"], [".row", "chainIn"], [".panel", "chainIn"],
    ];
    for (const [selector, name] of entries) {
      const body = rule(chainCss, selector);
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

  it("never lets a chain cosmetic take a pointer: the layers and the stack do not catch input", () => {
    for (const selector of [".layer", ".dock"]) expect(rule(chainCss, selector)).toMatch(/pointer-events:\s*none/);
    expect(chainCss).not.toMatch(/pointer-events:\s*auto/);
  });

  it("keeps the front layer inside the board box, and treats the room notices as a prompt surface", () => {
    expect(rule(chainCss, '.front[data-portal="true"]')).toMatch(/overflow:\s*clip/);
    expect(readFileSync(join(duel, "room.tsx"), "utf8")).toMatch(/className=\{styles\.notices\} data-prompt-surface/);
    expect(readFileSync(join(duel, "table/table-shell.tsx"), "utf8")).toMatch(/className=\{roomStyles\.notices\} data-prompt-surface/);
  });
});
