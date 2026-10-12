export function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function workerLimitsFromEnv() {
  return {
    // The worker cap guards memory because WASM memory is outside the heap limit.
    maxWorkers: positiveInteger(process.env.DUEL_MAX_WORKERS, 12),
    maxTablesPerPlayer: positiveInteger(process.env.DUEL_MAX_TABLES_PER_PLAYER, 3),
    heapMb: positiveInteger(process.env.DUEL_WORKER_HEAP_MB, 256),
    createTimeoutMs: positiveInteger(process.env.DUEL_CREATE_TIMEOUT_MS, 120000),
    opTimeoutMs: positiveInteger(process.env.DUEL_OP_TIMEOUT_MS, 15000),
  };
}
