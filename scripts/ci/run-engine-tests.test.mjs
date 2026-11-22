import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

test("an empty dependent web selection exits without falling back to the whole web suite", () => {
  const result = spawnSync(process.execPath, [new URL("./run-engine-tests.mjs", import.meta.url).pathname, "web", "1/1"], {
    encoding: "utf8", env: { ...process.env, CI_TEST_FILES: "[]", PATH: "/no-npm-available" },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stderr, /falling back/);
});

test("dependent web runs require an explicit selection", () => {
  const result = spawnSync(process.execPath, [new URL("./run-engine-tests.mjs", import.meta.url).pathname, "web", "1/1"], {
    encoding: "utf8", env: { ...process.env, CI_TEST_FILES: "" },
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /requires an explicit file selection/);
});

test("shared PR engine shards retain every full-engine file and stay within the runner budget", async () => {
  const { duelTestFiles } = await import("./duel-test-files.mjs");
  const { sharedEnginePlan, SHARED_ENGINE_SHARDS, LEGACY_SHARDS, SURRENDER_FILES, TABLE_FILE, isPinnedFile } = await import("./engine-test-plan.mjs");
  const { verifyFiles } = await import("./test-shards.mjs");
  const { engine } = duelTestFiles();
  const plan = sharedEnginePlan(engine);
  assert.equal(plan.length, SHARED_ENGINE_SHARDS);
  assert.ok(plan.length + LEGACY_SHARDS < 20, "keep shared and legacy engine jobs under 20");
  const tasks = plan.flatMap(shard => shard.files).filter(task => task.file !== TABLE_FILE);
  verifyFiles(engine.filter(file => file !== TABLE_FILE && (isPinnedFile(file) || SURRENDER_FILES.includes(file))),
    [...new Set(tasks.map(task => task.file))]);
  for (const file of new Set(tasks.map(task => task.file))) {
    const parts = tasks.filter(task => task.file === file);
    assert.equal(parts.length, parts[0].count, file);
    assert.deepEqual(parts.map(task => task.index).sort((a, b) => a - b), parts.map((_, index) => index), file);
  }
  for (const [index, shard] of plan.entries()) {
    assert.deepEqual(shard.files.filter(task => task.file === TABLE_FILE), [{ file: TABLE_FILE, index, count: plan.length }]);
  }
});

test("shared engine shards reserve a single Vitest worker for CPU-sensitive worker suites", async () => {
  const { duelTestFiles } = await import("./duel-test-files.mjs");
  const { sharedEnginePlan, TABLE_FILE } = await import("./engine-test-plan.mjs");
  const plan = sharedEnginePlan(duelTestFiles().engine);
  const serial = plan.filter(shard => shard.maxWorkers === 1);
  assert.equal(serial.length, 1);
  assert.deepEqual(serial[0].files.filter(task => task.file !== TABLE_FILE).map(task => task.file).sort(), [
    "tests/engine-resource-cache.test.ts",
    "tests/host-domain-multi-real.test.ts",
    "tests/new-card-smoke-pool.test.ts",
    "tests/replay-worker-real.test.ts",
  ]);
  assert.ok(plan.filter(shard => shard !== serial[0]).every(shard => shard.maxWorkers === 2));
  const estimatedWallTimes = plan.map(shard => shard.seconds / shard.maxWorkers);
  assert.ok(Math.max(...estimatedWallTimes) <= 1.2 * Math.min(...estimatedWallTimes), "balance estimated wall time at each shard's concurrency");
});

test("engine case partitions execute every collected case once, even when titles repeat", async t => {
  const { runEngineCaseShards } = await import("./run-engine-case-shards.mjs");
  const scratch = fileURLToPath(new URL("../../.status", import.meta.url));
  mkdirSync(scratch, { recursive: true });
  const root = mkdtempSync(join(scratch, "engine-case-shards-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const marker = join(root, "ran");
  const file = "cases.test.js";
  const whole = "whole.test.js";
  const sparse = "sparse.test.js";
  writeFileSync(join(root, file), `import { appendFileSync } from 'node:fs';
    for (let i = 0; i < 5; i++) test('case', () => appendFileSync(${JSON.stringify(marker)}, String(i)));
    test.skip('existing skip', () => { throw new Error('must remain skipped'); });`);
  writeFileSync(join(root, whole), `import { appendFileSync } from 'node:fs';
    test('whole file', () => appendFileSync(${JSON.stringify(marker)}, '5'));`);
  writeFileSync(join(root, sparse), `import { appendFileSync } from 'node:fs';
    test('single case', () => appendFileSync(${JSON.stringify(marker)}, '6'));`);
  for (let index = 0; index < 2; index++) {
    const tasks = [file, sparse].map(file => ({ file, index, count: 2 }));
    if (index === 0) tasks.push({ file: whole, index: 0, count: 1 });
    await runEngineCaseShards(root, tasks, { globals: true });
  }
  assert.equal([...readFileSync(marker, "utf8")].sort().join(""), "0123456");
});
