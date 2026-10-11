import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { parse } from "yaml";
import { changedLayers } from "./changed-layers.mjs";

const workflow = parse(readFileSync(new URL("../../.github/workflows/test.yml", import.meta.url), "utf8"));
test("overlapping same-head bot PR/dispatch runs share a serial gate; other runs keep their groups", () => {
  const head = "a".repeat(40), next = "b".repeat(40);
  const bot = sha => ({ head: { sha, ref: "chore/engine-data-update", repo: { full_name: "owner/repo" } } });
  const evaluate = (template, github, inputs) => {
    const expression = value => Function("github", "inputs", "format", `return (${value})`)(github, inputs,
      (pattern, ...args) => pattern.replace(/\{(\d+)\}/g, (_match, index) => args[Number(index)]));
    if (template.startsWith("${{") && template.endsWith("}}")) return expression(template.slice(3, -2));
    return template.replace(/\$\{\{([\s\S]*?)\}\}/g, (_match, value) => expression(value));
  };
  const fixture = [
    { event_name: "pull_request", event: { pull_request: bot(head) }, sha: "merge", ref: "refs/pull/7/merge" },
    // GitHub expression contexts return null for absent PR fields on dispatch.
    { event_name: "workflow_dispatch", event: { pull_request: { head: {} } }, sha: head, ref: "refs/heads/chore/engine-data-update" },
  ].map(event => ({ ...event, workflow: "Test", repository: "owner/repo" }));
  const groups = fixture.map(event => evaluate(workflow.concurrency.group, event, { new_card_smoke: true }));
  assert.equal(groups[0], groups[1], "same-head PR/dispatch cannot race their final commit-status writes");
  for (const event of fixture) assert.equal(evaluate(workflow.concurrency["cancel-in-progress"], event, { new_card_smoke: true }), false);
  assert.notEqual(evaluate(workflow.concurrency.group, { ...fixture[0], event: { pull_request: bot(next) } }, {}), groups[0]);
  const main = { ...fixture[1], event_name: "push", ref: "refs/heads/main" };
  const nightly = { ...main, event_name: "schedule" };
  assert.notEqual(evaluate(workflow.concurrency.group, main, {}), evaluate(workflow.concurrency.group, nightly, {}));
  assert.equal(evaluate(workflow.concurrency["cancel-in-progress"], { ...fixture[0], event: { pull_request: { head: { ref: "feature" } } } }, {}), true);
});
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
  assert.ok(job.needs.includes("new-card-smoke-status-pending"));
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
  assert.match(report.if, /always\(\)/);
  assert.match(report.if, /pull_request.*chore\/engine-data-update/);
  assert.ok(!report.if.includes("smoke_enabled"), "resolver failure must not skip the report");
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
test("a status bridge preserves the required gate on GITHUB_TOKEN dispatch and holds it pending first", () => {
  for (const id of ["new-card-smoke-status-pending", "new-card-smoke-status"]) {
    const job = workflow.jobs[id];
    assert.equal(job.permissions.statuses, "write");
    assert.equal(job.permissions["pull-requests"], undefined);
    assert.match(job.if, /chore\/engine-data-update/);
    assert.match(job.if, /workflow_dispatch/);
    assert.ok(job.steps.some(step => step.run?.includes("new-card-smoke-status.mjs")));
  }
  assert.ok(workflow.jobs["new-card-smoke-status"].needs.includes("new-card-smoke-report"));
  assert.ok(workflow.jobs.engine.needs.includes("new-card-smoke-report"));
});
test("the existing required engine aggregate fails for a failed smoke report", () => {
  const run = workflow.jobs.engine.steps[0].run;
  for (const smoke of ["success", "failure", "cancelled", "skipped"]) {
    const result = spawnSync("bash", ["-e", "-o", "pipefail", "-c", run], { encoding: "utf8",
      env: { ...process.env, CHANGES: "success", REQUIRED: "true", RESULT: "success", SMOKE_REPORT: smoke } });
    assert.equal(result.status, ["success", "skipped"].includes(smoke) ? 0 : 1);
  }
});
test("report and status gates select only the bot PR even if the resolver fails", () => {
  const bot = { head: { ref: "chore/engine-data-update", repo: { full_name: "owner/repo" } } };
  for (const id of ["new-card-smoke-report", "new-card-smoke-status-pending", "new-card-smoke-status"]) {
    const expression = workflow.jobs[id].if;
    const run = (event, pull, input = false, ref = "refs/heads/main") => Function("github", "inputs", "always", `return (${expression})`)(
      { event_name: event, event: { pull_request: pull }, repository: "owner/repo", ref }, { new_card_smoke: input }, () => true);
    assert.equal(run("pull_request", bot), true);
    assert.equal(run("pull_request", { head: { ...bot.head, ref: "feature" } }), false);
    assert.equal(run("pull_request", { head: { ...bot.head, repo: { full_name: "fork/repo" } } }), false);
    assert.equal(run("workflow_dispatch", undefined, true, "refs/heads/chore/engine-data-update"), true);
    assert.equal(run("workflow_dispatch", undefined, false, "refs/heads/chore/engine-data-update"), false);
    assert.equal(run("workflow_dispatch", undefined, true, "refs/heads/main"), false);
    assert.equal(run("schedule", undefined), false);
  }
});
