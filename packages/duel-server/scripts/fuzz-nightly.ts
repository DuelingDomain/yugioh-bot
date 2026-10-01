/**
 * Nightly fuzz driver: thousands of seeded self-play duels across worker threads.
 *
 *   FUZZ_RUNS=10000 FUZZ_SEED=1 FUZZ_MODE=all npx tsx scripts/fuzz-nightly.ts
 *   npx tsx scripts/fuzz-nightly.ts --duels 500 --workers 4 --mode domain --max-steps 800
 *
 * Options (flag or env): --duels/FUZZ_RUNS, --seed/FUZZ_SEED, --mode/FUZZ_MODE, --master-rule/FUZZ_MASTER_RULE,
 * --max-steps/FUZZ_MAX_STEPS, --replay-rate/FUZZ_REPLAY_RATE, --workers/FUZZ_WORKERS,
 * --duel-timeout-ms/FUZZ_DUEL_TIMEOUT_MS, --strict (known issues fail too), --out DIR (failure JSON dir).
 * Exit code 1 when a failure that is not a known issue occurred.
 */
import { createHash } from "node:crypto";
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { cpus } from "node:os";
import { join, resolve } from "node:path";
import { Worker } from "node:worker_threads";
import { fileURLToPath } from "node:url";
import { loadFuzzConfig, scenarioFor } from "../tests/fuzz/config.js";
import type { DuelOutcome } from "../tests/fuzz/driver.js";
import { FAILURE_DIR, describeFailure, writeFailure } from "../tests/fuzz/failures.js";
import { knownIssueFor } from "../tests/fuzz/known-issues.js";

function flag(name: string, envName: string): void {
  const index = process.argv.indexOf(`--${name}`);
  if (index >= 0 && process.argv[index + 1] !== undefined) process.env[envName] = process.argv[index + 1] as string;
}
flag("duels", "FUZZ_RUNS");
flag("seed", "FUZZ_SEED");
flag("mode", "FUZZ_MODE");
flag("master-rule", "FUZZ_MASTER_RULE");
flag("max-steps", "FUZZ_MAX_STEPS");
flag("replay-rate", "FUZZ_REPLAY_RATE");
flag("workers", "FUZZ_WORKERS");
flag("duel-timeout-ms", "FUZZ_DUEL_TIMEOUT_MS");
const outIndex = process.argv.indexOf("--out");
const outDir = outIndex >= 0 ? process.argv[outIndex + 1] : undefined;
const strict = process.argv.includes("--strict") || process.env.FUZZ_STRICT === "1";

const config = loadFuzzConfig({ runs: 1000, maxSteps: 1500, replayRate: 0.25 });
const workerCount = Math.max(1, Number(process.env.FUZZ_WORKERS ?? Math.min(8, Math.max(1, cpus().length - 1))));
const duelTimeoutMs = Number(process.env.FUZZ_DUEL_TIMEOUT_MS ?? 60_000);
const baseSeed = config.seed ?? Math.floor(Math.random() * 2 ** 30);
const seedFor = (i: number) => ((baseSeed + i) % (2 ** 31 - 2)) + 1;

interface Tally {
  duels: number;
  steps: number;
  ended: number;
  turns: number;
  softRejections: number;
  busyMs: number;
  replayed: number;
  failures: Map<string, { count: number; known: boolean; seeds: number[] }>;
  promptKinds: Record<string, number>;
}
const newTally = (): Tally => ({ duels: 0, steps: 0, ended: 0, turns: 0, softRejections: 0, busyMs: 0, replayed: 0, failures: new Map(), promptKinds: {} });
const byMode: Record<string, Tally> = { normal: newTally(), domain: newTally() };
const total = newTally();
const unknownFailures: DuelOutcome[] = [];
const workerBusy = new Map<number, number>();

console.log(
  `fuzz-nightly: ${config.runs} duels, ${workerCount} workers, mode ${config.mode}, base seed ${baseSeed}, ` +
    `max steps ${config.maxSteps}, replay rate ${config.replayRate}, data ${config.dataDirectory}`,
);
const started = performance.now();
let next = 0;
let finished = 0;

