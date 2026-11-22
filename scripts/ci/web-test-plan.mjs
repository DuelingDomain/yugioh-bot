import { readFileSync } from "node:fs";
import { balanceFiles } from "./test-shards.mjs";

export const WEB_FULL_SHARDS = 3;
export const WEB_DATA_SHARDS = 3;
export const WEB_TIMING_LANE = `web-${WEB_FULL_SHARDS}-shards`;

const timing = JSON.parse(readFileSync(new URL("./test-timings/web.json", import.meta.url), "utf8"));
// PR job logs report test time. Allow for setup and imports when the snapshot
// came from those logs instead of the timing reporter.
const estimates = Object.fromEntries(Object.entries(timing.files).map(([file, seconds]) =>
  [file, seconds + (timing.fileOverhead ?? 0)]));

export function webTestPlan(files, count, { full = false } = {}) {
  // Leave 15s of headroom on shard 1, whose PR run spent longer in setup and imports.
  const reserve = full ? 60 : 0;
  const shards = balanceFiles(files, count, estimates, 5, [reserve]);
  shards[0].seconds -= reserve;
  return shards;
}
