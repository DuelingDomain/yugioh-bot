import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(__dirname, "../src/components/duel/room.module.css"), "utf8");
const rule = (selector: string) => {
  const start = css.indexOf(`${selector} {`);
  expect(start).toBeGreaterThanOrEqual(0);
  return css.slice(start, css.indexOf("}", start));
};

const bugCss = readFileSync(join(__dirname, "../src/components/bug-report/bug-report.module.css"), "utf8");

// The "Live duel" pill sits beside the Report bug button (24px high, 12px type), so it must not outgrow it at Medium.
// The table text size (--tt, 1 at Small and Medium) scales the pill's type, as it scales all table UI text.
describe("live duel pill size", () => {
  it("is as high and as small in type as the Report bug button at Medium", () => {
    const pill = rule('.connectionStatus[data-live="true"]');
    expect(pill).toContain("height: 24px;");
    expect(pill).toContain("flex-shrink: 0;");
    // The button's type size, read from its own rule: the pill is that size times --tt, and --tt is 1 at Medium.
    const button = bugCss.match(/height: 24px;[^}]*?font-size: (\d+(?:\.\d+)?px)(?: !important)?;/)?.[1];
    expect(button).toBe("12px");
    expect(pill).toContain(`font-size: calc(${button} * var(--tt, 1));`);
  });

  it("has a small lamp", () => {
    const dot = rule(".liveDot");
    expect(dot).toContain("width: 6px;");
    expect(dot).toContain("height: 6px;");
  });
});
