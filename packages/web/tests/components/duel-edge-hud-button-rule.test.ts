import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const hudCss = readFileSync(resolve(import.meta.dirname, "../../src/components/duel/table/grid-hud.module.css"), "utf8");

// The edge HUD sizes the station track's turn buttons (height 34px, 14px side padding). A bare [class*="primary"] also
// matched the label span (primaryLabel), which took the button height and padding: the text sat high and off center.
describe("the edge HUD turn button size rule", () => {
  it("names the button element for primary and secondary", () => {
    const sizeRule = /button\[class\*="primary"\],\s*\n[^{]*\[class\*="secondary"\] \{[^}]*height: 34px/.exec(hudCss);
    expect(sizeRule, "the size rule").not.toBeNull();
    expect(sizeRule![0]).toContain('button[class*="primary"]');
    expect(sizeRule![0]).toContain('button[class*="secondary"]');
    expect(hudCss).not.toMatch(/\) \[class\*="(primary|secondary)"\]/);
  });
});
