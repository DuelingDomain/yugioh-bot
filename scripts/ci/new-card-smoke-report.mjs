/** Merge runner JSON and publish one guarded sticky PR comment. Node builtins only. */
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { isSmokePull } from "./new-card-smoke-context.mjs";

export const SMOKE_COMMENT_MARKER = "<!-- new-card-smoke-report -->";
const cell = value => String(value).replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/[\r\n]+/g, " ")
  .replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/@/g, "&#64;").replace(/[\[\]`*_]/g, "\\$&");
const passcode = code => Number.isSafeInteger(code) && code > 0 && code <= 0xffffffff;

export function mergeSmokeReports(reports, shardCount, shardResult) {
  const cards = [], errors = [], indices = new Set(), codes = new Set(), incompleteCodes = new Set();
  let incomplete = false;
  for (const report of reports) {
    try {
      const shard = report?.configuration?.shard;
      if (!Number.isSafeInteger(shard?.index) || shard.index < 1 || shard.index > shardCount
          || shard.count !== shardCount || indices.has(shard.index)) throw new Error("Invalid or duplicate shard index/count");
      if (typeof report.bundleVersion !== "string" || !report.bundleVersion || report.bundleVersion !== reports[0].bundleVersion
          || JSON.stringify(report.sources) !== JSON.stringify(reports[0].sources)) throw new Error("Shard bundle/pins do not match");
      if (!Array.isArray(report.cards)) throw new Error("Missing shard cards");
      for (const card of report.cards) {
        if (!passcode(card.code) || codes.has(card.code) || !["PASS", "WARN", "FAIL"].includes(card.status)
            || typeof card.name !== "string" || typeof card.reason !== "string"
            || !Number.isSafeInteger(card.coverage?.resolved) || !Number.isSafeInteger(card.coverage?.total)
            || card.coverage.resolved < 0 || card.coverage.resolved > card.coverage.total) throw new Error("Invalid or duplicate card result/coverage");
        codes.add(card.code); cards.push(card);
      }
      for (const code of report.incompleteCodes ?? []) {
        if (!passcode(code)) throw new Error("Invalid unfinished passcode");
        incompleteCodes.add(code);
      }
      incomplete ||= report.incomplete === true;
      indices.add(shard.index);
    } catch (error) { errors.push(error.message); }
  }
  for (let index = 1; index <= shardCount; index++) if (!indices.has(index)) errors.push(`Missing shard ${index}/${shardCount}`);
  if (shardResult !== "success" && !cards.some(card => card.status === "FAIL")) errors.push(`Smoke jobs: ${shardResult}; inspect the shard/core logs for input, download or infrastructure errors`);
  const counts = Object.fromEntries(["PASS", "WARN", "FAIL"].map(status => [status, cards.filter(card => card.status === status).length]));
  const exitCode = errors.length ? 2 : counts.FAIL ? 1 : incomplete ? 3 : 0;
  return { cards: cards.sort((a, b) => a.code - b.code), counts, errors, incomplete, incompleteCodes: [...incompleteCodes].sort((a, b) => a - b),
    exitCode, status: exitCode === 2 ? "ERROR" : exitCode === 1 ? "FAIL" : incomplete || counts.WARN ? "WARN" : "PASS",
    bundleVersion: reports[0]?.bundleVersion ?? "unavailable", shards: indices.size, shardCount };
}

export function renderSmokeReport(report, context, runUrl) {
  return [SMOKE_COMMENT_MARKER, "## New card engine smoke", "", `Result: **${report.status}**. Shards: ${report.shards}/${report.shardCount}.`,
    `Head: \`${context.headSha}\`. Base: \`${context.baseSha}\`.`, `[Workflow and reports](${runUrl}) · [Artifacts](${runUrl}#artifacts)`, "",
    "| PASS | WARN | FAIL |", "| --- | --- | --- |", `| ${report.counts.PASS} | ${report.counts.WARN} | ${report.counts.FAIL} |`, "",
    ...report.errors.map(error => `- ERROR: ${cell(error)}`),
    ...(report.incomplete ? [`WARNING: time budget reached; unfinished passcodes: ${report.incompleteCodes.join(", ") || "see shard JSON"}.`, ""] : []),
    "Coverage is the minimum number of resolved registered effects/branches across tested cores/formats. Zero of zero means no activated inventory was recorded; read the reason.",
    "Review each WARN for unmet conditions or unresolved branches. Add an exact ruling scenario when needed. Passive effects and card rulings need separate tests.", "",
    "| Status | Card | Passcode | Effects (k of n) | Reason |", "| --- | --- | --- | --- | --- |",
    ...report.cards.filter(card => card.status !== "PASS").map(card => `| ${card.status} | ${cell(card.name)} | ${card.code} | ${card.coverage.resolved} of ${card.coverage.total} | ${cell(card.reason)} |`), ""].join("\n");
}

