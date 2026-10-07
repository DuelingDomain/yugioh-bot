import { describe, expect, it } from "vitest";
import { boundedReport, withValidation } from "../scripts/engine-data-report.js";

const run = "https://github.com/example/repo/actions/runs/123";
describe("engine update report publishing", () => {
  it("keeps the first line and review warnings within the PR body limit", () => {
    const report = "Needs review: 1 conflicts\n" + "card data\n".repeat(10_000) + "\n## Deployment\n\nLive-duel warning; replay loss.\n\n## Golden hashes\n\nRe-record hashes.\n";
    const body = boundedReport(report, run, 60_000);
    expect(Buffer.byteLength(body)).toBeLessThanOrEqual(60_000);
    expect(body.startsWith("Needs review:")).toBe(true);
    expect(body).toContain("replay loss");
    expect(body).toContain("Re-record hashes");
    expect(body).toContain(`${run}#summary`);
    expect(body).toContain(`${run}#artifacts`);
  });
  it("limits multibyte summary bytes below GitHub's 1 MiB maximum", () => {
    const summary = boundedReport("Needs review: 0\n" + "漢".repeat(400_000), run, 1_000_000);
    expect(Buffer.byteLength(summary)).toBeLessThanOrEqual(1_000_000);
    expect(summary).not.toContain("�");
  });
  it("preserves a full report when it fits", () => {
    expect(boundedReport("complete\n", run, 60_000)).toBe("complete\n");
  });
  it("replaces probe results and first-line status after candidate preparation", () => {
    const report = "Needs review: 1 conflicts, 2 risks, 3 shared-script changes, probe errors not run, overlay check exit not run\n\n## Core compatibility\n\nPending.\n\n## Deployment\n\nwarning\n";
    const result = withValidation(report, { errors: ["missing Group.NewApi"], scriptsChecked: 3, apiSymbolsChecked: 4, globalsChecked: 5, cardsChecked: 2 }, 1, "overlay drift");
    expect(result.split("\n")[0]).toBe("Needs review: 1 conflicts, 2 risks, 3 shared-script changes, probe errors 1, overlay check exit 1");
    expect(result).toContain("missing Group.NewApi");
    expect(result).toContain("ocgcore-wasm@0.1.2");
    expect(result).toContain("overlay drift");
    expect(result).not.toContain("Pending.");
  });
});

it("retains blocking artwork findings in bounded reports", () => {
  const report = "BLOCKING: 1 artwork script fallback\n" + "data\n".repeat(20000) + "\n## Artwork script safety\n\nBLOCKING: c11.lua → c10.lua; GetID() differs.\n";
  expect(boundedReport(report, run, 60000)).toContain("c11.lua → c10.lua");
});

it("retains patch review details when the weekly failure summary is truncated", () => {
  const report = "BLOCKING: 1 patch needs review\n" + "data\n".repeat(20000) + "\n## Card script patches\n\n**patch needs review**: official/c3743515.lua; pins unchanged.\n";
  const summary = boundedReport(report, run, 60000);
  expect(summary).toContain("official/c3743515.lua");
  expect(summary).toContain("pins unchanged");
  expect(Buffer.byteLength(summary)).toBeLessThanOrEqual(60000);
});
