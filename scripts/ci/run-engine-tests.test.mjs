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

test("a compact PR shard with no selected files exits without running the smoke pool", () => {
  const result = spawnSync(process.execPath, [new URL("./run-engine-tests.mjs", import.meta.url).pathname, "compact", "10/10"], {
    encoding: "utf8", env: { ...process.env, CI_TEST_FILES: JSON.stringify(["tests/host.test.ts"]), PATH: "/no-npm-available" },
  });
  assert.equal(result.status, 0, result.stderr);
});

test("ten compact PR engine shards plus legacy retain the full file and case inventory", async () => {
  const { duelTestFiles } = await import("./duel-test-files.mjs");
  const { compactEnginePlan, engineMatrix, LEGACY_SHARDS, SURRENDER_FILES, TABLE_FILE, isPinnedFile } =
    await import("./engine-test-plan.mjs");
  const { verifyFiles } = await import("./test-shards.mjs");
  const { engine } = duelTestFiles();
  const plan = compactEnginePlan(engine);
  assert.equal(plan.length + LEGACY_SHARDS, 11);
  assert.deepEqual(engineMatrix(true), plan.map((_, index) => ({ suite: "compact", shard: index + 1, count: 10 })));
  const tasks = plan.flatMap(shard => shard.files).filter(task => task.file !== TABLE_FILE);
  verifyFiles(engine.filter(file => file !== TABLE_FILE && (isPinnedFile(file) || SURRENDER_FILES.includes(file))),
    [...new Set(tasks.map(task => task.file))]);
  for (const file of new Set(tasks.map(task => task.file))) {
    const parts = tasks.filter(task => task.file === file);
    assert.equal(parts.length, parts[0].count, file);
    assert.deepEqual(parts.map(task => task.index).sort((a, b) => a - b), parts.map((_, index) => index), file);
  }
  const table = plan.flatMap(shard => shard.files.filter(task => task.file === TABLE_FILE));
  assert.deepEqual(table.map(task => [task.index, task.count]), plan.map((_, index) => [index, plan.length]));
  const smoke = plan.at(-1);
  assert.equal(smoke.maxWorkers, 1);
  assert.deepEqual(smoke.files.filter(task => task.file !== TABLE_FILE), [
    { file: "tests/new-card-smoke-pool.test.ts", index: 0, count: 1 },
  ]);
  assert.ok(plan.slice(0, -1).every(shard => shard.maxWorkers === 4 &&
    shard.files.every(task => task.file !== "tests/new-card-smoke-pool.test.ts")));
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
