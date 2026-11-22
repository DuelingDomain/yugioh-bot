import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { resolveTrustedPrs } from "./trusted-pr-gate.mjs";

const base = "a".repeat(40);
const head = "b".repeat(40);
const prHead = "c".repeat(40);
const earlierMerge = "d".repeat(40);
const earlierHead = "e".repeat(40);
const repository = { id: 123, owner: { login: "DuelingDomain" } };
const mergedAt = "2026-11-22T12:00:00Z";
const beforeMerge = "2026-11-22T11:59:00Z";
const testFile = "packages/duel-server/src/engine.ts";
const oldPath = "packages/duel-server/src/engine-old.ts";
const tree = "f".repeat(40);
const diffHash = createHash("sha256").update(JSON.stringify([oldPath, testFile])).digest("hex");
const commit = (sha, ...parents) => ({ sha, parents: parents.map(sha => ({ sha })) });
const pr = (number, merge, sha) => ({
  number, merged_at: mergedAt, merge_commit_sha: merge,
  base: { ref: "main", repo: repository }, head: { ref: `engine-${number}`, sha, repo: repository },
});
const run = (pull, overrides = {}) => ({
  id: pull.number * 10, name: "Test", path: ".github/workflows/test.yml", event: "pull_request",
  head_sha: pull.head.sha, head_branch: pull.head.ref, head_repository: repository, repository,
  pull_requests: [{ number: pull.number }], run_number: pull.number,
  status: "completed", conclusion: "success", run_attempt: 2, ...overrides,
});
const jobs = [{ name: "CI result", conclusion: "success", completed_at: beforeMerge }];

function evaluate({ history = [commit(prHead, base), commit(head, base, prHead)], prs = [pr(7, head, prHead)], headPrs = prs,
  runs = prs.map(pull => run(pull)), artifacts = [], proof, ciJobs = jobs, failedApi, baseline = base,
  mergedFiles = [{ filename: testFile, previous_filename: oldPath }] } = {}) {
  const api = path => {
    if (failedApi && path.startsWith(failedApi)) throw new Error("GitHub API unavailable");
    if (path.startsWith("compare/") && path.endsWith("per_page=1")) return [{ status: "ahead", files: mergedFiles }];
    if (path.startsWith("compare/")) return [{ status: "ahead", total_commits: history.length, commits: history }];
    if (path.startsWith("commits/")) return [prs.filter(pull => pull.merge_commit_sha === path.split("/")[1])];
    if (path.startsWith("actions/workflows/test.yml/runs?")) {
      const sha = new URLSearchParams(path.split("?")[1]).get("head_sha");
      const matching = runs.filter(run => run.head_sha === sha);
      return [{ total_count: matching.length, workflow_runs: matching }];
    }
    if (/\/attempts\/2\/jobs\?/.test(path)) return [{ total_count: ciJobs.length, jobs: ciJobs }];
    if (path.includes("/artifacts?")) return [{ total_count: artifacts.length, artifacts }];
    if (path.startsWith("pulls?state=all&head=DuelingDomain%3Aengine-7&")) return [headPrs];
    if (path.startsWith("pulls/")) return [[{ filename: testFile, previous_filename: oldPath }]];
    assert.fail(`Unexpected API request: ${path}`);
  };
  return resolveTrustedPrs({ api, downloadProof: () => proof, base: baseline, head, repoId: repository.id });
}

