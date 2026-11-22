import { duelTestFiles } from "./duel-test-files.mjs";
import { PINNED_SHARDS, SHARED_ENGINE_SHARDS, LEGACY_SHARDS, SURRENDER_FILES, DIFFERENTIAL_FILES, TABLE_FILE, pinnedPlan, sharedEnginePlan } from "./engine-test-plan.mjs";
import { listVitestFiles, runVitestShard, saveTimings } from "./test-shards.mjs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const [lane, shard] = process.argv.slice(2);
const counts = { pinned: PINNED_SHARDS, shared: SHARED_ENGINE_SHARDS, legacy: LEGACY_SHARDS, surrender: SURRENDER_FILES.length, differential: 2, web: 1 };
const [index, count] = (shard ?? "").split("/").map(Number);
if (!Object.hasOwn(counts, lane) || count !== counts[lane] || !Number.isInteger(index) || index < 1 || index > count) {
  throw new Error("Expected a valid engine lane and shard index/count");
}

// Unset means the full suite. The selector emits an explicit empty duel list
// only when it found a focused web engine selection.
const requested = process.env.CI_TEST_FILES ? JSON.parse(process.env.CI_TEST_FILES) : undefined;
if (lane === "web" && !requested) throw new Error("The web dependent run requires an explicit file selection");
if (requested?.length === 0) process.exit(0);
const selected = requested;
const select = files => selected ? files.filter(file => selected.includes(file)) : files;
const duel = (files, args = [], env = {}) =>
  runVitestShard("duel-server", select(files), ["--testTimeout=15000", ...args], env);

if (lane === "pinned") {
  const { files, seconds } = pinnedPlan(duelTestFiles().engine)[index - 1];
  console.log(`Pinned shard ${shard}: ${select(files).length} files, ${Math.round(seconds)} estimated worker-seconds including reserved work`);
  const results = await duel(files, ["--config=vitest.ci.config.ts"], { TABLE_SHARD: shard });
  if (!selected) saveTimings("engine-pinned", index, { files: results });
} else if (lane === "legacy") {
  const args = ["--config=vitest.legacy.config.ts"];
  const results = await duel(listVitestFiles("duel-server", ["tests", ...args]), args);
  if (!selected) saveTimings("engine-legacy", index, { files: results });
} else if (lane === "surrender") {
  const file = SURRENDER_FILES[index - 1];
  // The same file is invoked for the two existing, disjoint case-name filters.
  // Both invocations get their own worker, report and failure status.
  const modes = ["normal", "domain"];
  const results = await Promise.allSettled(modes.map(mode =>
    duel([file], [`--testNamePattern=^${mode} host immediate surrender`])));
  for (const result of results) if (result.status === "rejected") throw result.reason;
  if (!selected) saveTimings("engine-surrender", index, Object.fromEntries(modes.map((mode, i) => [mode, results[i].value])));
} else if (lane === "differential") {
  await duel(DIFFERENTIAL_FILES, [], { DIFF_SHARD: shard });
} else if (lane === "shared") {
  if (requested) throw new Error("Shared engine shards require the full pinned and surrender inventory");
  const { files, seconds } = sharedEnginePlan(duelTestFiles().engine)[index - 1];
  if (!files.some(task => task.file === TABLE_FILE)) throw new Error("The engine Table suite was not discovered");
  // Table already partitions its row registrations without a collection pass.
  const assignments = files.map(task => task.file === TABLE_FILE ? { ...task, count: 1 } : task);
  const { runEngineCaseShards } = await import("./run-engine-case-shards.mjs");
  const root = fileURLToPath(new URL("../../packages/duel-server", import.meta.url));
  process.chdir(root);
  process.env.TABLE_SHARD = shard;
  console.log(`Shared engine shard ${shard}: ${Math.round(seconds)} estimated worker-seconds`);
  await runEngineCaseShards(root, assignments, { config: join(root, "vitest.ci.config.ts"), maxWorkers: 4, testTimeout: 15000 });
} else {
  await runVitestShard("web", selected);
}
