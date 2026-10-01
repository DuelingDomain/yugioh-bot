// Builds test-results/index.md and test-results/index.json: one page that lists every failed test with its first
// error line and links to the evidence files. The reporter tools/index-reporter.mjs runs it after each run.
// Rebuild by hand with `npm run e2e:index --workspace=packages/e2e`.
// Sources: the JSON reporter file (.status/e2e-results.json) for the failed tests, and the evidence folders in
// test-results/ (failure-summary.json, timeline.md, stall-<slug>-<iso>.json, leak-scan.json).
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const e2eRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const resultsDir = resolve(e2eRoot, "test-results");
const jsonFile = resolve(e2eRoot, "../../.status/e2e-results.json");
const ANSI = /\u001b\[[0-9;]*m/g;

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function firstLine(text) {
  const lines = String(text ?? "").replace(ANSI, "").split("\n").map((line) => line.trim()).filter(Boolean);
  return (lines[0] ?? "").slice(0, 300);
}

/** The failed tests of a Playwright JSON report: title, file, error text, attachment paths. */
function failedFromReport(report) {
  const out = [];
  const walk = (suite, titles) => {
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests ?? []) {
        const result = (test.results ?? []).at(-1);
        if (!result || ["passed", "skipped"].includes(result.status) || test.expectedStatus === result.status) continue;
        const errors = (result.errors?.length ? result.errors : result.error ? [result.error] : []).map((error) => error.message ?? "");
        out.push({
          title: [...titles, spec.title].join(" > "),
          file: spec.file,
          status: result.status,
          errors,
          attachments: (result.attachments ?? []).filter((item) => item.path).map((item) => item.path),
        });
      }
    }
    for (const child of suite.suites ?? []) walk(child, child.title && !child.title.endsWith(".ts") ? [...titles, child.title] : titles);
  };
  for (const suite of report.suites ?? []) walk(suite, []);
  return out;
}

function evidenceDirs() {
  if (!existsSync(resultsDir)) return [];
  return readdirSync(resultsDir)
    .map((name) => resolve(resultsDir, name, "evidence"))
    .filter((dir) => existsSync(dir) && statSync(dir).isDirectory());
}

export function buildIndex() {
  const report = readJson(jsonFile);
  const failed = report ? failedFromReport(report) : [];
  const byDir = new Map();
  const entries = [];
  const used = new Set();

  for (const item of failed) {
    // Attachments sit in <test>/attachments/ (copies) or <test>/evidence/. The evidence folder is next to both.
    const dir = item.attachments.map((path) => resolve(dirname(path), "..", "evidence")).concat(item.attachments.map((path) => dirname(path))).find((path) => evidenceDirs().includes(path)) ?? null;
    if (dir) used.add(dir);
    entries.push({ ...item, evidenceDir: dir });
  }
  // Evidence folders that the JSON report did not name (for example when the JSON file is older than the run).
  for (const dir of evidenceDirs()) {
    if (used.has(dir)) continue;
    const summary = readJson(resolve(dir, "failure-summary.json"));
    const leak = readJson(resolve(dir, "leak-scan.json"));
    const hasStall = readdirSync(dir).some((name) => /^stall-.+\.json$/.test(name));
    if (!summary && !hasStall && leak?.status !== "leaks") continue;
    const failedTest = summary?.test?.status && summary.test.status !== summary.test.expectedStatus;
    if (report && !failedTest && !hasStall && leak?.status !== "leaks") continue;
    entries.push({
      title: summary?.test?.title ?? basename(dirname(dir)),
      file: summary?.test?.file ?? "",
      status: summary?.test?.status ?? "failed",
      errors: summary?.test?.errors ?? [],
      attachments: [],
      evidenceDir: dir,
    });
  }

  const rel = (path) => relative(resultsDir, path);
  const rows = entries.map((entry) => {
    const dir = entry.evidenceDir;
    const summary = dir ? readJson(resolve(dir, "failure-summary.json")) : null;
    const leak = dir ? readJson(resolve(dir, "leak-scan.json")) : null;
    const files = dir ? readdirSync(dir) : [];
    const link = (name) => (files.includes(name) ? rel(resolve(dir, name)) : null);
    const errors = entry.errors.length ? entry.errors : summary?.test?.errors ?? [];
    return {
      title: entry.title,
      file: entry.file ? relative(e2eRoot, entry.file.startsWith("/") ? entry.file : resolve(e2eRoot, "tests", entry.file)) : "",
      status: entry.status,
      // A stall or a leak says more than the aborted click that follows it.
      firstError: firstLine(errors.find((text) => /stalled: revision|Hidden card leak/.test(text)) ?? errors[0]),
      stall: files.filter((name) => /^stall-.+\.json$/.test(name)).map((name) => rel(resolve(dir, name))),
      leak: leak ? { status: leak.status, file: link("leak-scan.json"), first: leak.firstLeak ?? null } : null,
      failureSummary: link("failure-summary.json"),
      timeline: link("timeline.md"),
      timelineJson: link("timeline.json"),
      trace: entry.attachments.map((path) => path).find((path) => path.endsWith("trace.zip")) ? rel(entry.attachments.find((path) => path.endsWith("trace.zip"))) : null,
      replay: (summary?.duels ?? []).map((duel) => duel.replay).filter(Boolean),
    };
  });

  const md = [
    "# E2E run index",
    "",
    `Built ${new Date().toISOString()}. ${rows.length === 0 ? "No failed test." : `${rows.length} failed test${rows.length === 1 ? "" : "s"}.`}`,
    "Links are relative to this file. Start with `timeline.md`: the first lines name the first error and the last progress point.",
    "",
  ];
  rows.forEach((row, index) => {
    md.push(`## ${index + 1}. ${row.title}`, "");
    md.push(`- File: \`${row.file}\``, `- Status: ${row.status}`, `- First error: ${row.firstError || "(none recorded)"}`);
    if (row.stall.length) md.push(`- Stall: ${row.stall.map((file) => `[${basename(file)}](${file})`).join(", ")}`);
    if (row.leak) md.push(`- Leak scan: ${row.leak.status}${row.leak.file ? ` ([leak-scan.json](${row.leak.file}))` : ""}${row.leak.first ? `. ${row.leak.first}` : ""}`);
    if (row.timeline) md.push(`- Timeline: [timeline.md](${row.timeline}), [timeline.json](${row.timelineJson})`);
    if (row.failureSummary) md.push(`- Failure summary: [failure-summary.json](${row.failureSummary})`);
    if (row.trace) md.push(`- Trace: [trace.zip](${row.trace}) (\`npx playwright show-trace packages/e2e/test-results/${row.trace}\`)`);
    for (const command of row.replay) md.push(`- Replay: \`${command}\``);
    md.push("");
  });
  if (existsSync(resultsDir)) {
    writeFileSync(resolve(resultsDir, "index.md"), md.join("\n"));
    writeFileSync(resolve(resultsDir, "index.json"), JSON.stringify({ builtAt: new Date().toISOString(), failed: rows }, null, 1));
  }
  return rows;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const rows = buildIndex();
  console.log(`[e2e] index: ${rows.length} failed test(s), see packages/e2e/test-results/index.md`);
}
