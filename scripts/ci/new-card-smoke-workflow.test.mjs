import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { parse } from "yaml";
import { changedLayers } from "./changed-layers.mjs";

const workflow = parse(readFileSync(new URL("../../.github/workflows/test.yml", import.meta.url), "utf8"));
test("changes to the shared engine setup action run engine checks", () => {
  for (const event of ["pull_request", "push"]) {
    assert.equal(changedLayers([".github/actions/restore-engine-bundle/action.yml"], event).engine, true);
  }
});
test("bot smoke uses four shards and the existing core pipeline", () => {
  const job = workflow.jobs["new-card-smoke"];
  assert.deepEqual(job.strategy.matrix.shard, [1, 2, 3, 4]);
  assert.equal(job.strategy["fail-fast"], false);
  assert.ok(job.needs.includes("cores"));
  assert.match(job.if, /smoke_enabled == 'true'/);
  assert.equal(workflow.on.workflow_dispatch.inputs.new_card_smoke.default, false);
  const setup = job.steps.find(step => step.uses === "./.github/actions/restore-engine-bundle");
  assert.equal(setup.with.key, "${{ needs.cores.outputs.key }}");
  for (const id of ["engine-shards", "engine-legacy-shards"]) {
    assert.ok(workflow.jobs[id].steps.some(step => step.uses === setup.uses));
  }
  const run = job.steps.find(step => step.id === "smoke");
  assert.match(run.run, /--from-pin "\$SMOKE_BASE" --to-pin "\$SMOKE_HEAD"/);
  assert.match(run.run, /--shard "\$SMOKE_SHARD\/4"/);
  const upload = job.steps.find(step => step.uses === "actions/upload-artifact@v4");
  assert.equal(upload.if, "always()");
  assert.match(upload.with.path, /\.json/); assert.match(upload.with.path, /\.md/);
});
test("runner exits 0/3 pass, exits 1/2 fail with clear annotations", () => {
  const run = workflow.jobs["new-card-smoke"].steps.find(step => step.id === "smoke").run;
  // Execute the actual workflow shell with a stub runner to verify bash's -e behavior.
  for (const code of [0, 1, 2, 3, 4]) {
    const start = run.indexOf("prlimit --core=0 -- node --import tsx");
    const end = run.indexOf(" || result=$?", start);
    assert.ok(start >= 0 && end > start);
    const script = run.slice(0, start) + `bash -c 'exit ${code}'` + run.slice(end);
    assert.ok(!script.includes("node --import tsx"), "replace the runner, leaving the real exit-code handling");
    const result = spawnSync("bash", ["-e", "-o", "pipefail", "-c", script], { encoding: "utf8" });
    assert.equal(result.status, [0, 3].includes(code) ? 0 : code);
    if (code === 3) assert.match(result.stdout, /::warning::.*incomplete/i);
    if (code === 2) assert.match(result.stdout, /::error::.*input.*download/i);
    if (code === 1) assert.match(result.stdout, /::error::.*FAIL/);
  }
});
test("only the always-run bot report can write PR comments", () => {
  const report = workflow.jobs["new-card-smoke-report"];
  assert.match(report.if, /always\(\).*smoke_enabled == 'true'/);
  assert.ok(report.needs.includes("new-card-smoke"));
  assert.equal(report.permissions["pull-requests"], "write");
  assert.equal(report.permissions.contents, "read");
  assert.equal(report.concurrency["cancel-in-progress"], false);
  assert.match(report.concurrency.group, /smoke_pr/);
  for (const [id, job] of Object.entries(workflow.jobs)) if (id !== "new-card-smoke-report") {
    assert.notEqual(job.permissions?.["pull-requests"], "write");
  }
  assert.ok(report.steps.find(step => step.run?.includes("new-card-smoke-report.mjs")));
});
