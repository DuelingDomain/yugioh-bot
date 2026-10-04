/** Vitest shards files; the large Table file also needs to shard its independent card rows. */
export function rowsForShard<T>(rows: readonly T[], shard?: string): readonly T[] {
  if (shard === undefined) return rows;
  const match = /^(\d+)\/(\d+)$/.exec(shard);
  const index = Number(match?.[1]);
  const count = Number(match?.[2]);
  if (!Number.isSafeInteger(index) || !Number.isSafeInteger(count) || index < 1 || count < index) {
    throw new Error(`Invalid Table shard: ${shard}`);
  }
  return rows.filter((_, row) => row % count === index - 1);
}