function record(tally: Tally, outcome: DuelOutcome, wallMs: number, replayed: boolean): void {
  tally.duels++;
  tally.steps += outcome.steps;
  tally.turns += outcome.turns;
  tally.softRejections += outcome.softRejections;
  tally.busyMs += wallMs;
  if (outcome.ended) tally.ended++;
  if (replayed) tally.replayed++;
  for (const [kind, n] of Object.entries(outcome.promptKinds)) tally.promptKinds[kind] = (tally.promptKinds[kind] ?? 0) + n;
  if (outcome.failure) {
    const issue = knownIssueFor(outcome.failure);
    const key = issue ? `${outcome.failure.invariant} (known: ${issue.id})` : outcome.failure.invariant;
    const entry = tally.failures.get(key) ?? { count: 0, known: Boolean(issue), seeds: [] };
    entry.count++;
    if (entry.seeds.length < 8) entry.seeds.push(outcome.scenario.seed);
    tally.failures.set(key, entry);
  }
}

function handleResult(outcome: DuelOutcome, wallMs: number): void {
  const replayed = (outcome as DuelOutcome & { replayed?: boolean }).replayed ?? false;
  record(total, outcome, wallMs, replayed);
  record(byMode[outcome.scenario.mode] as Tally, outcome, wallMs, replayed);
  if (outcome.failure) {
    const known = knownIssueFor(outcome.failure);
    if (!known || strict) {
      unknownFailures.push(outcome);
      const path = writeFailure(outcome, config.dataDirectory, outDir);
      if (unknownFailures.length <= 20) console.log(`${describeFailure(outcome, config.dataDirectory)}\n  saved: ${path}`);
    }
  }
  finished++;
  if (finished % Math.max(1, Math.floor(config.runs / 10)) === 0) {
    const secs = (performance.now() - started) / 1000;
    console.log(`  progress ${finished}/${config.runs}, ${(finished / secs).toFixed(1)} duels/s, ${unknownFailures.length} new failures`);
  }
}

function summarize(): void {
  const secs = (performance.now() - started) / 1000;
  const line = (label: string, t: Tally) => {
    const perWorker = t.busyMs > 0 ? t.duels / (t.busyMs / 1000) : 0;
    const stepsPerWorker = t.busyMs > 0 ? t.steps / (t.busyMs / 1000) : 0;
    console.log(
      `  ${label.padEnd(7)} duels ${t.duels}, steps ${t.steps}, ended ${t.ended}, avg turns ${(t.turns / Math.max(1, t.duels)).toFixed(1)}, ` +
        `replayed ${t.replayed}, soft rejections ${t.softRejections}, per worker ${perWorker.toFixed(1)} duels/s ${stepsPerWorker.toFixed(0)} steps/s`,
    );
  };
  console.log("\nfuzz-nightly summary");
  console.log(`  wall ${secs.toFixed(1)}s, ${(total.duels / secs).toFixed(1)} duels/s, ${(total.steps / secs).toFixed(0)} steps/s over ${workerCount} workers`);
  line("all", total);
  line("normal", byMode.normal as Tally);
  line("domain", byMode.domain as Tally);
  console.log(`  prompt kinds: ${Object.entries(total.promptKinds).map(([k, n]) => `${k} ${n}`).join(", ")}`);
  const merged = new Map<string, { count: number; known: boolean; seeds: number[] }>();
  for (const [key, entry] of total.failures) merged.set(key, entry);
  if (merged.size === 0) console.log("  failures: none");
  else {
    console.log("  failures by invariant:");
    for (const [key, entry] of [...merged].sort((a, b) => b[1].count - a[1].count)) {
      console.log(`    ${key}: ${entry.count} (first seeds ${entry.seeds.join(", ")})`);
    }
  }
  console.log(`  new (not known) failures: ${unknownFailures.length}`);
}

