import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

it("anchors the Report bug button at the bottom-right corner, so the shell no longer offsets it past the sidebar", () => {
  const shell = read("../../../src/components/layout/shell.module.css");
  expect(shell).not.toMatch(/bugFab/);
  const place = read("../../../src/components/bug-report/bug-report-fab.tsx");
  expect(place).toContain('"fixed bottom-3 right-3 z-40"');
});

it("gives the chip no left offset or z-index of its own: it sits under the shell's layers by the default z-40", () => {
  const css = read("../../../src/components/bug-report/bug-report.module.css");
  expect(css).not.toMatch(/\bleft:/);
  expect(css).not.toMatch(/z-index/);
});
