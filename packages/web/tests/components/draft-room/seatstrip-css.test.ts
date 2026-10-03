import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("../../../src/components/draft/room/draft-room.css", import.meta.url), "utf8");
const phone = css.split("@media (max-width: 900px) {")[1]?.split("\n}")[0] ?? "";

describe("phone seat strip CSS", () => {
  it("keeps seat chips at least 44 pixels wide without shrinking", () => {
    const chip = phone.match(/\.dr \.chip-seat\s*\{([^}]+)\}/)?.[1] ?? "";
    expect(chip).toContain("flex: 1 0 44px");
  });

  it("scrolls the phone strip sideways when seats do not fit", () => {
    const strip = phone.match(/\.dr \.seatstrip\s*\{([^}]+)\}/)?.[1] ?? "";
    expect(strip).toContain("overflow-x: auto");
  });

  it("aligns the booster snap offset with the first seat's resting position", () => {
    const strip = phone.match(/\.dr \.seatstrip\s*\{([^}]+)\}/)?.[1] ?? "";
    const dir = phone.match(/\.dr \.seatstrip \.dir\s*\{([^}]+)\}/)?.[1] ?? "";
    const paddingLeft = Number(strip.match(/padding: \d+px \d+px \d+px (\d+)px/)?.[1]);
    const arrowWidth = Number(dir.match(/width: (\d+)px/)?.[1]);
    const gap = Number(strip.match(/gap: (\d+)px/)?.[1]);
    const stripStart = Number(strip.match(/--strip-start: (\d+)px/)?.[1]);
    const snapGap = strip.match(/--strip-snap: calc\(var\(--strip-start\) \+ (\d+)px\)/);

    expect(strip).toContain("scroll-padding-left: var(--strip-snap)");
    expect(snapGap).not.toBeNull();
    expect(stripStart + Number(snapGap?.[1])).toBe(paddingLeft + arrowWidth + gap);
  });

  it("aligns the theme snap offset with the strip's left padding", () => {
    const strip = phone.match(/\.dr \.seatstrip\s*\{([^}]+)\}/)?.[1] ?? "";
    const theme = phone.match(/\.dr\[data-mode="theme"\] \.seatstrip\s*\{([^}]+)\}/)?.[1] ?? "";
    const paddingLeft = Number(strip.match(/padding: \d+px \d+px \d+px (\d+)px/)?.[1]);
    const snapOffset = Number(theme.match(/--strip-snap: (\d+)px/)?.[1]);

    expect(snapOffset).toBe(paddingLeft);
  });
});
