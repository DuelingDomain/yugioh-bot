import { readFileSync } from "node:fs";

export const PINNED_SHARDS = 8;
export const SURRENDER_FILES = ["tests/host-surrender-eot.test.ts", "tests/host-surrender-eot-part2.test.ts"];
export const DIFFERENTIAL_FILES = ["tests/differential/differential.test.ts", "tests/differential/differential-extended.test.ts"];
export const TABLE_FILE = "tests/multi-scripts-table.test.ts";
export const timings = JSON.parse(readFileSync(new URL("./engine-test-times.json", import.meta.url), "utf8"));
export const isPinnedFile = file => !file.startsWith("tests/legacy-main/") && !SURRENDER_FILES.includes(file) && !DIFFERENTIAL_FILES.includes(file);
export const fileSeconds = file => file === TABLE_FILE ? timings.tableTotal / PINNED_SHARDS : timings.files[file] ?? 10; // New files always run; timing data is only a scheduling hint.

/** Longest-processing-time placement, stable across full and changed-only runs.
 * Every shard also runs its own Table rows. New files participate immediately.
 */
export function pinnedPlan(files, count = PINNED_SHARDS) {
  const shards = Array.from({ length: count }, () => ({ files: [], seconds: timings.tableTotal / count }));
  const regular = files.filter(file => file !== TABLE_FILE && isPinnedFile(file))
    .sort((a, b) => fileSeconds(b) - fileSeconds(a) || a.localeCompare(b));
  for (const file of regular) {
    const shard = shards.reduce((best, next) => next.seconds < best.seconds ? next : best);
    shard.files.push(file);
    shard.seconds += fileSeconds(file);
  }
  if (files.includes(TABLE_FILE)) for (const shard of shards) shard.files.push(TABLE_FILE);
  return shards;
}

export function surrenderLeg(index) {
  return { file: SURRENDER_FILES[(index - 1) % 2], mode: index <= 2 ? "normal" : "domain" };
}