/** summary.json next to the failure JSON files, a copy in .status/, and one line in .status/fuzz-history.tsv. */
function writeSummary(): void {
  try {
    const durationS = (performance.now() - started) / 1000;
    const wasmPath = join(config.dataDirectory, "ocgcore.standard.wasm");
    const wasmSha = existsSync(wasmPath) ? createHash("sha256").update(readFileSync(wasmPath)).digest("hex") : "";
    const failureList = [...total.failures].map(([invariant, e]) => ({ invariant, count: e.count, known: e.known, seeds: e.seeds }));
    const firstFailingSeed = unknownFailures[0]?.scenario.seed ?? null;
    const summary = {
      time: new Date().toISOString(),
      runs: total.duels,
      requestedRuns: config.runs,
      failures: unknownFailures.length,
      knownFailures: failureList.filter((f) => f.known).reduce((n, f) => n + f.count, 0),
      failuresByInvariant: failureList,
      firstFailingSeed,
      baseSeed,
      mode: config.mode,
      maxSteps: config.maxSteps,
      workers: workerCount,
      durationS: Number(durationS.toFixed(1)),
      steps: total.steps,
      wasm: { path: wasmPath, sha256: wasmSha },
      outDir: outDir ? resolve(outDir) : FAILURE_DIR,
    };
    const text = `${JSON.stringify(summary, null, 2)}\n`;
    const dir = outDir ? resolve(outDir) : FAILURE_DIR;
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "summary.json"), text);
    const statusDir = resolve(import.meta.dirname, "../../../.status");
    mkdirSync(statusDir, { recursive: true });
    copyFileSync(join(dir, "summary.json"), join(statusDir, "fuzz-summary.json"));
    const row = [summary.time, summary.runs, summary.failures, summary.durationS, `${wasmPath} ${wasmSha.slice(0, 12)}`, firstFailingSeed ?? ""];
    appendFileSync(join(statusDir, "fuzz-history.tsv"), `${row.join("\t")}\n`);
    console.log(`  summary: ${join(dir, "summary.json")} (copy in ${statusDir})`);
  } catch (error) {
    console.log(`  summary not written: ${(error as Error).message}`);
  }
}

const workerUrl = new URL("./fuzz-worker.ts", import.meta.url);
const workers: Worker[] = [];
let alive = 0;
let resolveAll: () => void = () => undefined;
const allDone = new Promise<void>((resolve) => {
  resolveAll = resolve;
});

function spawn(slot: number): void {
  const worker = new Worker(fileURLToPath(workerUrl), { workerData: { config } });
  workers[slot] = worker;
  alive++;
  let current: { seed: number; startedAt: number } | null = null;
  const watchdog = setInterval(() => {
    if (current && performance.now() - current.startedAt > duelTimeoutMs) {
      const hung = current;
      current = null;
      clearInterval(watchdog);
      void worker.terminate();
      const outcome = {
        scenario: scenarioFor(hung.seed, config),
        decks: [],
        deckNotes: ["", ""],
        disjoint: false,
        steps: 0,
        ended: false,
        result: null,
        journal: [],
        finalHash: "",
        stepHashes: [],
        failure: { invariant: "hang", message: `Duel exceeded ${duelTimeoutMs} ms (engine or Lua loop never returned)`, step: 0 },
        softRejections: 0,
        promptKinds: {},
        stats: {},
        createMs: 0,
        playMs: 0,
        checkMs: 0,
        turns: 0,
      } as unknown as DuelOutcome;
      handleResult(outcome, duelTimeoutMs);
      alive--;
      if (next < config.runs) spawn(slot);
      else if (alive === 0) resolveAll();
    }
  }, 1000);
  const dispatch = () => {
    if (next >= config.runs) {
      clearInterval(watchdog);
      worker.postMessage({ type: "stop" });
      return;
    }
    const seed = seedFor(next++);
    current = { seed, startedAt: performance.now() };
    worker.postMessage({ type: "run", seed });
  };
  worker.on("message", (message: { type: string; seed?: number; outcome?: DuelOutcome; wallMs?: number; message?: string }) => {
    if (message.type === "ready") dispatch();
    else if (message.type === "start") current = { seed: message.seed as number, startedAt: performance.now() };
    else if (message.type === "done") {
      current = null;
      workerBusy.set(slot, (workerBusy.get(slot) ?? 0) + (message.wallMs ?? 0));
      handleResult(message.outcome as DuelOutcome, message.wallMs ?? 0);
      dispatch();
    } else if (message.type === "crash") {
      current = null;
      console.log(`worker ${slot} crashed on seed ${message.seed}: ${message.message}`);
      finished++;
      dispatch();
    }
  });
  worker.on("error", (error: Error) => console.log(`worker ${slot} error: ${error.message}`));
  worker.on("exit", () => {
    clearInterval(watchdog);
    if (workers[slot] === worker) {
      alive--;
      if (alive === 0) resolveAll();
    }
  });
}

for (let slot = 0; slot < workerCount; slot++) spawn(slot);
await allDone;
summarize();
writeSummary();
const bad = unknownFailures.length > 0;
process.exit(bad ? 1 : 0);
