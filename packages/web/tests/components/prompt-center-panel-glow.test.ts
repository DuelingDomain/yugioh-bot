import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(__dirname, "../../src/components/duel/prompt-center.module.css"), "utf8");

/** The declarations of the first rule with this exact selector. */
function rule(selector: string): string {
  const start = css.indexOf(`\n${selector} {`);
  expect(start, `${selector} rule`).toBeGreaterThan(-1);
  return css.slice(start, css.indexOf("\n}", start));
}

describe("prompt panel glow", () => {
  // jsdom has no layout (scrollHeight is 0), so the rule itself is checked: a pseudo-element with a negative inset
  // sticks out of the scrolling panel and adds scroll area, so a mouse wheel pushed the title off the top.
  it("scrolls (the panel is a scroll box) but its glow box does not stick out of it", () => {
    expect(rule(".panel")).toMatch(/overflow-y:\s*auto/);
    const glow = rule(".panel::before");
    expect(glow).toMatch(/position:\s*absolute/);
    expect(glow).toMatch(/inset:\s*0;/);
    expect(glow).not.toMatch(/(inset|top|right|bottom|left):[^;]*-\d/);
    expect(glow).not.toMatch(/translate|scale|width:|height:/);
  });

  it("sizes the gradient 48px larger than the panel on every side, only to keep the old shape of the fade", () => {
    expect(rule(".panel::before")).toContain("center / calc(100% + 96px) calc(100% + 96px) no-repeat");
  });
});
