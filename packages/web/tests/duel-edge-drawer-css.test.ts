import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const dir = join(__dirname, "../src/components/duel/edge-drawer");
const drawerCss = readFileSync(join(dir, "edge-drawer.module.css"), "utf8");
const frameCss = readFileSync(join(dir, "field-frame.module.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const fitRule = frameCss.slice(frameCss.indexOf(".fit {"));

describe("edge drawer css", () => {
  it("has a reduced-motion block that removes the slide transform transition and the glow beat", () => {
    const block = drawerCss.slice(drawerCss.indexOf("@media (prefers-reduced-motion: reduce)"));
    expect(block).toContain(".slide { transition: none; }");
    expect(block).toContain("animation: none");
  });
  it("never loops the attention glow", () => {
    expect(drawerCss).not.toMatch(/animation:[^;]*infinite/);
  });
  it("lets clicks through the root so a closed drawer does not block the field", () => {
    expect(drawerCss).toMatch(/\.root\s*\{[^}]*pointer-events:\s*none/s);
  });
  it("hides a closed panel from pointer and keyboard", () => {
    expect(drawerCss).toMatch(/\[data-state="closed"\] \.panel\s*\{[^}]*visibility:\s*hidden/s);
  });
  it("only animates transform and opacity-like properties for the slide", () => {
    expect(drawerCss).not.toMatch(/transition:[^;]*\b(left|right|top|bottom|width|height)\b/);
  });
});

describe("field frame css", () => {
  it("sets no width cap on the fitted field", () => {
    expect(frameCss).not.toMatch(/max-width|max-height/);
    expect(fitRule).not.toMatch(/clamp\(/);
  });
  it("fits to the area with container units", () => {
    expect(frameCss).toContain("container-type: size");
    expect(frameCss).toMatch(/--bf-z:[^;]*100cqw[^;]*100cqh/s);
  });
});
