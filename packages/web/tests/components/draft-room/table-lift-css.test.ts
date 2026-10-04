import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("../../../src/components/draft/room/draft-room.css", import.meta.url), "utf8");
const rule = (selector: string) => {
  const at = css.indexOf(`${selector} {`);
  expect(at).toBeGreaterThan(-1);
  return css.slice(at, css.indexOf("}", at));
};

describe("the lift moves the scene and the tray as one", () => {
  it("raises the whole scene, so the perspective eye point rises with the table", () => {
    expect(rule(".dr .scene")).toMatch(/translate:\s*0 calc\(0px - var\(--lift, 0px\)\)/);
    // the table keeps its own offset: lifting only the table would flatten its tilt
    expect(rule(".dr .dr-table")).not.toContain("--lift");
  });

  it("raises the tray and the filter note by the same amount", () => {
    expect(rule(".dr .disk")).toContain("bottom: calc(14px + var(--lift, 0px))");
    expect(css).toContain("bottom: calc(var(--disk-h) + 24px + var(--lift, 0px))");
  });

  it("leaves the flat scrolling table and the phone scene where they were", () => {
    expect(rule(".dr .stage[data-tall] .scene")).toContain("translate: none");
    expect(css).toMatch(/\.dr \.scene \{ perspective: 1000px; perspective-origin: 50% 0%; translate: none; \}/);
  });
});