export function boundedSmokeComment(markdown, runUrl, limit = 60000) {
  if (Buffer.byteLength(markdown) <= limit) return markdown;
  const suffix = `\n\nReport shortened to fit the comment limit. Read every FAIL/WARN in the [job summary and artifacts](${runUrl}).\n`;
  const lines = [];
  for (const line of markdown.split("\n")) {
    if (Buffer.byteLength([...lines, line].join("\n") + suffix) > limit) break;
    lines.push(line);
  }
  return lines.join("\n") + suffix;
}

export async function upsertSmokeComment(context, body, api) {
  const root = `repos/${context.repository}`;
  const pull = await api(`${root}/pulls/${context.number}`);
  if (!isSmokePull(pull, context.repository) || pull.head.sha !== context.headSha) return { posted: false, reason: "PR closed, head moved or branch/repository did not match" };
  const comments = await api(`${root}/issues/${context.number}/comments?per_page=100`, { paginate: true });
  const existing = comments.find(comment => comment.user?.login === "github-actions[bot]" && comment.body?.includes(SMOKE_COMMENT_MARKER));
  await api(existing ? `${root}/issues/comments/${existing.id}` : `${root}/issues/${context.number}/comments`,
    { method: existing ? "PATCH" : "POST", body: { body } });
  return { posted: true };
}

function githubApi(path, { method, body, paginate } = {}) {
  const args = ["api", path];
  if (method) args.push("--method", method, "--input", "-");
  if (paginate) args.push("--paginate", "--slurp");
  const result = JSON.parse(execFileSync("gh", args, { encoding: "utf8", ...(body ? { input: JSON.stringify(body) } : {}) }));
  return paginate ? result.flat() : result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const directory = process.env.SMOKE_REPORT_DIR ?? ".status/new-card-smoke-shards";
    const reports = [], readErrors = [];
    for (const name of existsSync(directory) ? readdirSync(directory).filter(name => /^new-card-smoke-\d+\.json$/.test(name)).sort() : []) {
      try { reports.push(JSON.parse(readFileSync(join(directory, name), "utf8"))); }
      catch (error) { readErrors.push(`${name}: ${error.message}`); }
    }
    const context = { repository: process.env.GITHUB_REPOSITORY, number: Number(process.env.SMOKE_PR), headSha: process.env.SMOKE_HEAD, baseSha: process.env.SMOKE_BASE };
    const report = mergeSmokeReports(reports, Number(process.env.SMOKE_SHARD_COUNT ?? 4), process.env.SMOKE_RESULT);
    if (process.env.SMOKE_CONTEXT_RESULT && process.env.SMOKE_CONTEXT_RESULT !== "success") readErrors.push(`PR context resolution: ${process.env.SMOKE_CONTEXT_RESULT}`);
    const hasPull = Number.isSafeInteger(context.number) && context.number > 0;
    if (!hasPull) readErrors.push("PR context unavailable; no comment will be posted");
    if (readErrors.length) { report.errors.push(...readErrors); report.status = "ERROR"; report.exitCode = 2; }
    const runUrl = `${process.env.GITHUB_SERVER_URL}/${context.repository}/actions/runs/${process.env.GITHUB_RUN_ID}`;
    const markdown = renderSmokeReport(report, context, runUrl);
    mkdirSync(".status", { recursive: true });
    writeFileSync(".status/new-card-smoke-report.md", markdown);
    writeFileSync(".status/new-card-smoke-report.json", JSON.stringify(report, null, 2) + "\n");
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown);
    const result = hasPull ? await upsertSmokeComment(context, boundedSmokeComment(markdown, runUrl), githubApi)
      : { posted: false, reason: "PR context unavailable" };
    if (!result.posted) console.log(`::notice::Smoke comment skipped: ${result.reason}`);
    if (report.incomplete) console.log("::warning::New-card smoke is incomplete. Review unfinished passcodes and WARN rows in the report.");
    if ([1, 2].includes(report.exitCode)) console.error(`::error::New-card smoke ${report.status}; read the job summary and shard logs.`);
    process.exitCode = report.exitCode === 3 ? 0 : report.exitCode;
  } catch (error) { console.error(`::error::New-card smoke report error: ${error.message}`); process.exitCode = 2; }
}
