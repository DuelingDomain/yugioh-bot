import { expect, it, vi } from "vitest";
import { workerLimitsFromEnv } from "../src/config.js";
import { WorkerPool } from "../src/worker-pool.js";

it("admits twelve workers with default capacity and refuses the next", async () => {
  vi.stubEnv("DUEL_MAX_WORKERS", "");
  vi.stubEnv("DUEL_MAX_TABLES_PER_PLAYER", "");
  try {
    const limits = workerLimitsFromEnv();
    const pool = new WorkerPool(limits.maxWorkers, limits.maxTablesPerPlayer);
    const releases = [];
    for (let player = 1; player <= 12; player++) releases.push(await pool.acquire([player]));
    await expect(pool.acquire([13])).rejects.toMatchObject({ status: 429 });
    for (const release of releases) release();
    pool.close();
  } finally { vi.unstubAllEnvs(); }
});