test("green final head with a passing CI result uses the fast path without a recorded proof", () => {
  const result = evaluate();
  assert.equal(result.trusted, true);
  assert.match(result.entries[0], /PR #7.*trusted.*Test run 70.*no selection proof/i);
});

test("GitHub can omit PR links on historical runs for a merged head", () => {
  const pull = pr(7, head, prHead);
  const runs = [run(pull, { pull_requests: [] })];
  assert.equal(evaluate({ runs }).trusted, true);
  assert.equal(evaluate({ runs: [run(pull, { pull_requests: [], head_branch: "another-branch" })] }).trusted, false);
  assert.equal(evaluate({ runs, headPrs: [pull, { ...pull, number: 8, base: { ref: "another-base" } }] }).trusted, false);
  assert.equal(evaluate({ runs, failedApi: "pulls?" }).trusted, false);
});

test("a recorded PR proof must cover the merged PR's changed paths and the successful attempt", () => {
  const artifacts = [{ id: 42, name: `pr-tested-tree-${tree}`, expired: false }];
  const proof = { tree, parent: base, diffHash, attempt: "2" };
  assert.equal(evaluate({ artifacts, proof }).trusted, true);
  assert.equal(evaluate({ artifacts, proof: { ...proof, diffHash: "0".repeat(64) } }).trusted, false);
  assert.equal(evaluate({ artifacts, proof: { ...proof, attempt: "1" } }).trusted, false);
  const extra = evaluate({ artifacts, proof, mergedFiles: [{ filename: "uncovered-engine.ts" }] });
  assert.equal(extra.trusted, false);
  assert.match(extra.entries[0], /outside the PR selection proof/i);
});

test("direct pushes and commits merely associated with a PR use the full path", () => {
  for (const prs of [[], [pr(7, earlierMerge, prHead)]]) {
    const result = evaluate({ prs });
    assert.equal(result.trusted, false);
    assert.match(result.entries[0], /no merged PR/i);
  }
  assert.equal(evaluate({ history: [commit(head, base)], prs: [pr(7, head, head)] }).trusted, false);
  assert.equal(evaluate({ history: [commit(head, base)] }).trusted, true);
});

test("a red latest Test run uses the full path even if an older run was green", () => {
  const pull = pr(7, head, prHead);
  const result = evaluate({ runs: [run(pull), run(pull, { run_number: 8, conclusion: "failure" })] });
  assert.equal(result.trusted, false);
  assert.match(result.entries[0], /PR #7.*failure/i);
});

test("green runs need a passing CI result from before the merge", () => {
  for (const ciJobs of [
    [], [{ ...jobs[0], conclusion: "failure" }], [{ ...jobs[0], completed_at: mergedAt }],
    [{ ...jobs[0], completed_at: "2026-11-22T12:01:00Z" }],
  ]) assert.equal(evaluate({ ciJobs }).trusted, false);
});

test("a fork, outdated head, or run for a different PR uses the full path", () => {
  const pull = pr(7, head, prHead);
  assert.equal(evaluate({ prs: [{ ...pull, head: { ...pull.head, repo: { id: 456 } } }] }).trusted, false);
  assert.equal(evaluate({ runs: [run(pull, { head_sha: earlierHead })] }).trusted, false);
  assert.equal(evaluate({ runs: [run(pull, { pull_requests: [{ number: 8 }] })] }).trusted, false);
});

test("API errors and missing deployed baselines use the full path", () => {
  for (const failedApi of ["compare/", "commits/", "actions/workflows/", "actions/runs/", "actions/runs/70/artifacts"]) {
    const result = evaluate({ failedApi });
    assert.equal(result.trusted, false);
    assert.match(result.entries.join("\n"), /GitHub API unavailable/);
  }
  assert.equal(evaluate({ baseline: "" }).trusted, false);
});

test("every first-parent commit must be backed by a green same-repo PR", () => {
  const history = [commit(earlierHead, base), commit(earlierMerge, base, earlierHead),
    commit(prHead, base), commit(head, earlierMerge, prHead)];
  const pull = pr(7, head, prHead);
  const prior = pr(6, earlierMerge, earlierHead);
  assert.equal(evaluate({ history, prs: [prior, pull] }).trusted, true);
  const mixed = evaluate({ history, prs: [prior, pull], runs: [run(prior, { conclusion: "failure" }), run(pull)] });
  assert.equal(mixed.trusted, false);
  assert.match(mixed.entries.join("\n"), /PR #6.*failure[\s\S]*PR #7.*trusted/i);
  assert.equal(evaluate({ history, prs: [pull] }).trusted, false);
});

test("a baseline reached only through a side parent uses the full path", () => {
  assert.equal(evaluate({ history: [commit(prHead, base), commit(head, earlierMerge, prHead)] }).trusted, false);
});
