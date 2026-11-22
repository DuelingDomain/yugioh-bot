import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { changedLayers } from "./changed-layers.mjs";
import { workspaces } from "./test-areas.mjs";

test("a web push after a cancelled engine push still runs engine and native checks", () => {
  const layers = changedLayers(["packages/web/app/page.tsx"], "push");
  assert.equal(layers.engine, true);
  assert.equal(layers.core, true);
  assert.equal(layers.golden, true);
});

test("main starts the full release gate even with a docs-only diff", () => {
  const layers = changedLayers(["README.md"], "push");
  assert.equal(layers.docs_only, false);
  for (const key of [...Object.keys(workspaces), "e2e", "ci_scripts", "web_build", "effects"]) {
    assert.equal(layers[key], true, key);
  }
});

test("an absent diff leaves the full release gate selected", () => {
  const layers = changedLayers(null, "push");
  for (const flag of ["full", "web_build", "e2e", "vision", "duel_unit", "core", "effects"]) assert.equal(layers[flag], true, flag);
  assert.deepEqual(layers.engine_diff, []);
});

for (const event of ["push", "schedule", "workflow_dispatch"]) {
  test(`${event} CLI selects all groups without git history or a PR proof`, t => {
    const dir = mkdtempSync(join(tmpdir(), "full-ci-"));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const output = join(dir, "outputs");
    const result = spawnSync(process.execPath, [new URL("./changed-layers.mjs", import.meta.url).pathname], {
      cwd: dir, env: { ...process.env, EVENT: event, GITHUB_OUTPUT: output, PATH: "/no-vcs-available" }, encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    const selected = Object.fromEntries(readFileSync(output, "utf8").trim().split("\n").map(line => line.split("=")));
    for (const flag of ["full", "engine", "core", "golden", "web", "effects"]) assert.equal(selected[flag], "true", flag);
    assert.equal(selected.scan, undefined);
    assert.equal(selected.engine_diff, "");
  });
}

test("the Test workflow uses the full main release gate and keeps immutable image proof", () => {
  const workflow = readFileSync(new URL("../../.github/workflows/test.yml", import.meta.url), "utf8");
  assert.doesNotMatch(workflow, /reuse-pr-result|pr-tested-tree|steps\.reuse\.outputs\.engine/);
  assert.match(workflow, /name: Build production image/);
  assert.match(workflow, /uses: \.\/\.github\/actions\/reuse-production-image/);
});
