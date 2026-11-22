import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const vitest = join(root, "node_modules/vitest/vitest.mjs");
const reporter = fileURLToPath(new URL("./test-timing-reporter.mjs", import.meta.url));
const scratch = process.env.RUNNER_TEMP ?? join(root, ".status");

export function balanceFiles(files, count, timings, fallback, reserved = []) {
  const weight = file => Math.max(0.001, timings[file] ?? fallback);
  const shards = Array.from({ length: count }, (_, index) => ({ files: [], seconds: reserved[index] ?? 0 }));
  for (const file of [...files].sort((a, b) => weight(b) - weight(a) || a.localeCompare(b))) {
    const shard = shards.reduce((best, next) => next.seconds < best.seconds ? next : best);
    shard.files.push(file);
    shard.seconds += weight(file);
  }
  verifyFiles(files, shards.flatMap(shard => shard.files));
  return shards;
}

export function verifyFiles(expected, actual) {
  const seen = new Set();
  const remaining = new Set(expected);
  if (remaining.size !== expected.length) throw new Error("Expected test files contain duplicates");
  const errors = [];
  for (const file of actual) {
    if (seen.has(file)) errors.push(`duplicate: ${file}`);
    else if (!remaining.delete(file)) errors.push(`unexpected: ${file}`);
    seen.add(file);
  }
  for (const file of remaining) errors.push(`missing: ${file}`);
  if (errors.length) throw new Error(`Test file coverage failed\n${errors.join("\n")}`);
}

export function listVitestFiles(workspace, args = []) {
  const cwd = join(root, "packages", workspace);
  mkdirSync(scratch, { recursive: true });
  const directory = mkdtempSync(join(scratch, "vitest-files-"));
  const list = join(directory, "files.json");
  try {
    const result = spawnSync(process.execPath, [vitest, "list", "--filesOnly", `--json=${list}`, ...args], {
      cwd, stdio: "inherit",
    });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`Vitest discovery failed (${result.signal ?? result.status})`);
    return JSON.parse(readFileSync(list, "utf8")).map(({ file }) => relative(cwd, file)).sort();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

export async function runVitestShard(workspace, files, args = [], env = {}) {
  if (!files.length) return [];
  const cwd = join(root, "packages", workspace);
  mkdirSync(scratch, { recursive: true });
  const directory = mkdtempSync(join(scratch, "vitest-shard-"));
  const report = join(directory, "report.json");

  try {
    await new Promise((resolveRun, reject) => {
      const run = spawn(process.execPath, [
        vitest, "run", ...args, "--reporter=default", `--reporter=${reporter}`,
        ...files.map(file => resolve(cwd, file)),
      ], { cwd, stdio: "inherit", env: { ...process.env, ...env, CI_SHARD_REPORT: report } });
      run.on("error", reject);
      run.on("close", (code, signal) => {
        if (code === 0) resolveRun();
        else reject(new Error(`Vitest shard failed (${signal ?? code})`));
      });
    });

    const results = JSON.parse(readFileSync(report, "utf8"));
    verifyFiles(files, results.map(result => result.file));
    console.log(`Verified ${files.length} test files in this invocation.`);
    return results;
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

export function saveTimings(lane, index, reports) {
  if (process.env.GITHUB_EVENT_NAME !== "push" || process.env.GITHUB_REF !== "refs/heads/main") return;
  const directory = join(scratch, "test-timings");
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, `${lane}-${index}.json`), JSON.stringify(reports) + "\n");
}
