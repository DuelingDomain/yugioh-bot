import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { parse } from "yaml";

const workflow = parse(readFileSync(new URL("../../.github/workflows/test.yml", import.meta.url), "utf8"));
const evaluate = (expression, needs) => Function("needs", "always", `return (${expression
  .replace(/^\$\{\{\s*|\s*\}\}$/g, "")
  .replace(/needs\.([\w-]+)/g, 'needs["$1"]')});`)(needs, () => true);

for (const [file, jobId, cacheJobId] of [
  ["test.yml", "cores", "core-cache"],
  ["deploy.yml", "deploy", "deploy"],
  ["deploy-staging.yml", "staging", "staging"],
  ["engine-data-update.yml", "prepare"],
]) {
  const data = parse(readFileSync(new URL(`../../.github/workflows/${file}`, import.meta.url), "utf8"));
  test(`${file} builds shared before preparing card data on a fresh checkout`, () => {
    const steps = data.jobs[jobId].steps;
    const prepare = steps.findIndex(step => step.run?.includes("npm run duel:prepare"));
    const build = steps.findIndex(step => /npm run build --workspace=(packages\/shared|@yugidraft\/shared)/.test(step.run ?? ""));
    const install = steps.findIndex(step => step.run?.includes("npm ci"));
    assert.ok(prepare >= 0, "prepares card data");
    assert.ok(build > install && build < prepare, "builds shared after install and before the smoke check imports it");
    if (cacheJobId) assert.equal(steps[build].if, steps[prepare].if, "builds shared whenever a bundle is prepared");
    else assert.ok(build < steps.findIndex(step => step.id === "update"), "builds shared before the weekly updater imports the smoke check too");
  });
  if (cacheJobId) test(`${file} invalidates the bundle when shared duel code or its build inputs change`, () => {
    const key = data.jobs[cacheJobId].steps.find(step => step.name === "Compute bundle cache key");
    for (const input of ["packages/shared/src/duels/**", "packages/shared/package.json", "packages/shared/tsconfig*.json", "tsconfig.json"]) {
      assert.ok(key.run.includes(`'${input}'`), `bundle cache includes ${input}`);
    }
  });
}

test("the required core job runs and fails for failed or cancelled builds on every PR layer", () => {
  const job = workflow.jobs.cores;
  assert.equal(job.name, "Engine cores (build or restore)");
  for (const engine of ["true", "false"]) {
    for (const result of ["failure", "cancelled", "success", "skipped"]) {
      const needs = {
        "core-cache": { result: "success" },
        "core-build": { result },
        changes: { outputs: { engine: engine } },
      };
      assert.equal(evaluate(job.if, needs), true, `core-build=${result}, engine=${engine}`);
      const guard = job.steps[0];
      assert.ok(guard.run, "check build results before checkout or restore");
      const env = Object.fromEntries(Object.entries(guard.env).map(([name, value]) => [name, evaluate(value, needs)]));
      const checked = spawnSync("bash", ["-e", "-o", "pipefail", "-c", guard.run], { env: { ...process.env, ...env }, encoding: "utf8" });
      assert.equal(checked.status, ["success", "skipped"].includes(result) ? 0 : 1, checked.stderr);
      if (["failure", "cancelled"].includes(result)) assert.match(checked.stderr, /core.*(failure|cancelled)/i);
    }
  }
});

test("core cache hits are verified before artifacts are saved or uploaded", () => {
  const steps = workflow.jobs["core-build"].steps;
  const verify = steps.findIndex((step) => step.run?.includes("build-core.sh") && step.run.includes("--verify-only"));
  assert.ok(verify > steps.findIndex((step) => step.id === "core"));
  assert.equal(steps[verify].if, undefined, "verify both freshly built cores and cache hits");
  assert.ok(verify < steps.findIndex((step) => step.uses === "actions/cache/save@v4"));
  assert.ok(verify < steps.findIndex((step) => step.uses === "actions/upload-artifact@v4"));
});

test("bundle cache hits verify the fixed binary pins too", () => {
  const steps = workflow.jobs.cores.steps;
  const verify = steps.find((step) => step.name === "Verify pinned core hashes");
  assert.ok(verify?.run);
  assert.equal(verify.if, undefined);
  assert.match(verify.run, /sha256sum --check/);
});

test("required engine checks include all balanced groups and legacy runs only two shards", () => {
  const engine = workflow.jobs["engine-shards"];
  const matrix = engine.strategy.matrix;
  assert.deepEqual(matrix.suite, ["pinned"]);
  assert.deepEqual(matrix.shard, [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(matrix.count, [6]);
  assert.deepEqual(matrix.include, [
    { suite: "surrender", shard: 1, count: 2 }, { suite: "surrender", shard: 2, count: 2 },
    { suite: "differential", shard: 1, count: 2 }, { suite: "differential", shard: 2, count: 2 },
  ]);
  for (const step of engine.steps.filter((step) => /Web.*engine|Engine smoke/.test(step.name))) {
    assert.match(step.if, /matrix\.suite == 'pinned'/);
    assert.match(step.if, /matrix\.shard == 1/);
  }
  assert.deepEqual(workflow.jobs["engine-legacy-shards"].strategy.matrix.shard, [1, 2]);
  for (const [id, name, shards] of [
    ["engine", "Engine tests (cores required)", "engine-shards"],
    ["engine-legacy", "Engine tests, legacy 1v1 engine (cores required)", "engine-legacy-shards"],
  ]) {
    const job = workflow.jobs[id];
    assert.equal(job.name, name);
    assert.ok(job.needs.includes(shards));
    const guard = job.steps[0];
    for (const result of ["success", "failure", "cancelled", "skipped"]) {
      const env = { ...process.env, CHANGES: "success", REQUIRED: "true", RESULT: result };
      const checked = spawnSync("bash", ["-e", "-o", "pipefail", "-c", guard.run], { env });
      assert.equal(checked.status, result === "success" ? 0 : 1);
    }
  }
});

test("pull requests and main pushes run the engine jobs only when engine=true; unit always runs", () => {
  const run = (id, event, engine) => {
    const expression = workflow.jobs[id].if;
    if (expression === undefined) return true;
    const needs = new Proxy({ changes: { outputs: { engine } } }, { get: (all, name) => all[name] ?? { result: "success" } });
    return Function("needs", "github", "always", "cancelled", `return (${expression
      .replace(/^\$\{\{\s*|\s*\}\}$/g, "")
      .replace(/needs\.([\w-]+)/g, 'needs["$1"]')
      .replace(/==/g, "===").replace(/!=(?!=)/g, "!==")});`)(needs, { event_name: event }, () => true, () => false);
  };
  for (const event of ["pull_request", "push"]) {
    for (const id of ["core-cache", "engine-shards", "engine-legacy-shards", "native", "rule-coverage"]) {
      assert.equal(run(id, event, "true"), true, `${id} ${event} engine=true`);
      assert.equal(run(id, event, "false"), false, `${id} ${event} engine=false`);
    }
    assert.ok(workflow.jobs["core-cache"].needs.includes("changes"));
    for (const id of ["changes", "unit-packages", "unit-web", "unit"]) assert.equal(run(id, event, "false"), true, `${id} ${event}`);
  }
  for (const id of ["core-cache", "native", "rule-coverage"]) assert.equal(run(id, "workflow_dispatch", "true"), true, id);
  assert.equal(run("core-cache", "schedule", "true"), true);
});
