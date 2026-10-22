import { log } from "@yugidraft/shared/observability";
import assert from "node:assert/strict";
import type Database from "better-sqlite3";

const pause = new Int32Array(new SharedArrayBuffer(4));

/** Only for synchronous, retry-safe startup work, before timers or requests run.
 * SQLite rolls back failed transactions; openDatabase closes failed connections.
 * The normal five-second busy timeout still applies to each attempt.
 * Pass db for existing connections so no attempt can reuse an open transaction.
 */
export function retryStartupDatabase<T>(operation: string, run: () => T,
  { db, timeoutMs = 60_000 }: { db?: Database.Database; timeoutMs?: number } = {}): T {
  const started = performance.now();
  let delayMs = 100;
  let attempt = 0;
  for (;;) {
    assert(!db?.inTransaction, "Startup database retries must run outside a transaction");
    try { return run(); }
    catch (error) {
      const code = (error as { code?: unknown } | null)?.code;
      if (typeof code !== "string" || (code !== "SQLITE_BUSY" && !code.startsWith("SQLITE_BUSY_"))) throw error;
      const elapsedMs = performance.now() - started;
      const remainingMs = timeoutMs - elapsedMs;
      if (remainingMs <= 0) throw error;
      const waitMs = Math.min(delayMs, remainingMs);
      log("warn", "[duel] startup database busy; retrying", { operation, code, attempt: ++attempt,
        elapsedMs: Math.floor(elapsedMs), delayMs: waitMs });
      // Startup has no requests to serve. Another process/thread owns the lock
      // and can release it while this synchronous factory waits.
      Atomics.wait(pause, 0, 0, waitMs);
      if (performance.now() - started >= timeoutMs) throw error;
      delayMs = Math.min(delayMs * 2, 1_000);
    }
  }
}
