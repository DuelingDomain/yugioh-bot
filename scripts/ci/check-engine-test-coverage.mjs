import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { createVitest } from "vitest/node";
import { duelTestFiles } from "./duel-test-files.mjs";
import { PINNED_SHARDS, SURRENDER_FILES, DIFFERENTIAL_FILES, TABLE_FILE, isPinnedFile, pinnedPlan, surrenderLeg } from "./engine-test-plan.mjs";

// Ask Vitest for its effective file lists without importing any test modules.
// This checks actual config discovery, not just the classifier's own inventory.
const root = new URL("../../", import.meta.url);
const cwd = fileURLToPath(new URL("packages/duel-server/", root));
function configuredFiles(config) {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL("node_modules/vitest/vitest.mjs", root)),
    "list", "--filesOnly", "--json", `--config=${config}`], { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout).map(entry => entry.file.slice(cwd.length)).sort();
}
const inventory = duelTestFiles();
const all = configuredFiles("vitest.config.ts");
const unit = configuredFiles("vitest.unit.config.ts");
const engine = configuredFiles("vitest.ci.config.ts");
const legacy = configuredFiles("vitest.legacy.config.ts");
assert.deepEqual(all, inventory.all, "The inventory must match Vitest discovery");
assert.deepEqual(unit, inventory.unit, "The unit config must run the unit partition");
assert.deepEqual(engine, inventory.engine.filter(file => !file.startsWith("tests/legacy-main/")));
assert.deepEqual([...new Set([...unit, ...engine, ...legacy])].sort(), all, "No file may be dropped");
assert.ok(unit.every(file => !engine.includes(file) && !legacy.includes(file)), "No unit-only file may run twice");

const { jobs } = parse(readFileSync(new URL(".github/workflows/test.yml", root), "utf8"));
const matrix = jobs["engine-shards"].strategy.matrix;
assert.deepEqual(matrix.suite, ["pinned"]);
assert.deepEqual(matrix.count, [PINNED_SHARDS]);
assert.deepEqual(matrix.shard, Array.from({ length: PINNED_SHARDS }, (_, i) => i + 1));
assert.deepEqual(matrix.include, [
  ...Array.from({ length: 4 }, (_, i) => ({ suite: "surrender", shard: i + 1, count: 4 })),
]);
assert.deepEqual(jobs["engine-differential"].strategy.matrix.shard, [1, 2]);
const plan = pinnedPlan(engine);
// --filesOnly does not apply Vitest's sequencer. Exercise the actual configured
// sequencer against Vitest specifications, still without collecting test modules.
const ctx = await createVitest("test", { root: cwd, config: "vitest.ci.config.ts", watch: false });
try {
  const specs = await ctx.globTestSpecifications();
  const sequencer = new ctx.config.sequence.sequencer(ctx);
  for (let index = 1; index <= PINNED_SHARDS; index++) {
    ctx.config.shard = { index, count: PINNED_SHARDS };
    const actual = await sequencer.shard(specs);
    assert.deepEqual(actual.map(spec => spec.moduleId.slice(cwd.length)).sort(), [...plan[index - 1].files].sort());
    const narrowed = specs.filter((_, i) => i % 7 === 0);
    assert.deepEqual(await sequencer.shard(narrowed), actual.filter(spec => narrowed.includes(spec)), "Changed-only filtering must retain full-plan ownership");
  }
} finally {
  await ctx.close();
}
const assigned = plan.flatMap(shard => shard.files);
for (const file of engine.filter(isPinnedFile)) {
  assert.equal(assigned.filter(candidate => candidate === file).length, file === TABLE_FILE ? PINNED_SHARDS : 1, file);
}
assert.ok(assigned.every(file => engine.includes(file) && isPinnedFile(file)));
for (const file of SURRENDER_FILES) {
  assert.ok(engine.includes(file));
  assert.deepEqual(Array.from({ length: 4 }, (_, i) => surrenderLeg(i + 1)).filter(leg => leg.file === file).map(leg => leg.mode), ["normal", "domain"]);
}
for (const file of DIFFERENTIAL_FILES) assert.ok(engine.includes(file)); // Both DIFF_SHARD seed partitions are unchanged.
const dualEngine = ["tests/host-engine-switch.test.ts", "tests/host.test.ts", "tests/legacy-engine-identity.test.ts"];
assert.deepEqual(legacy.filter(file => !file.startsWith("tests/legacy-main/")).sort(), dualEngine.sort());
assert.ok(legacy.filter(file => file.startsWith("tests/legacy-main/")).every(file => !engine.includes(file)));

console.log(`Duel files: ${all.length} = ${unit.length} unit-only + ${inventory.engine.length} engine; no omissions or unit/engine overlap.`);
console.log(`Engine ownership: ${engine.filter(isPinnedFile).length} pinned + ${SURRENDER_FILES.length} surrender + ${DIFFERENTIAL_FILES.length} differential + ${legacy.length - dualEngine.length} legacy-only.`);
console.log("Intentional partitions: Table rows across pinned shards, surrender by mode/part, differential by seeds; 3 host/identity gates also run on the other engine.");
for (const [index, shard] of plan.entries()) console.log(`Pinned ${index + 1}/${PINNED_SHARDS}: ${shard.files.length} files, estimated ${Math.round(shard.seconds)}s of file work (parallel workers).`);
