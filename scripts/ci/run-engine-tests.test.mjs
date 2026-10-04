import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { parse } from "yaml";
import { selectTests } from "./select-engine-tests.mjs";

const runner = new URL("./run-engine-tests.mjs", import.meta.url).pathname;
const workflow = parse(readFileSync(new URL("../../.github/workflows/test.yml", import.meta.url), "utf8"));
const unitStep = workflow.jobs["unit-packages"].steps.find((step) => step.name === "Test duel-server (no core)");
const unitScript = unitStep.run.match(/<<'JS'\n([\s\S]*?)\nJS\n?$/)[1];

// Replace only the npm process boundary: exercise real runner/inline workflow code without loading cores.
const run = (selector, selection) => {
  const root = mkdtempSync(join(tmpdir(), "ci-test-selection-"));
  try {
    mkdirSync(join(root, "bin"));
    const log = join(root, "calls.jsonl");
    writeFileSync(log, "");
    writeFileSync(join(root, "bin/npm"), `#!/usr/bin/env node
require("node:fs").appendFileSync(process.env.CI_TEST_RUN_LOG, JSON.stringify({ args: process.argv.slice(2), tableShard: process.env.TABLE_SHARD }) + "\\n");
`, { mode: 0o755 });
    const env = { ...process.env, PATH: `${join(root, "bin")}:${process.env.PATH}`, CI_TEST_RUN_LOG: log };
    delete env.CI_TEST_FILES;
    delete env.TABLE_SHARD;
    if (selection !== undefined) env.CI_TEST_FILES = JSON.stringify(selection);
    const args = selector === "unit"
      ? ["--input-type=module", "-e", unitScript]
      : [runner, selector, selector === "web" ? "1/1" : "1/6"];
    const result = spawnSync(process.execPath, args, { cwd: root, env, encoding: "utf8" });
    const calls = readFileSync(log, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line));
    return { ...result, calls };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
};

test("empty PR selections fall back to complete pinned, legacy, web and unit suites", () => {
  for (const selector of ["pinned", "legacy", "web", "unit"]) {
    const result = run(selector, []);
    assert.equal(result.status, 0, result.stderr);
    assert.ok(result.calls[0]?.args.includes("tests"), `${selector} must launch its full suite`);
    assert.ok(result.calls.every(({ args }) => !args.includes("--passWithNoTests")));
    assert.match(result.stderr + result.stdout, /empty.*selection.*full suite/i);
    if (selector === "pinned") {
      assert.equal(result.calls.length, 2);
      assert.ok(result.calls[1].args.includes("tests/multi-scripts-table.test.ts"));
      assert.equal(result.calls[1].tableShard, "1/6");
    }
  }
});

test("an untracked computed fixture reader cannot make a tests-only PR silently pass", () => {
  const prefix = "packages/duel-server/tests/";
  const selected = selectTests({
    [prefix + "computed.test.ts"]: 'readFileSync(join(here, "fixtures", `${name}.json`));',
  }, [prefix + "support/fixtures/x/foo.json"]);
  assert.deepEqual(selected, []);
  const result = run("pinned", selected);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.calls[0]?.args.includes("tests"));
  assert.equal(result.calls.length, 2);
});

test("nonempty selections stay narrow, including a Table-only selection", () => {
  for (const selector of ["pinned", "legacy", "web", "unit"]) {
    const result = run(selector, ["tests/selected.test.ts"]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.calls.length, 1);
    assert.ok(result.calls[0].args.includes("tests/selected.test.ts"));
    assert.ok(!result.calls[0].args.includes("tests"));
    assert.ok(result.calls[0].args.includes("--passWithNoTests"));
  }
  const table = run("pinned", ["tests/multi-scripts-table.test.ts"]);
  assert.equal(table.status, 0, table.stderr);
  assert.equal(table.calls.length, 1);
  assert.equal(table.calls[0].tableShard, "1/6");
  assert.ok(!table.calls[0].args.includes("tests"));
});

test("an unset selection still runs full engine/unit suites and requires explicit web selection", () => {
  for (const selector of ["pinned", "legacy", "unit"]) {
    const result = run(selector);
    assert.equal(result.status, 0, result.stderr);
    assert.ok(result.calls[0].args.includes("tests"));
    assert.ok(result.calls.every(({ args }) => !args.includes("--passWithNoTests")));
  }
  assert.notEqual(run("web").status, 0);
});
