import Database from "better-sqlite3";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Worker } from "node:worker_threads";
import { describe, expect, it, vi } from "vitest";
import { migrate } from "@yugidraft/shared/db";
import { BridgeSearchJobs } from "../src/bridge-search-jobs.js";

describe("persistent bridge deep-search admission and lifecycle", () => {
  it.each(["upgrade", "recovery"])("retries startup %s after a writer lock exceeds five seconds", async phase => {
    const directory = mkdtempSync(join(tmpdir(), "bridge-startup-lock-"));
    const db = new Database(join(directory, "app.sqlite"));
    db.pragma("journal_mode = WAL"); migrate(db);
    const options = { execute: async () => [], project: () => ({ results: [], inReview: 0 }), version: () => "startup", now: () => 1_000_000 };
    await new BridgeSearchJobs(db, options).close();
    if (phase === "upgrade") {
      db.exec(`ALTER TABLE bridge_deep_job DROP COLUMN limit_refunded;
        ALTER TABLE bridge_deep_job DROP COLUMN review_incomplete;
        ALTER TABLE bridge_deep_actor DROP COLUMN counts_toward_limit;`);
    }
    db.exec(`INSERT INTO bridge_deep_job(id,query_key,query_json,state,step,created_at)
      VALUES('startup-running','startup','{}','running','rating',999000);
      INSERT INTO bridge_deep_actor(job_id,actor_hash,guild_id,admitted_at)
      VALUES('startup-running','startup','g',999000);`);
    const writer = new Worker(`
      const { parentPort, workerData } = require('node:worker_threads');
      const Database = require(workerData.sqlite);
      const db = new Database(workerData.path);
      db.exec('BEGIN IMMEDIATE');
      parentPort.once('message', () => setTimeout(() => {
        db.exec('COMMIT'); db.close(); parentPort.postMessage('released'); parentPort.close();
      }, 6250));
      parentPort.postMessage('locked');
    `, { eval: true, workerData: { path: db.name, sqlite: createRequire(import.meta.url).resolve("better-sqlite3") } });
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    let restarted: BridgeSearchJobs | undefined;
    try {
      expect((await once(writer, "message"))[0]).toBe("locked");
      const released = once(writer, "message");
      writer.postMessage("start");
      restarted = new BridgeSearchJobs(db, options);
      expect((await released)[0]).toBe("released");
      expect(warning).toHaveBeenCalledWith("[duel] startup database busy; retrying", expect.objectContaining({ operation: "bridge search jobs" }));
      expect(db.prepare("SELECT state,error,ended_at,limit_refunded FROM bridge_deep_job WHERE id='startup-running'").get())
        .toEqual({ state: "failed", error: "Bridge search was interrupted. Try again shortly.", ended_at: 1_000_000, limit_refunded: 1 });
      expect(db.prepare("SELECT ended_at,counts_toward_limit FROM bridge_deep_actor WHERE job_id='startup-running'").get())
        .toEqual({ ended_at: 1_000_000, counts_toward_limit: 1 });
      expect(db.pragma("busy_timeout", { simple: true })).toBe(5000);
      expect(db.inTransaction).toBe(false);
    } finally {
      await writer.terminate(); await restarted?.close(); warning.mockRestore(); db.close(); rmSync(directory, { recursive: true, force: true });
    }
  }, 15_000);
});
