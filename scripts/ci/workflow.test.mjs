import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { parse } from "yaml";

const workflow = parse(readFileSync(new URL("../../.github/workflows/test.yml", import.meta.url), "utf8"));
const evaluate = (expression, needs) => Function("needs", "always", `return (${expression
  .replace(/^\$\{\{\s*|\s*\}\}$/g, "")
  .replace(/needs\.([\w-]+)/g, 'needs["$1"]')});`)(needs, () => true);

test("the required core job runs and fails for failed or cancelled builds on every PR layer", () => {
  const job = workflow.jobs.cores;
  assert.equal(job.name, "Engine cores (build or restore)");
  for (const webEngine of ["true", "false"]) {
    for (const result of ["failure", "cancelled", "success", "skipped"]) {
      const needs = {
        "core-cache": { result: "success" },
        "core-build": { result },
        changes: { outputs: { web_engine: webEngine } },
      };
      assert.equal(evaluate(job.if, needs), true, `core-build=${result}, web_engine=${webEngine}`);
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
