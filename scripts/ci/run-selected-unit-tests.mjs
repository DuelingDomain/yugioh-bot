import { planUnitShards } from "./unit-test-plan.mjs";
import { runVitestShard } from "./test-shards.mjs";

const [suite, shard] = process.argv.slice(2);
const files = JSON.parse(process.env.CI_TEST_FILES);
if (!Array.isArray(files) || !files.length || files.some(file => typeof file !== "string" || !file || file.startsWith("-"))) {
  throw new Error("Expected a nonempty list of workspace-relative test files");
}
const plan = planUnitShards(suite, files);
const [index, count] = (shard ?? "").split("/").map(Number);
if (!Number.isInteger(index) || index < 1 || index > count || count !== plan.length) {
  throw new Error("Unit shard matrix does not match the selected file plan");
}
const { files: assigned, seconds } = plan[index - 1];
console.log(`${suite} shard ${shard}: ${assigned.length}/${files.length} files, ${Math.round(seconds)} estimated worker-seconds`);
const duel = suite === "duel_unit";
await runVitestShard(duel ? "duel-server" : "shared", assigned,
  duel ? ["--config=vitest.unit.config.ts", "--testTimeout=15000"] : []);
