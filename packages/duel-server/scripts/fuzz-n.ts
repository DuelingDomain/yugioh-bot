/**
 * Random-play fuzz for 3 FFA, 4 FFA and 2v2 Tag duels (and 1v1 through the same driver).
 *
 *   npm run fuzz:n -- --format ffa3,ffa4,tag --seeds 20
 *   npm run fuzz:n -- --format tag --seeds 5 --core T3              # one core: a tag of domain-core/dist, or a path
 *   npm run fuzz:n -- --cores all --seeds 20                        # every per-task core that exists, one table
 *   npm run fuzz:n -- --repro tests/fuzz-n/failures/tag-7-B2.json   # replay one failure file
 *   npm run fuzz:n -- --shrink tests/fuzz-n/failures/ffa3-4-T3.json # shortest replayable prefix, written next to the file as <name>.shrunk.json
 *   npm run fuzz:n -- --selfcheck-n2 --seeds 20                     # n = 2: same final hash as the old fuzz
 *
 * Flags: --seed-start N, --mode normal|domain, --max-steps N (default 1000), --timeout MS (wall clock per duel, default 90000),
 * --jobs N (parallel duels, default 1), --elim-rate P (host eliminations, default 0.5), --master-rule 1..5 (default 5),
 * --strict (known issues fail too), --no-write (no failure files), --trace (repro: print every action).
 * Env: NSEAT_WASM (core path or tag), DUEL_DATA_DIR. Exit 1 on a NEW failure (every failure with --strict).
 * Run long jobs through the lock: bash domain-core/.build/phase1/run-locked.sh diff 3 <command>.
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { DuelFormat, DuelMasterRule, DuelMode } from "@yugidraft/shared/duels";
import { isDuelFormat } from "@yugidraft/shared/duels";
import { engineDataDirectory, scenarioFor } from "../tests/fuzz/config.js";
import { distWasmPath, existingDistTags, readCore, resolveCorePath, type CoreInfo } from "../tests/fuzz-n/core.js";
import { playDuel, type NOutcome, type NScenario } from "../tests/fuzz-n/driver.js";
import { buildFailureFile, describeFailure, readFailureFile, reproCommand, writeFailureFile } from "../tests/fuzz-n/failures.js";
import { childMain, runIsolated } from "../tests/fuzz-n/isolated.js";
import { knownIssueFor } from "../tests/fuzz-n/known-issues.js";
import { runDuel } from "../tests/fuzz/driver.js";

const ALL_CORE_TAGS = ["B2", "T3", "T4", "T5A", "T5B", "T6", "F02", "F6"];

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}
const flag = (name: string) => process.argv.includes(`--${name}`);
const num = (name: string, fallback: number) => {
  const raw = arg(name);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`--${name} must be a number`);
  return value;
};

function formatsFromArg(): DuelFormat[] {
  const raw = arg("format") ?? "ffa3,ffa4,tag";
  const list = raw === "all" ? ["ffa3", "ffa4", "tag"] : raw.split(",").map((s) => s.trim());
  for (const item of list) if (!isDuelFormat(item)) throw new Error(`Unknown format "${item}" (1v1, ffa3, ffa4, tag)`);
  return list as DuelFormat[];
}

function scenarioOf(format: DuelFormat, seed: number): NScenario {
  return {
    format,
    seed,
    mode: (arg("mode") ?? "normal") as DuelMode,
    masterRule: num("master-rule", 5) as DuelMasterRule,
    maxSteps: num("max-steps", 1000),
    eliminateRate: num("elim-rate", 0.5),
  };
}

async function pool<T>(items: T[], jobs: number, work: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.max(1, jobs) }, async () => {
      while (next < items.length) await work(items[next++]!);
    }),
  );
}

// ---- --child: one duel in an isolated process ----
const childSpec = arg("child");
if (childSpec) {
  await childMain(childSpec);
  process.exit(0);
}

// ---- --repro ----
const reproFile = arg("repro");
if (reproFile) {
  const file = readFailureFile(reproFile);
  const spec = arg("core") ?? process.env.NSEAT_WASM;
  const path = spec ? resolveCorePath(engineDataDirectory(), spec) : existsOr(file.wasm.path) ?? distWasmPath(file.wasm.tag);
  const core = readCore(path);
  console.log(`repro ${reproFile}: ${file.format} seed ${file.seed}, recorded check ${file.check.name} on core ${file.wasm.tag}; replaying ${file.answers.length} actions on ${core.info.tag} (${core.info.path})`);
  if (core.info.sha256 !== file.wasm.sha256) console.log(`note: the core sha256 differs from the recording (${core.info.sha256.slice(0, 12)} vs ${file.wasm.sha256.slice(0, 12)})`);
  const outcome = await runIsolated(file.scenario, {
    dataDirectory: engineDataDirectory(),
    corePath: core.info.path,
    timeoutMs: num("timeout", 90_000),
    script: { journal: file.answers, ...(file.pending ? { pending: file.pending } : {}) },
  });
  if (flag("trace")) for (const [i, item] of outcome.journal.entries()) console.log(`  ${i}: ${JSON.stringify(item)}`);
  if (!outcome.failure) {
    console.log(`no failure on replay: ${outcome.steps} steps, status ${outcome.status}, result ${JSON.stringify(outcome.result)}`);
    process.exit(0);
  }
  const replayed = buildFailureFile(outcome, core.info, outcome.failure);
  console.log(describeFailure(replayed));
  console.log(replayed.check.name === file.check.name ? "REPRODUCED: same check as the recording." : `DIFFERENT check than the recording (${file.check.name}).`);
  process.exit(1);
}

// ---- --shrink: the first failing step by binary search over replay prefixes ----
const shrinkFile = arg("shrink");
if (shrinkFile) {
  const file = readFailureFile(shrinkFile);
  const spec = arg("core") ?? process.env.NSEAT_WASM;
  const core = readCore(spec ? resolveCorePath(engineDataDirectory(), spec) : existsOr(file.wasm.path) ?? distWasmPath(file.wasm.tag));
  const timeoutMs = num("timeout", 90_000);
  const replays = { count: 0 };
  const replay = (length: number, withPending: boolean) => {
    replays.count++;
    return runIsolated(file.scenario, {
      dataDirectory: engineDataDirectory(),
      corePath: core.info.path,
      timeoutMs,
      script: { journal: file.answers.slice(0, length), ...(withPending && file.pending ? { pending: file.pending } : {}) },
    });
  };
  const hits = (outcome: NOutcome) => outcome.failure?.invariant === file.check.name;
  console.log(`shrink ${shrinkFile}: ${file.format} seed ${file.seed}, check ${file.check.name}, ${file.answers.length} actions, core ${core.info.tag}`);
  const full = await replay(file.answers.length, true);
  if (!hits(full)) {
    console.log(`the failure does not reproduce on core ${core.info.tag} (${full.failure ? `got ${full.failure.invariant}` : "no failure"}); nothing written`);
    process.exit(2);
  }
  let best = full;
  const wallClock = (full.failure?.detail as { kind?: string } | undefined)?.kind === "wall-clock";
  // A hang or throw happens inside the pending action: no shorter prefix reproduces it. A check violation does, from its step on.
  if (!wallClock && !file.pending) {
    let low = 0;
    let high = Math.min(file.answers.length, full.failure?.step ?? file.answers.length);
    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      const outcome = await replay(mid, false);
      if (hits(outcome)) {
        high = mid;
        best = outcome;
      } else low = mid + 1;
    }
    if (high < (full.failure?.step ?? Infinity)) best = await replay(high, false);
  }
  const shrunk = buildFailureFile(best, core.info, best.failure!);
  const out = shrinkFile.replace(/\.json$/, "") + ".shrunk.json";
  shrunk.repro = reproCommand(out);
  writeFileSync(out, JSON.stringify(shrunk, null, 1));
  console.log(`first failing step ${best.failure!.step}: ${file.answers.length} actions -> ${shrunk.answers.length} actions (${replays.count} replays)\nwritten: ${out}\n${describeFailure(shrunk)}`);
  process.exit(0);
}

function existsOr(path: string): string | undefined {
  try {
    readCore(path);
    return path;
  } catch {
    return undefined;
  }
}

const dataDirectory = engineDataDirectory();

// ---- --selfcheck-n2: invariant 1 ----
if (flag("selfcheck-n2")) {
  const seeds = num("seeds", 20);
  const start = num("seed-start", 1);
  const core = readCore(resolveCorePath(dataDirectory));
  // Both fuzzes create their duel through the data directory, so point a temp data directory at the chosen core.
  const { mkdtempSync, symlinkSync, readdirSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const temp = mkdtempSync(join(tmpdir(), "fuzz-n-data-"));
  for (const name of readdirSync(dataDirectory)) if (name !== "ocgcore.standard.wasm") symlinkSync(join(dataDirectory, name), join(temp, name));
  symlinkSync(core.info.path, join(temp, "ocgcore.standard.wasm"));
  const realNow = Date.now;
  Date.now = () => Date.UTC(2026, 0, 1);
  let differ = 0;
  try {
    for (let i = 0; i < seeds; i++) {
      const seed = start + i;
      const old = scenarioFor(seed, { mode: (arg("mode") ?? "normal") as never, masterRule: null, maxSteps: num("max-steps", 300) });
      const before = await runDuel(old, temp);
      const mine = await playDuel({ ...old, format: "1v1", eliminateRate: 0 }, { dataDirectory: temp });
      const same = before.finalHash === mine.finalHash && before.steps === mine.steps && JSON.stringify(before.journal) === JSON.stringify(mine.journal.map(({ kind: _kind, ...rest }) => rest));
      if (!same) differ++;
      console.log(`seed ${seed}: old ${before.steps} steps ${before.finalHash.slice(0, 10)}, n-seat driver ${mine.steps} steps ${mine.finalHash.slice(0, 10)} ${same ? "SAME" : "DIFFERENT"}${before.failure || mine.failure ? ` (old failure ${before.failure?.invariant ?? "-"}, new failure ${mine.failure?.invariant ?? "-"}: ${mine.failure?.message ?? ""})` : ""}`);
    }
  } finally {
    Date.now = realNow;
    rmSync(temp, { recursive: true, force: true });
  }
  console.log(`selfcheck n=2 on core ${core.info.tag}: ${seeds - differ}/${seeds} same`);
  process.exit(differ > 0 ? 1 : 0);
}

// ---- normal run ----
interface Cell {
  seeds: number;
  ended: number;
  budget: number;
  byCheck: Map<string, number>;
  known: Map<string, number>;
  hangs: number;
  steps: number;
}

async function runCore(core: CoreInfo, formats: DuelFormat[]): Promise<Map<DuelFormat, Cell>> {
  const seeds = num("seeds", 20);
  const start = num("seed-start", 1);
  const timeoutMs = num("timeout", 90_000);
  const strict = flag("strict");
  const table = new Map<DuelFormat, Cell>();
  for (const format of formats) {
    const cell: Cell = { seeds: 0, ended: 0, budget: 0, byCheck: new Map(), known: new Map(), hangs: 0, steps: 0 };
    table.set(format, cell);
    const list = Array.from({ length: seeds }, (_, i) => start + i);
    await pool(list, num("jobs", 1), async (seed) => {
      const scenario = scenarioOf(format, seed);
      const outcome: NOutcome = await runIsolated(scenario, { dataDirectory, corePath: core.path, timeoutMs });
      cell.seeds++;
      cell.steps += outcome.steps;
      if (outcome.status === "ended") cell.ended++;
      else if (outcome.status === "budget") cell.budget++;
      const failure = outcome.failure;
      if (!failure) return;
      if (failure.invariant === "hang") cell.hangs++;
      const known = knownIssueFor(failure, { format, coreTag: core.tag });
      const file = buildFailureFile(outcome, core, failure);
      if (known) cell.known.set(known.sig, (cell.known.get(known.sig) ?? 0) + 1);
      else cell.byCheck.set(failure.invariant, (cell.byCheck.get(failure.invariant) ?? 0) + 1);
      const saved = flag("no-write") ? "(not saved)" : writeFailureFile(file, arg("out") ? resolve(arg("out")!) : undefined);
      console.log(`${describeFailure(file)}\n  saved: ${saved}${known && !strict ? "" : ""}`);
    });
  }
  return table;
}

const formats = formatsFromArg();
const coreSpecs: string[] = (() => {
  const list = arg("cores");
  if (!list) return [arg("core") ?? process.env.NSEAT_WASM ?? ""];
  return list === "all" ? ["", ...existingDistTags(ALL_CORE_TAGS.filter((tag) => tag !== "B2")).map((tag) => tag)] : list.split(",");
})();

const rows: string[] = [];
let newFailures = 0;
let anyFailures = 0;
for (const spec of coreSpecs) {
  const core = readCore(resolveCorePath(dataDirectory, spec || undefined)).info;
  console.log(`\n== core ${core.tag} (${core.sha256.slice(0, 12)}) ${core.path}`);
  const table = await runCore(core, formats);
  for (const [format, cell] of table) {
    const newCount = [...cell.byCheck.values()].reduce((a, b) => a + b, 0);
    const knownCount = [...cell.known.values()].reduce((a, b) => a + b, 0);
    newFailures += newCount;
    anyFailures += newCount + knownCount;
    const pass = cell.ended + cell.budget;
    const detail = [
      ...[...cell.byCheck].map(([name, count]) => `${name} x${count}`),
      ...[...cell.known].map(([id, count]) => `known ${id} x${count}`),
    ];
    rows.push(`${core.tag.padEnd(8)} ${format.padEnd(5)} pass ${String(pass).padStart(3)}/${cell.seeds} (ended ${cell.ended}, budget ${cell.budget})  fail ${newCount + knownCount} (new ${newCount}, known ${knownCount})  hang ${cell.hangs}  steps ${cell.steps}${detail.length ? `  [${detail.join("; ")}]` : ""}`);
  }
}
console.log(`\ncore     fmt   results\n${rows.join("\n")}`);
process.exit(newFailures > 0 || (flag("strict") && anyFailures > 0) ? 1 : 0);
