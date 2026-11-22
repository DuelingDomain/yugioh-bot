import { readFileSync } from "node:fs";
import { balanceFiles, listVitestFiles, runVitestShard, saveTimings } from "./test-shards.mjs";
import { WEB_FULL_SHARDS, WEB_DATA_SHARDS, WEB_TIMING_LANE } from "./web-test-plan.mjs";


const [shard, ...filters] = process.argv.slice(2);
const [index, count] = (shard ?? "").split("/").map(Number);
// PR runs pass the selected files; the shard count may be lower than the full plan.
const picked = process.env.CI_TEST_FILES ? JSON.parse(process.env.CI_TEST_FILES) : null;
if (picked && (!Array.isArray(picked) || !picked.length || filters.length)) {
  throw new Error("CI_TEST_FILES must be a nonempty list and cannot combine with explicit web files");
}
const validCount = filters.length ? count === WEB_DATA_SHARDS : picked ? count <= WEB_FULL_SHARDS : count === WEB_FULL_SHARDS;
if (!Number.isInteger(index) || !Number.isInteger(count) || index < 1 || index > count || !validCount) {
  throw new Error("Expected a valid web shard index/count");
}
const timing = JSON.parse(readFileSync(new URL("./test-timings/web.json", import.meta.url), "utf8"));
const args = ["--exclude=.next/**"];
const files = listVitestFiles("web", args);
if (filters.some(file => !files.includes(file))) throw new Error("Web data test is missing from Vitest discovery");
if (picked?.some(file => !files.includes(file))) throw new Error("Selected web test is missing from Vitest discovery");
const selected = filters.length ? filters : picked ?? files;
if (!selected.length) throw new Error("Web test discovery returned no files");
const { files: assigned, seconds } = balanceFiles(selected, count, timing.files, 5)[index - 1];
console.log(`Web shard ${index}/${count}: ${assigned.length}/${selected.length} files, ${Math.round(seconds)} estimated worker-seconds`);
const results = await runVitestShard("web", assigned, [...args, "--maxWorkers=4"]);
if (!filters.length && !picked) saveTimings(WEB_TIMING_LANE, index, { files: results });
