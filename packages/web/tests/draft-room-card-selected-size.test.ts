import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(__dirname, "../src/components/draft/room/draft-room.css"), "utf8");

/** Every rule whose selector mentions a pack card (.tcard) in its selected, hovered or focused state. */
function rulesFor(state: RegExp): Array<{ selector: string; body: string }> {
  const rules: Array<{ selector: string; body: string }> = [];
  for (const m of css.matchAll(/([^{}@]+)\{([^{}]*)\}/g)) {
    const selector = m[1].trim();
    if (selector.includes(".tcard") && state.test(selector)) rules.push({ selector, body: m[2] });
  }
  return rules;
}

describe("draft room pack cards keep their size when selected", () => {
  const states = [
    ["selected", /\[data-sel\]/],
    ["hovered", /:hover/],
    ["focused", /:focus/],
  ] as const;

  it.each(states)("a %s card does not move, turn or scale", (_name, state) => {
    // the badge is a small pseudo-element drawn inside the face, so it may have its own size
    const rules = rulesFor(state).filter((r) => !r.selector.includes("::"));
    expect(rules.length).toBeGreaterThan(0);
    for (const { selector, body } of rules) {
      expect(body, selector).not.toMatch(/(^|[;\s])(transform|translate|rotate|scale|zoom|width|height|padding|margin|border(-width)?)\s*:/);
    }
  });

  it("the stand-up lift is gone from selected and hovered cards", () => {
    expect(rulesFor(/\.lift/).filter((r) => /\[data-sel\]|:hover/.test(r.selector))).toEqual([]);
  });

  it("shows the selection as a glow ring and a badge on the face", () => {
    const sel = rulesFor(/\[data-sel\][^,]*\.face$/);
    expect(sel.some((r) => /box-shadow:[^;]*rgb\(155 126 255/.test(r.body))).toBe(true);
    expect(rulesFor(/\[data-sel\] \.face::before/).length).toBe(1);
  });

  it("has no contact shadow under a selected or hovered card", () => {
    expect(rulesFor(/\.shadow/).filter((r) => /\[data-sel\]|:hover/.test(r.selector))).toEqual([]);
  });

  it("does not dim the selected card when the filter misses it", () => {
    const rules = rulesFor(/\[data-lens="miss"\]\[data-sel\]/);
    const face = rules.find((r) => /\.face$/.test(r.selector));
    expect(face?.body).toMatch(/filter:\s*none/);
    // only the art may dim, and not below the readable range
    const art = rules.find((r) => /\.face img$/.test(r.selector));
    const level = Number(art?.body.match(/brightness\(([\d.]+)\)/)?.[1] ?? 0);
    expect(level).toBeGreaterThanOrEqual(0.5);
  });

  it("keeps no leftover rule for the removed stand-up lift", () => {
    expect(css).not.toMatch(/\.tcard \.lift\s*\{/);
    expect(css).not.toMatch(/standing up/);
  });
});
