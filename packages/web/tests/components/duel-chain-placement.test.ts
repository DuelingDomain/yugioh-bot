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

  it("moves the stack to a small strip at the top left of a narrow board", () => {
    const narrow = /@media \(max-width: 760px\)\s*\{([\s\S]*?)\n\}/.exec(chainCss);
    expect(narrow).not.toBeNull();
    expect(narrow![1]).toMatch(/\.dock\s*\{\s*inset:\s*\d+px auto auto \d+px/);
    expect(narrow![1]).toMatch(/\.panel\s*\{[^}]*width:\s*min\(\d+px,\s*\d+vw\)/);
  });

  it("keeps the stack off the middle lane the prompt uses", () => {
    // The prompt panel is centred; the stack is a fixed-width panel on the left edge.
    expect(promptCss).toMatch(/left:\s*50%/);
    const panel = rule(chainCss, ".panel");
    expect(panel).toMatch(/width:\s*clamp\(138px/);
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
    for (const name of ["chainGlowIn", "chainTagIn"]) {
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
});
