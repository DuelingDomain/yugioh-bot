import Database from "better-sqlite3";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const next = { scripts: "a".repeat(40), database: "b".repeat(40), strings: "c".repeat(40) };
function fixture(changed: boolean) {
  const root = mkdtempSync(join(tmpdir(), "engine-data-finalize-"));
  roots.push(root);
  const data = join(root, "bundle");
  mkdirSync(data);
  writeFileSync(join(root, "update.json"), JSON.stringify({ changed, next, changedPaths: [] }));
  writeFileSync(join(root, "report.md"), "Needs review: 0 conflicts, 0 risks, 0 shared-script changes, probe errors not run, overlay check exit not run\n\nMode: update.\n\n## Core compatibility\n\nPending.\n\n## Deployment\n\nLive-duel and replay warning.\n");
  writeFileSync(join(root, "overlay-exit.txt"), "1\n");
  writeFileSync(join(root, "overlay-check.log"), "overlay drift");
  writeFileSync(join(data, "manifest.json"), JSON.stringify({ sources: next }));
  const run = () => spawnSync(process.execPath, ["--import", "tsx", fileURLToPath(new URL("../scripts/validate-engine-data.ts", import.meta.url))], {
    encoding: "utf8", timeout: 10_000,
    env: { ...process.env, UPDATE_ARTIFACT_DIR: root, DUEL_DATA_DIR: data, DRY_RUN: "true", GITHUB_STEP_SUMMARY: join(root, "summary.md"), GITHUB_REPOSITORY: "test/repo", GITHUB_RUN_ID: "1" },
  });
  return { root, data, run };
}

describe("prepared candidate report", () => {
  it("publishes an unchanged report without requiring bundle data", () => {
    const f = fixture(false);
    const result = f.run();
    expect(result.status, result.stderr).toBe(0);
    const report = readFileSync(join(f.root, "report.md"), "utf8");
    expect(report).toContain("workflow dry run");
    expect(readFileSync(join(f.root, "pr-body.md"), "utf8")).toBe(report);
    expect(readFileSync(join(f.root, "summary.md"), "utf8")).toBe(report);
  });
  it("refuses a prepared bundle that does not match candidate pins", () => {
    const f = fixture(true);
    writeFileSync(join(f.data, "manifest.json"), JSON.stringify({ sources: { ...next, scripts: "d".repeat(40) } }));
    const result = f.run();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Prepared scripts pin differs from candidate");
  });
  it("blocks an incomplete artwork scan while preserving probe and overlay findings", () => {
    const f = fixture(true);
    const result = f.run();
    expect(result.status, result.stderr).toBe(1);
    const report = readFileSync(join(f.root, "report.md"), "utf8");
    expect(report).toContain("BLOCKING: artwork script safety scan failed");
    expect(report).toContain("probe errors 1, overlay check exit 1");
    expect(report).toContain("overlay drift");
    expect(JSON.parse(readFileSync(join(f.root, "probe.json"), "utf8")).errors).toHaveLength(1);
  });
  it("preserves an incomplete scan report when production script errors are available", () => {
    const f = fixture(true);
    const reportPath = join(f.root, "report.md");
    writeFileSync(reportPath, readFileSync(reportPath, "utf8") + "\n## Script errors in prod (last 7 days)\n\nPending.\n");
    writeFileSync(join(f.root, "prod-script-errors.json"), JSON.stringify({ available: true, cards: [
      { code: 10, name: "Dragon", distinctDuels: 3, errorCount: 3, autoBlocked: true, scriptHash: "a".repeat(64) },
    ] }));
    const result = f.run();
    expect(result.status, result.stderr).toBe(1);
    const report = readFileSync(reportPath, "utf8");
    expect(report).toContain("BLOCKING: artwork script safety scan failed");
    expect(report).toContain("probe errors 1, overlay check exit 1");
    expect(report).toContain("overlay drift");
    expect(report).toContain("Dragon");
    expect(report).toContain("Comparison unavailable");
    expect(report).not.toContain("auto block will lift");
    expect(readFileSync(join(f.root, "pr-body.md"), "utf8")).toBe(report);
    expect(readFileSync(join(f.root, "summary.md"), "utf8")).toBe(report);
  });
});

it("writes a blocking report and fails validation for artwork script fallback", () => {
  const f = fixture(true);
  const db = new Database(join(f.data, "cards.cdb"));
  db.exec(`create table datas (id integer primary key, ot integer, alias integer, setcode integer, type integer, atk integer, def integer, level integer, race integer, attribute integer);
    create table texts (id integer primary key, name text, desc text);
    insert into datas values (10,3,0,0,33,1000,1000,4,1,1),(30,3,10,0,33,1000,1000,4,1,1),(12,3,10,0,33,1000,1000,4,1,1);
    insert into texts values (10,'Dragon',''),(30,'Dragon',''),(12,'Dragon','');`); db.close();
  mkdirSync(join(f.data, "card-scripts"));
  writeFileSync(join(f.data, "strings.conf"), "");
  writeFileSync(join(f.data, "card-scripts/c10.lua"), "local s,id=GetID()\nfunction s.initial_effect(c) end");
  const result = f.run();
  expect(result.status, result.stderr).toBe(1);
  const report = readFileSync(join(f.root, "report.md"), "utf8");
  expect(report).toContain("BLOCKING: 1 artwork script fallback");
  expect(report).toContain("c30.lua → c10.lua");
  expect(report).not.toContain("c12.lua"); // within 10 of its main: the core loads c10.lua itself
  expect(report).toContain("GetID()");
  expect(readFileSync(join(f.root, "pr-body.md"), "utf8")).toBe(report);
});
