import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { balanceFiles, runVitestShard, verifyFiles } from "./test-shards.mjs";
import { WEB_DATA_SHARDS, WEB_FULL_SHARDS, WEB_TIMING_LANE } from "./web-test-plan.mjs";

test("places the longest files first and uses a default for new files", () => {
  assert.deepEqual(balanceFiles(["short", "long", "medium", "new"], 2, {
    short: 1, long: 11, medium: 7,
  }, 5).map(shard => shard.files), [["long", "short"], ["medium", "new"]]);
});

test("preserves a stable plan across inventory orders and accounts for work outside Vitest", () => {
  const expected = [["b", "d"], ["a", "c"]];
  for (const files of [["a", "b", "c", "d"], ["d", "b", "a", "c"]]) {
    assert.deepEqual(balanceFiles(files, 2, {}, 4, [3, 0]).map(shard => shard.files), expected);
  }
});

test("rejects omitted, duplicated and unexpected report files", () => {
  verifyFiles(["b", "a"], ["a", "b"]);
  assert.throws(() => verifyFiles(["a", "b"], ["a"]), /missing: b/);
  assert.throws(() => verifyFiles(["a", "b"], ["a", "b", "b"]), /duplicate: b/);
  assert.throws(() => verifyFiles(["a", "b"], ["a", "c"]), /unexpected: c/);
});

const root = fileURLToPath(new URL("../../", import.meta.url));
test("web matrix covers the data shards and the full or PR-selected shard list", () => {
  assert.equal(WEB_FULL_SHARDS, 3);
  const { jobs } = parse(readFileSync(join(root, ".github/workflows/test.yml"), "utf8"));
  const { shard } = jobs["unit-web"].strategy.matrix;
  const indices = size => Array.from({ length: size }, (_, index) => index + 1);
  const values = expression => [...expression.matchAll(/'(\[[\d,]+\])'/g)].map(([, json]) => JSON.parse(json));
  assert.deepEqual(values(shard), [indices(WEB_DATA_SHARDS)]);
  assert.match(shard, /needs\.changes\.outputs\.web_shards/);
  assert.deepEqual(values(jobs.changes.outputs.web_shards), [indices(WEB_FULL_SHARDS)]);
  assert.match(jobs["unit-web"].name, /strategy\.job-total/);
  const artifact = jobs["unit-web"].steps.find(step => step.name === "Upload web file timings").with;
  const fullName = value => value.replace("${{ strategy.job-total }}", WEB_FULL_SHARDS).replace("${{ matrix.shard }}", 1);
  assert.equal(fullName(artifact.name), `test-timings-${WEB_TIMING_LANE}-1`);
  assert.ok(fullName(artifact.path).endsWith(`/test-timings/${WEB_TIMING_LANE}-1.json`));
});

test("Vitest reports completed files, including files with intentionally skipped cases", async t => {
  const scratch = join(root, ".status");
  mkdirSync(scratch, { recursive: true });
  const directory = mkdtempSync(join(scratch, "test-shards-test-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const config = join(directory, "vitest.config.mjs");
  writeFileSync(config, `export default { root: ${JSON.stringify(directory)}, test: { globals: true } };\n`);
  writeFileSync(join(directory, "pass.test.js"), 'test("pass", () => expect(1).toBe(1));\n');
  writeFileSync(join(directory, "skip.test.js"), 'test.skip("skip", () => {});\n');
  const file = name => relative(join(root, "packages/web"), join(directory, name));
  const reports = await runVitestShard("web", [file("pass.test.js"), file("skip.test.js")], [`--config=${config}`]);
  assert.ok(reports.every(({ seconds }) => Number.isFinite(seconds) && seconds >= 0));
  await assert.rejects(runVitestShard("web", [file("pass.test.js"), file("absent.test.js")], [`--config=${config}`]), /missing: .*absent\.test\.js/);
});
