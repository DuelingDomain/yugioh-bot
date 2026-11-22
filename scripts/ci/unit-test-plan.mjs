import { readFileSync } from "node:fs";
import { balanceFiles } from "./test-shards.mjs";

// File timings are summed across workers. On four-CPU GitHub runners the
// shared suite uses four workers, while duel leaves one CPU for child workers.
const suites = {
  shared: { timingsFile: "shared", target: 260, maxShards: 4 },
  duel_unit: { timingsFile: "duel-unit", target: 205, maxShards: 5 },
};

export function planUnitShards(suite, files, timings) {
  const { timingsFile, target, maxShards } = suites[suite];
  timings ??= JSON.parse(readFileSync(new URL(`./test-timings/${timingsFile}.json`, import.meta.url), "utf8")).files;
  const limit = Math.min(files.length, maxShards);
  for (let count = 1; count <= limit; count++) {
    const shards = balanceFiles(files, count, timings, 5);
    if (count === limit || shards.every(shard => shard.seconds <= target)) return shards;
  }
  throw new Error("A unit shard plan requires at least one selected file");
}
