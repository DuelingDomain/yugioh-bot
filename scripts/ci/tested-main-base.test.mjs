import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { changedLayers } from "./changed-layers.mjs";
import { deployedCommit, resolveTestedMainBase } from "./tested-main-base.mjs";
import { findReusableRun } from "./reuse-pr-result.mjs";

const base = "a".repeat(40);
const head = "b".repeat(40);
const workflowRevision = "c".repeat(40);
const deployRun = { id: 10, run_attempt: 1, event: "workflow_run",
  display_title: `Deploy ${base} (Test success)`, head_sha: workflowRevision, status: "completed",
  updated_at: "2026-11-22T12:00:00Z" };
const healthy = [{ name: "Deploy to Production VM",
  steps: [{ name: "Deploy over SSH", conclusion: "success" }] }];

test("a superseded or failed Deploy cannot become a baseline", () => {
  for (const conclusion of ["skipped", "failure", "cancelled"]) {
    const jobs = [{ name: "Deploy to Production VM", steps: [{ name: "Deploy over SSH", conclusion }] }];
    assert.equal(deployedCommit(deployRun, jobs), undefined);
  }
  assert.equal(deployedCommit(deployRun, healthy), base);
  assert.equal(deployedCommit({ ...deployRun, display_title: `Deploy ${base} (Test failure)` }, healthy), "");
});

test("manual rollback and symbolic refs resolve to the actual deployment SHA", () => {
  const manual = { ...deployRun, event: "workflow_dispatch", display_title: "Deploy main", run_attempt: 2 };
  const artifacts = [
    { name: `production-deployed-${workflowRevision}-1` },
    { name: `production-deployed-${base}-2` },
  ];
  assert.equal(deployedCommit(manual, healthy, artifacts), base);
  assert.equal(deployedCommit(manual, healthy, artifacts.slice(0, 1)), "");
  assert.equal(deployedCommit({ ...manual, display_title: `Deploy ${base}` }, healthy), base);
});

test("baseline lookup uses the latest confirmed deployment and fetches only a verified ancestor", () => {
  const getBase = (status, manual = false, newerJobs = []) => {
    const newer = { ...deployRun, id: 11, status: "in_progress", display_title: `Deploy ${workflowRevision} (Test success)`,
      updated_at: "2026-11-22T12:10:00Z" };
    const runs = [deployRun, manual ? { ...newer, event: "workflow_dispatch", display_title: "Deploy main" } : newer];
    const replies = new Map([
      ["actions/workflows/deploy.yml/runs?branch=main&per_page=20", { workflow_runs: runs }],
      ["actions/runs/11/attempts/1/jobs?per_page=100", { jobs: manual ? healthy : newerJobs }],
      ["actions/runs/11/artifacts?per_page=100", { artifacts: [] }],
      ["actions/runs/10/attempts/1/jobs?per_page=100", { jobs: healthy }],
      [`compare/${base}...${head}?per_page=1`, { status }],
      [`compare/${workflowRevision}...${head}?per_page=1`, { status }],
    ]);
    const fetched = [];
    const result = resolveTestedMainBase(path => {
      assert.ok(replies.has(path), path);
      return replies.get(path);
    }, head, sha => fetched.push(sha));
    return { result, fetched };
  };
  assert.deepEqual(getBase("ahead"), { result: base, fetched: [base] });
  assert.deepEqual(getBase("diverged"), { result: "", fetched: [] });
  assert.deepEqual(getBase("ahead", true), { result: "", fetched: [] });
  assert.deepEqual(getBase("ahead", false, healthy), { result: workflowRevision, fetched: [workflowRevision] });
});

test("PR proof requires the same tree, deployed parent, changed paths and successful Test attempt", () => {
  const selection = { tree: head, parent: base, diffHash: "d".repeat(64) };
  const name = `pr-tested-tree-${head}`;
  const artifact = { id: 8, name, workflow_run: { id: 9 } };
  const run = { id: 9, path: ".github/workflows/test.yml", event: "pull_request", conclusion: "success",
    head_repository: { id: 1 }, repository: { id: 1 }, run_attempt: 2 };
  const proof = { ...selection, attempt: "2" };
  const reuse = (source = run, signed = proof, entry = artifact) => findReusableRun(path => {
    if (path === `actions/artifacts?name=${name}&per_page=20`) return { artifacts: [entry] };
    assert.equal(path, "actions/runs/9");
    return source;
  }, id => {
    assert.equal(id, 8);
    return signed;
  }, selection);
  assert.equal(reuse(), 9);
  for (const source of [
    { ...run, path: ".github/workflows/full-suite.yml" }, { ...run, event: "push" },
    { ...run, conclusion: "failure" }, { ...run, head_repository: { id: 2 } },
    { ...run, run_attempt: 3 },
  ]) assert.equal(reuse(source), undefined);
  for (const key of Object.keys(selection)) assert.equal(reuse(run, { ...proof, [key]: workflowRevision }), undefined);
  assert.equal(reuse(run, proof, { ...artifact, expired: true }), undefined);
});

test("CI-only and docs-only main pushes use the same layers as PRs", () => {
  for (const files of [["README.md"], [".github/workflows/test.yml", "scripts/ci/changed-layers.mjs"]]) {
    const layers = changedLayers(files, "push");
    assert.deepEqual(layers, changedLayers(files, "pull_request"));
    assert.equal(layers.full, false);
    assert.equal(layers.engine, false);
    assert.equal(layers.core, false);
  }
});

test("an absent diff leaves the full release gate selected", () => {
  const layers = changedLayers(null, "push");
  for (const flag of ["full", "web_build", "e2e", "vision", "duel_unit", "core", "effects"]) assert.equal(layers[flag], true, flag);
  assert.deepEqual(layers.engine_diff, []);
});

for (const event of ["push", "full_suite", "schedule", "workflow_dispatch"]) {
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

test("the Test workflow resolves a deployed baseline and preserves both proofs", () => {
  const workflow = readFileSync(new URL("../../.github/workflows/test.yml", import.meta.url), "utf8");
  assert.match(workflow, /node scripts\/ci\/tested-main-base\.mjs/);
  assert.match(workflow, /node scripts\/ci\/reuse-pr-result\.mjs/);
  assert.match(workflow, /pr-tested-tree-/);
  assert.match(workflow, /name: Build production image/);
  assert.match(workflow, /uses: \.\/\.github\/actions\/reuse-production-image/);
});
