import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { boundedSmokeComment, mergeSmokeReports, renderSmokeReport, upsertSmokeComment, SMOKE_COMMENT_MARKER } from "./new-card-smoke-report.mjs";

const fixture = () => JSON.parse(readFileSync(new URL("./fixtures/new-card-smoke-shards.json", import.meta.url), "utf8"));
const context = { repository: "owner/repo", number: 7, baseSha: "b".repeat(40), headSha: "a".repeat(40) };
const pull = { state: "open", head: { ref: "chore/engine-data-update", sha: context.headSha, repo: { full_name: context.repository } },
  base: { repo: { full_name: context.repository } } };

test("a FAIL in any fixture shard makes the summary fail even with incompleteness", () => {
  const merged = mergeSmokeReports(fixture(), 2, "failure");
  assert.equal(merged.exitCode, 1);
  assert.equal(merged.status, "FAIL");
  assert.deepEqual(merged.counts, { PASS: 1, WARN: 1, FAIL: 1 });
  const markdown = renderSmokeReport(merged, context, "https://github.com/owner/repo/actions/runs/1");
  assert.match(markdown, /\| PASS \| WARN \| FAIL \|/);
  assert.match(markdown, /\| 1 \| 1 \| 1 \|/);
  assert.match(markdown, /Broken card.*44.*0 of 1.*Lua script error/);
  assert.match(markdown, /Needs \\\| conditions &lt;test&gt;.*43.*1 of 2.*Trigger never ran Needs a ruling/);
  assert.ok(!markdown.includes("Good card"), "details contain only FAIL and WARN");
});
test("incomplete-only fixture merge warns without failing; ordinary WARN exits zero", () => {
  const shards = fixture(); shards[1].cards = [];
  const merged = mergeSmokeReports(shards, 2, "success");
  assert.equal(merged.status, "WARN"); assert.equal(merged.exitCode, 3);
  assert.deepEqual(merged.incompleteCodes, [45]);
  assert.match(renderSmokeReport(merged, context, "run"), /unfinished.*45/i);
  shards[1].incomplete = false; shards[1].incompleteCodes = [];
  assert.equal(mergeSmokeReports(shards, 2, "success").exitCode, 0);
});
test("missing shards and failed infrastructure cannot become a passing report", () => {
  const shards = fixture(); shards[1].cards = []; shards[1].incomplete = false;
  assert.equal(mergeSmokeReports(shards.slice(0, 1), 2, "failure").exitCode, 2);
  assert.equal(mergeSmokeReports(shards, 2, "failure").exitCode, 2);
  for (const change of [s => { s[1].configuration.shard.index = 1; }, s => { s[1].bundleVersion = "other"; },
    s => { s[1].cards = [s[0].cards[0]]; }, s => { s[0].cards[0].status = "INVALID"; }]) {
    const broken = fixture(); change(broken);
    assert.equal(mergeSmokeReports(broken, 2, "success").exitCode, 2);
  }
});
test("large comments keep the marker and counts and link to every row in the full summary", () => {
  const report = mergeSmokeReports(fixture(), 2, "failure");
  const markdown = renderSmokeReport(report, context, "https://github.com/owner/repo/actions/runs/1");
  const shortened = boundedSmokeComment(markdown + "| WARN | big row | " + "x".repeat(65000), "https://github.com/owner/repo/actions/runs/1");
  assert.ok(Buffer.byteLength(shortened) <= 60000);
  assert.ok(shortened.startsWith(SMOKE_COMMENT_MARKER));
  assert.match(shortened, /\| 1 \| 1 \| 1 \|/);
  assert.match(shortened, /Read every FAIL\/WARN.*job summary and artifacts/);
  assert.ok(!shortened.includes("big row"), "truncate at complete table rows");
});
test("sticky comment edits only this bot's marker, including comments after page one", async () => {
  const calls = [];
  const api = async (path, options = {}) => {
    calls.push({ path, ...options });
    if (path.endsWith("/pulls/7")) return pull;
    if (options.method) return {};
    return [{ id: 1, user: { login: "human" }, body: SMOKE_COMMENT_MARKER },
      { id: 2, user: { login: "github-actions[bot]" }, body: "other report" },
      { id: 3, user: { login: "github-actions[bot]" }, body: `${SMOKE_COMMENT_MARKER}\nold` }];
  };
  assert.equal((await upsertSmokeComment(context, `${SMOKE_COMMENT_MARKER}\nnew`, api)).posted, true);
  assert.deepEqual(calls.at(-1), { path: "repos/owner/repo/issues/comments/3", method: "PATCH", body: { body: `${SMOKE_COMMENT_MARKER}\nnew` } });
  assert.equal(calls.filter(call => call.method === "POST").length, 0);
  assert.equal(calls[1].paginate, true);
});
test("first report creates one comment; other branches, forks, closed and stale PRs receive none", async () => {
  for (const current of [pull, { ...pull, state: "closed" }, { ...pull, head: { ...pull.head, ref: "feature" } },
    { ...pull, head: { ...pull.head, sha: "c".repeat(40) } },
    { ...pull, head: { ...pull.head, repo: { full_name: "fork/repo" } } }]) {
    const writes = [];
    const api = async (path, options = {}) => {
      if (options.method) { writes.push(options); return {}; }
      return path.endsWith("/pulls/7") ? current : [];
    };
    const result = await upsertSmokeComment(context, SMOKE_COMMENT_MARKER, api);
    assert.equal(result.posted, current === pull);
    assert.equal(writes.length, current === pull ? 1 : 0);
  }
});

