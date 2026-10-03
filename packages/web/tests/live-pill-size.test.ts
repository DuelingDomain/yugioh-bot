import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(__dirname, "../src/components/duel/room.module.css"), "utf8");
const rule = (selector: string) => {
  const start = css.indexOf(`${selector} {`);
  expect(start).toBeGreaterThanOrEqual(0);
  return css.slice(start, css.indexOf("}", start));
};

// The "Live duel" pill sits beside the Report bug button (24px high, 12px type), so it must not outgrow it.
describe("live duel pill size", () => {
  it("is as high and as small in type as the Report bug button", () => {
    const pill = rule('.connectionStatus[data-live="true"]');
    expect(pill).toContain("height: 24px;");
    expect(pill).toContain("font-size: 12px;");
    expect(pill).toContain("flex-shrink: 0;");
  });

  it("has a small lamp", () => {
    const dot = rule(".liveDot");
    expect(dot).toContain("width: 6px;");
    expect(dot).toContain("height: 6px;");
  });
});
