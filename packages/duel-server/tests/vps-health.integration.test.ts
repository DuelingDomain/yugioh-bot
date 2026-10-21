import Database from "better-sqlite3";
import { migrate } from "@yugidraft/shared/db";
import { collectVpsHealth, createHostSampler, createServiceReporter, readVpsHealth } from "@yugidraft/shared/health";
import { expect, it } from "vitest";
import { WorkerPool } from "../src/worker-pool.js";

it("persists actual worker reservations and queued replay rebuilds, including cancellation and release", async () => {
  const db = new Database(":memory:"); migrate(db);
  const pool = new WorkerPool(1, 3);
  const reporter = createServiceReporter({ db, service: "duel", capacity: () => pool.diagnostics() });
  const host = createHostSampler(); const at = Date.now();
  const release = await pool.acquire([1]);
  const waiting = pool.acquire([], true);
  try {
    reporter.tick(at); collectVpsHealth(db, host(), "guild", at);
    expect(readVpsHealth(db, "guild", at).current?.services.duel?.capacity).toEqual({ engineWorkers: 1, maxWorkers: 1, queuedRebuilds: 1 });
    release(); const replayRelease = await waiting;
    reporter.tick(at + 60_000); collectVpsHealth(db, host(), "guild", at + 60_000);
    expect(readVpsHealth(db, "guild", at + 60_000).current?.services.duel?.capacity).toEqual({ engineWorkers: 1, maxWorkers: 1, queuedRebuilds: 0 });
    replayRelease();
    const abort = new AbortController(); const busy = await pool.acquire([1]);
    const cancelled = pool.acquire([], true, abort.signal); const rejected = expect(cancelled).rejects.toThrow(); abort.abort(); await rejected;
    busy(); reporter.tick(at + 120_000); collectVpsHealth(db, host(), "guild", at + 120_000);
    expect(readVpsHealth(db, "guild", at + 120_000).current?.services.duel?.capacity).toEqual({ engineWorkers: 0, maxWorkers: 1, queuedRebuilds: 0 });
  } finally { release(); pool.close(); db.close(); }
});