for (const outcome of ["FAIL", "incomplete", "input-error", "context-error"]) test(`report CLI publishes the fixture summary and returns the right CI status (${outcome})`, () => {
  const scratchRoot = fileURLToPath(new URL("../../.status/", import.meta.url));
  mkdirSync(scratchRoot, { recursive: true });
  const scratch = mkdtempSync(join(scratchRoot, "smoke-report-test-"));
  try {
    const directory = join(scratch, "shards"), bin = join(scratch, "bin");
    mkdirSync(directory); mkdirSync(bin);
    const shards = fixture();
    if (outcome === "incomplete") shards[1].cards = [];
    if (!["input-error", "context-error"].includes(outcome)) for (const [index, shard] of shards.entries()) {
      writeFileSync(join(directory, `new-card-smoke-${index + 1}.json`), JSON.stringify(shard));
    }
    // Simulate GitHub's wire responses, including --paginate --slurp and stdin bodies.
    writeFileSync(join(bin, "gh"), `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
if (args.includes('--input')) {
  const body = JSON.parse(fs.readFileSync(0, 'utf8'));
  fs.writeFileSync(process.env.SMOKE_TEST_WRITE, JSON.stringify({args, ...body}));
  process.stdout.write('{}');
} else if (args[1].endsWith('/pulls/7')) process.stdout.write(${JSON.stringify(JSON.stringify(pull))});
else process.stdout.write('[[]]');
`, { mode: 0o755 });
    const summary = join(scratch, "summary.md"), comment = join(scratch, "comment.json");
    const result = spawnSync(process.execPath, [fileURLToPath(new URL("./new-card-smoke-report.mjs", import.meta.url))], {
      cwd: scratch, encoding: "utf8", env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, SMOKE_REPORT_DIR: directory,
        GITHUB_REPOSITORY: context.repository, SMOKE_PR: "7", SMOKE_HEAD: context.headSha, SMOKE_BASE: context.baseSha,
        SMOKE_RESULT: outcome === "incomplete" ? "success" : "failure", SMOKE_SHARD_COUNT: "2",
        SMOKE_CONTEXT_RESULT: outcome === "context-error" ? "failure" : "success",
        GITHUB_STEP_SUMMARY: summary, GITHUB_SERVER_URL: "https://github.com", GITHUB_RUN_ID: "1", SMOKE_TEST_WRITE: comment },
    });
    assert.equal(result.status, outcome === "FAIL" ? 1 : ["input-error", "context-error"].includes(outcome) ? 2 : 0, result.stderr);
    const markdown = readFileSync(summary, "utf8"), posted = JSON.parse(readFileSync(comment, "utf8"));
    assert.equal(posted.body, markdown);
    assert.ok(posted.args.includes("POST"));
    assert.match(markdown, outcome === "FAIL" ? /Result: \*\*FAIL\*\*/ : ["input-error", "context-error"].includes(outcome) ? /Result: \*\*ERROR\*\*/ : /Result: \*\*WARN\*\*/);
    if (outcome === "incomplete") assert.match(result.stdout, /::warning::.*incomplete/);
    if (outcome === "input-error") assert.match(markdown, /Missing shard 1\/2/);
    if (outcome === "context-error") assert.match(markdown, /PR context resolution: failure/);
  } finally { rmSync(scratch, { recursive: true, force: true }); }
});
