import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parse } from "yaml";
import { duelTestFiles } from "./duel-test-files.mjs";
import { PINNED_SHARDS, LEGACY_SHARDS, SURRENDER_FILES, DIFFERENTIAL_FILES, TABLE_FILE, isPinnedFile, pinnedPlan } from "./engine-test-plan.mjs";
import { listVitestFiles, verifyFiles } from "./test-shards.mjs";

// Ask Vitest for its effective file lists without importing any test modules.
// This checks actual config discovery, not just the classifier's own inventory.
const root = new URL("../../", import.meta.url);
const configuredFiles = config => listVitestFiles("duel-server", [`--config=${config}`]);
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
assert.equal(matrix.include, "${{ fromJSON(needs.changes.outputs.engine_matrix) }}");
assert.equal(jobs.changes.outputs.engine_matrix, "${{ steps.diff.outputs.engine_matrix }}");
assert.deepEqual(jobs["engine-legacy-shards"].strategy.matrix.shard, Array.from({ length: LEGACY_SHARDS }, (_, i) => i + 1));
assert.deepEqual(jobs["engine-differential"].strategy.matrix.shard, [1, 2]);
const plan = pinnedPlan(engine);
const assigned = plan.flatMap(shard => shard.files.filter(file => file !== TABLE_FILE));
verifyFiles(engine.filter(file => isPinnedFile(file) && file !== TABLE_FILE), assigned);
for (const shard of plan) assert.equal(shard.files.filter(file => file === TABLE_FILE).length, 1);
for (const file of SURRENDER_FILES) assert.ok(engine.includes(file));
for (const file of DIFFERENTIAL_FILES) assert.ok(engine.includes(file)); // Both DIFF_SHARD seed partitions are unchanged.
const dualEngine = ["tests/host-engine-switch.test.ts", "tests/host.test.ts", "tests/legacy-engine-identity.test.ts"];
assert.deepEqual(legacy.filter(file => !file.startsWith("tests/legacy-main/")).sort(), dualEngine.sort());
assert.ok(legacy.filter(file => file.startsWith("tests/legacy-main/")).every(file => !engine.includes(file)));

console.log(`Duel files: ${all.length} = ${unit.length} unit-only + ${inventory.engine.length} engine; no omissions or unit/engine overlap.`);
console.log(`Engine ownership: ${engine.filter(isPinnedFile).length} pinned + ${SURRENDER_FILES.length} surrender + ${DIFFERENTIAL_FILES.length} differential + ${legacy.length - dualEngine.length} legacy-only.`);
console.log("Intentional partitions: Table rows across pinned shards, surrender by mode/part, differential by seeds; 3 host/identity gates also run on the other engine.");
for (const [index, shard] of plan.entries()) console.log(`Pinned ${index + 1}/${PINNED_SHARDS}: ${shard.files.length} files, estimated ${Math.round(shard.seconds)}s of file work (parallel workers).`);
