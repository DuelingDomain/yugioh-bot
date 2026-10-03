import { readFileSync } from "node:fs";
import postcss, { type AtRule } from "postcss";
import { describe, expect, it } from "vitest";

const globals = readFileSync(new URL("../../../app/globals.css", import.meta.url), "utf8");
const shell = readFileSync(new URL("../../../src/components/layout/shell.module.css", import.meta.url), "utf8");

function maxWidthMedia(css: string): AtRule {
  const media = postcss.parse(css).nodes.find((node): node is AtRule =>
    node.type === "atrule" && node.name === "media" && /^\(max-width:\s*\d+px\)$/.test(node.params),
  );
  expect(media, "max-width media block").toBeDefined();
  return media!;
}

describe("phone shell scroll padding", () => {
  it("keeps jumps and focus scrolling below the top bar at the same breakpoint", () => {
    const globalsMedia = maxWidthMedia(globals);
    const shellMedia = maxWidthMedia(shell);
    const breakpoint = Number(/max-width:\s*(\d+)px/.exec(globalsMedia.params)?.[1]);
    const shellBreakpoint = Number(/max-width:\s*(\d+)px/.exec(shellMedia.params)?.[1]);
    expect(breakpoint).toBe(820);
    expect(shellBreakpoint).toBe(breakpoint);

    const html = globalsMedia.nodes?.find((node) => node.type === "rule" && node.selector === "html");
    const padding = Number(/scroll-padding-top:\s*(\d+(?:\.\d+)?)px\b/.exec(html?.toString() ?? "")?.[1]);
    const header = shellMedia.nodes?.find((node) =>
      node.type === "rule" && node.selector === ".topWrap > header:global(.ns-top)",
    );
    const barHeight = Number(/\bheight:\s*(\d+(?:\.\d+)?)px\b/.exec(header?.toString() ?? "")?.[1]);
    expect(barHeight).toBe(56);
    expect(padding).toBeGreaterThanOrEqual(barHeight + 8);
  });
});
