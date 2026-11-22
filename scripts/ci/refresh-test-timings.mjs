import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { LEGACY_SHARDS, PINNED_SHARDS, SURRENDER_FILES, TABLE_FILE } from "./engine-test-plan.mjs";
import { verifyFiles } from "./test-shards.mjs";
import { WEB_FULL_SHARDS, WEB_TIMING_LANE } from "./web-test-plan.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const gh = (...args) => execFileSync("gh", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"], maxBuffer: 8 * 1024 * 1024 });
const scratch = join(root, ".status");
mkdirSync(scratch, { recursive: true });
const directory = mkdtempSync(join(scratch, "refresh-test-timings-"));

function latestRun(lane, timingSets) {
  const endpoint = "repos/{owner}/{repo}/actions";
  const candidates = timingSets.flatMap(([marker]) => gh("api", "--paginate", `${endpoint}/artifacts?name=${marker}&per_page=100`,
    "--jq", '.artifacts[] | select(.expired == false and .workflow_run.head_branch == "main") | .workflow_run.id').trim().split("\n"));
  const ids = [...new Set(candidates.filter(Boolean))].sort((a, b) => Number(b) - Number(a));
  for (const id of ids) {
    const run = JSON.parse(gh("run", "view", id, "--json", "conclusion,event,headBranch,workflowName,url"));
    if (run.conclusion !== "success" || run.event !== "push" || run.headBranch !== "main" || run.workflowName !== "Test") continue;
    const available = gh("api", "--paginate", `${endpoint}/runs/${id}/artifacts?per_page=100`,
      "--jq", '.artifacts[] | select(.expired == false) | .name').trim().split("\n");
    const artifactNames = timingSets.find(names => names.every(name => available.includes(name)));
    if (artifactNames) return { id, url: run.url, artifactNames };
  }
  throw new Error(`No successful main push has a complete unexpired ${lane} timing set`);
}

function download(lane, ...timingSets) {
  const prefix = "test-timings-";
  const { id, url, artifactNames } = latestRun(lane, timingSets.map(names => names.map(name => prefix + name)));
  const destination = join(directory, lane);
  gh("run", "download", String(id), "--dir", destination, ...artifactNames.flatMap(name => ["--name", name]));
  return {
    source: url,
    reports: artifactNames.map(name => JSON.parse(readFileSync(join(destination, name, `${name.slice(prefix.length)}.json`), "utf8"))),
  };
}

const names = (lane, count) => Array.from({ length: count }, (_, index) => `${lane}-${index + 1}`);
function validateTimings(rows) {
  for (const { file, seconds } of rows) {
    if (typeof file !== "string" || !file || !Number.isFinite(seconds) || seconds < 0) throw new Error("Invalid file timing");
  }
}
function timingsOf(rows) {
  validateTimings(rows);
  const files = rows.map(row => row.file);
  verifyFiles([...new Set(files)], files);
  return Object.fromEntries([...rows].sort((a, b) => a.file.localeCompare(b.file)).map(({ file, seconds }) => [file, seconds]));
}
const secondsTotal = rows => Math.round(rows.reduce((total, row) => total + row.seconds, 0) * 1000) / 1000;
const write = (name, data) => writeFileSync(new URL(name, import.meta.url), JSON.stringify(data, null, 2) + "\n");

try {
  // Older runs used an unversioned prefix and recorded five shards.
  const web = download("web", names(WEB_TIMING_LANE, WEB_FULL_SHARDS), names("web", 5));
  const engine = download("engine", [
    ...names("engine-pinned", PINNED_SHARDS),
    ...names("engine-legacy", LEGACY_SHARDS),
    ...names("engine-surrender", SURRENDER_FILES.length),
  ]);
  const pinned = engine.reports.slice(0, PINNED_SHARDS).flatMap(report => report.files);
  const legacy = engine.reports.slice(PINNED_SHARDS, PINNED_SHARDS + LEGACY_SHARDS).flatMap(report => report.files);
  const surrender = engine.reports.slice(PINNED_SHARDS + LEGACY_SHARDS);
  const table = pinned.filter(row => row.file === TABLE_FILE);
  if (table.length !== PINNED_SHARDS) throw new Error("Missing Table partition timings");
  validateTimings(table);
  const surrenderModes = {};
  for (const mode of ["normal", "domain"]) {
    const rows = surrender.flatMap(report => report[mode]);
    verifyFiles(SURRENDER_FILES, rows.map(row => row.file));
    timingsOf(rows);
    surrenderModes[mode] = secondsTotal(rows);
  }

  const webFiles = timingsOf(web.reports.flatMap(report => report.files));
  const engineFiles = timingsOf(pinned.filter(row => row.file !== TABLE_FILE));
  const legacyFiles = timingsOf(legacy);
  if (!Object.keys(webFiles).length || !Object.keys(engineFiles).length || !Object.keys(legacyFiles).length) {
    throw new Error("Full suites must have file timings");
  }
  write("./test-timings/web.json", { sources: [web.source], unit: "seconds", files: webFiles });
  write("./engine-test-times.json", {
    sources: [engine.source],
    unit: "seconds",
    tableTotal: secondsTotal(table),
    surrenderModes,
    surrenderFiles: Object.fromEntries(SURRENDER_FILES.map(file => [file,
      secondsTotal(surrender.flatMap(report => [...report.normal, ...report.domain]).filter(row => row.file === file)),
    ])),
    files: engineFiles,
    legacy: legacyFiles,
  });
  console.log(`Refreshed web timings from ${web.source} and engine timings from ${engine.source}`);
} finally {
  rmSync(directory, { recursive: true, force: true });
}
