import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Worker } from "node:worker_threads";
import { afterEach, describe, expect, it, vi } from "vitest";
import { migrate } from "@yugidraft/shared/db";
import { importBridgeArtifact, type ArchetypeBridge } from "@yugidraft/shared/cards/effects";
import { BridgeReviewUnavailableError, BridgeSearchJobs } from "../src/bridge-search-jobs.js";

const query = (source = "Odion") => ({ source, format: "advanced" as const });
const actor = (userId = 1, guildId = "g") => ({ userId, guildId });
const databases: Database.Database[] = [];
function setup(inReview = 2) {
  const db = new Database(":memory:"); databases.push(db); migrate(db);
  let now = 1_000_000, version = "v1";
  const releases: (() => void)[] = [];
  const results: ArchetypeBridge[] = [];
  const execute = vi.fn(async (_query, progress) => {
    progress("checking", 50);
    await new Promise<void>(resolve => releases.push(resolve));
    progress("rating", 90);
    return results;
  });
  const jobs = new BridgeSearchJobs(db, { execute, project: () => ({ results: [], inReview }), version: () => version, now: () => now });
  const finish = async () => { releases.shift()!(); await new Promise(resolve => setImmediate(resolve)); };
  return { db, jobs, execute, finish, results, updateVersion: (value: string) => { version = value; }, advance: (ms: number) => { now += ms; } };
}
afterEach(() => { for (const db of databases.splice(0)) db.close(); });

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

  it("backfills only interrupted and failed-save refunds when upgrading historical jobs", async () => {
    const { db, jobs } = setup();
    await jobs.close();
    db.exec("ALTER TABLE bridge_deep_job DROP COLUMN limit_refunded");
    const interrupted = "Bridge search was interrupted. Try again shortly.";
    const unsaved = "Bridge search completion could not be saved. Try again shortly.";
    const historical = [
      ...Array.from({ length: 16 }, (_, i) => ({ state: "failed", error: i % 2 ? interrupted : unsaved, refunded: 1 })),
      { state: "failed", error: "Bridge search could not finish. Try again shortly.", refunded: 0 },
      { state: "failed", error: "Review service unavailable, try later.", refunded: 0 },
      { state: "done", error: interrupted, refunded: 0 },
      { state: "failed", error: `${unsaved} Other failure.`, refunded: 0 },
    ];
    const hash = createHash("sha256").update("bridge-user:1").digest("hex");
    for (const [i, row] of historical.entries()) {
      db.prepare(`INSERT INTO bridge_deep_job(id,query_key,query_json,state,step,error,created_at,ended_at)
        VALUES(?,?,'{}',?,'done',?,999000,999001)`).run(`legacy-${i}`, `legacy-${i}`, row.state, row.error);
      db.prepare("INSERT INTO bridge_deep_actor(job_id,actor_hash,guild_id,admitted_at,ended_at) VALUES(?,?,'g',999000,999001)")
        .run(`legacy-${i}`, hash);
    }
    const options = { execute: async () => [], project: () => ({ results: [], inReview: 0 }), version: () => "v1", now: () => 1_000_000 };
    for (let restart = 0; restart < 2; restart++) {
      const upgraded = new BridgeSearchJobs(db, options);
      try {
        for (const [i, row] of historical.entries()) {
          expect(db.prepare("SELECT limit_refunded FROM bridge_deep_job WHERE id=?").get(`legacy-${i}`))
            .toEqual({ limit_refunded: row.refunded });
        }
        expect(upgraded.start(actor(), query(`After upgrade ${restart}`))).toMatchObject({ state: "running" });
      } finally { await upgraded.close(); }
    }
  });

  it("joins only existing work without admitting or charging jobs, including across restart", async () => {
    const { db, jobs, execute, finish, advance } = setup(0);
    for (let i = 0; i < 16; i++) {
      expect(() => jobs.start(actor(2), query(`Missing ${i}`), true)).toThrowError(expect.objectContaining({ status: 404 }));
    }
    expect(db.prepare("SELECT count(*) AS n FROM bridge_deep_job").get()).toEqual({ n: 0 });
    expect(db.prepare("SELECT count(*) AS n FROM bridge_deep_actor").get()).toEqual({ n: 0 });
    expect(execute).not.toHaveBeenCalled();
    const shared = jobs.start(actor(), query());
    expect(jobs.start(actor(2), { ...query(), deckCards: [1], genesysRemaining: 0 }, true))
      .toMatchObject({ jobId: shared.jobId, state: "running", cached: false });
    await finish(); advance(1);
    expect(jobs.start(actor(2), { ...query(), deckCards: [2], genesysRemaining: 5 }, true))
      .toMatchObject({ jobId: shared.jobId, state: "done", cached: true });
    expect(db.prepare("SELECT deck_cards_json,genesys_remaining FROM bridge_deep_actor WHERE job_id=? AND counts_toward_limit=0").get(shared.jobId))
      .toEqual({ deck_cards_json: "[2]", genesys_remaining: 5 });
    expect(execute).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 15; i++) { jobs.start(actor(2), query(`Paid ${i}`)); await finish(); advance(1); }
    expect(() => jobs.start(actor(2), query("Sixteenth"))).toThrowError(expect.objectContaining({ status: 429 }));
    // Joining running work bypasses exhausted admission, and stays free when it completes.
    const running = jobs.start(actor(3), query("Shared at limit"));
    expect(jobs.start(actor(2), query("Shared at limit"), true)).toMatchObject({ jobId: running.jobId, cached: false });
    expect(() => jobs.start(actor(2), query("Different"), true)).toThrowError(expect.objectContaining({ status: 409 }));
    await finish(); advance(1);
    await jobs.close();
    let version = "v1", now = 1_000_017;
    const restarted = new BridgeSearchJobs(db, { execute, project: () => ({ results: [], inReview: 0 }), version: () => version, now: () => now });
    try {
      expect(restarted.start(actor(2), query(), true)).toMatchObject({ jobId: shared.jobId, cached: true });
      expect(() => restarted.start(actor(2), query("Missing"), true)).toThrowError(expect.objectContaining({ status: 404 }));
      expect(() => restarted.start(actor(2), query("Sixteenth"))).toThrowError(expect.objectContaining({ status: 429 }));
      expect(db.prepare("SELECT count(*) AS n FROM bridge_deep_actor WHERE counts_toward_limit=1").get()).toEqual({ n: 17 });
      version = "v2";
      expect(() => restarted.start(actor(4), query(), true)).toThrowError(expect.objectContaining({ status: 404 }));
      version = "v1"; now += 86_400_001;
      expect(() => restarted.start(actor(4), query(), true)).toThrowError(expect.objectContaining({ status: 404 }));
    } finally { await restarted.close(); }
    expect(execute).toHaveBeenCalledTimes(17);
  });

  it("uses only reads for an absent join under a held writer lock and rejects starts with 503", async () => {
    const directory = mkdtempSync(join(tmpdir(), "bridge-admission-lock-"));
    const statements: string[] = [];
    const db = new Database(join(directory, "app.sqlite"), { verbose: sql => { statements.push(String(sql)); } });
    db.pragma("journal_mode = WAL"); migrate(db);
    const execute = vi.fn(async () => []);
    const jobs = new BridgeSearchJobs(db, { execute, project: () => ({ results: [], inReview: 0 }), version: () => "admission-lock", completionTimeoutMs: 1 });
    const writer = new Database(db.name);
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      // Keep a real failed completion pending in memory. Joining must not try
      // to flush it or acquire any write transaction before returning 404.
      db.exec(`CREATE TEMP TRIGGER fail_bridge_terminal BEFORE UPDATE ON bridge_deep_job
        WHEN NEW.state IN ('done','failed') BEGIN SELECT RAISE(FAIL,'unsaved completion'); END`);
      const failed = jobs.start(actor(), query());
      await vi.waitFor(async () => expect((await jobs.status(actor(), failed.jobId)).state).toBe("failed"));
      expect(db.prepare("SELECT state FROM bridge_deep_job WHERE id=?").get(failed.jobId)).toEqual({ state: "running" });
      db.exec("DROP TRIGGER fail_bridge_terminal");
      writer.exec("BEGIN IMMEDIATE");
      statements.length = 0;
      const started = performance.now();
      expect(() => jobs.start(actor(2), query("Absent"), true)).toThrowError(expect.objectContaining({ status: 404 }));
      expect(statements.length).toBeGreaterThan(0);
      expect(statements.every(sql => /^SELECT\b/i.test(sql.trim()))).toBe(true);
      expect(() => jobs.start(actor(2), query("Absent"))).toThrowError(expect.objectContaining({ status: 503, retryAfter: 1 }));
      expect(performance.now() - started).toBeLessThan(1000);
      expect(writer.inTransaction).toBe(true);
      expect(db.pragma("busy_timeout", { simple: true })).toBe(5000);
      expect(db.inTransaction).toBe(false);
      expect(db.prepare("SELECT count(*) AS n FROM bridge_deep_job").get()).toEqual({ n: 1 });
      expect(db.prepare("SELECT count(*) AS n FROM bridge_deep_actor").get()).toEqual({ n: 1 });
      expect(execute).toHaveBeenCalledTimes(1);
    } finally {
      if (writer.inTransaction) writer.exec("ROLLBACK");
      await jobs.close(); warning.mockRestore(); writer.close(); db.close(); rmSync(directory, { recursive: true, force: true });
    }
  });

  it("refunds queued and running interruptions across restart without exhausting admission", async () => {
    const { db, jobs } = setup();
    await jobs.close();
    const hash = createHash("sha256").update("bridge-user:1").digest("hex");
    for (let i = 0; i < 16; i++) {
      db.prepare(`INSERT INTO bridge_deep_job(id,query_key,query_json,state,step,created_at)
        VALUES(?,?,'{}',?,'checking',999000)`).run(`interrupted-${i}`, `interrupted-${i}`, i % 2 ? "queued" : "running");
      db.prepare("INSERT INTO bridge_deep_actor(job_id,actor_hash,guild_id,admitted_at) VALUES(?,?,'g',999000)")
        .run(`interrupted-${i}`, hash);
    }
    const options = { execute: async () => [], project: () => ({ results: [], inReview: 0 }), version: () => "v1", now: () => 1_000_000 };
    const restarted = new BridgeSearchJobs(db, options);
    try {
      expect(db.prepare("SELECT count(*) AS n FROM bridge_deep_job WHERE state='failed' AND limit_refunded=1 AND error=?")
        .get("Bridge search was interrupted. Try again shortly.")).toEqual({ n: 16 });
      expect(db.prepare("SELECT count(*) AS n FROM bridge_deep_actor WHERE ended_at=1000000").get()).toEqual({ n: 16 });
      expect(restarted.start(actor(), query())).toMatchObject({ state: "running" });
    } finally { await restarted.close(); }
    const again = new BridgeSearchJobs(db, options);
    try { expect(again.start(actor(), query("After another restart"))).toMatchObject({ state: "running" }); }
    finally { await again.close(); }
  });

  it.each([
    ["provider", new Error("provider failure"), "Bridge search could not finish. Try again shortly."],
    ["review", new BridgeReviewUnavailableError(), "Review service unavailable, try later."],
  ] as const)("charges fifteen paid %s failures and rejects the sixteenth with 429 across restart", async (_kind, failure, message) => {
    const { db, jobs } = setup();
    await jobs.close();
    const execute = vi.fn(async () => { throw failure; });
    const options = { execute, project: () => ({ results: [], inReview: 0 }), version: () => "paid-failure", now: () => 1_000_000 };
    const paid = new BridgeSearchJobs(db, options);
    try {
      for (let i = 0; i < 15; i++) {
        const job = paid.start(actor(), query(`Paid failure ${i}`));
        await new Promise(resolve => setImmediate(resolve));
        expect(await paid.status(actor(), job.jobId)).toMatchObject({ state: "failed", error: message });
      }
      expect(db.prepare("SELECT count(*) AS n FROM bridge_deep_job WHERE state='failed' AND limit_refunded=0").get()).toEqual({ n: 15 });
      expect(() => paid.start(actor(1, "other"), query("Sixteenth"))).toThrowError(expect.objectContaining({ status: 429, retryAfter: 3600 }));
    } finally { await paid.close(); }
    const restarted = new BridgeSearchJobs(db, options);
    try {
      expect(() => restarted.start(actor(), query("Sixteenth"))).toThrowError(expect.objectContaining({ status: 429, retryAfter: 3600 }));
      expect(execute).toHaveBeenCalledTimes(15);
    } finally { await restarted.close(); }
  });

  it("keeps a finished result through a real SQLite writer lock longer than five seconds", async () => {
    const directory = mkdtempSync(join(tmpdir(), "bridge-completion-lock-"));
    const db = new Database(join(directory, "app.sqlite"));
    db.pragma("journal_mode = WAL"); migrate(db);
    const writer = new Database(db.name);
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const execute = vi.fn(async () => { await gate; return []; });
    const jobs = new BridgeSearchJobs(db, { execute, project: () => ({ results: [], inReview: 0 }), version: () => "writer-lock" });
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const job = jobs.start(actor(), query());
      writer.exec("BEGIN IMMEDIATE");
      release();
      await new Promise(resolve => setTimeout(resolve, 5500));
      expect((await jobs.status(actor(), job.jobId)).state).toBe("running");
      writer.exec("COMMIT");
      await vi.waitFor(async () => expect((await jobs.status(actor(), job.jobId)).state).toBe("done"));
      expect(execute).toHaveBeenCalledTimes(1);
    } finally {
      release(); if (writer.inTransaction) writer.exec("ROLLBACK");
      await jobs.close(); warning.mockRestore(); writer.close(); db.close(); rmSync(directory, { recursive: true, force: true });
    }
  }, 15_000);

  it("does not charge failed completion saves against the hourly limit, including after restart", async () => {
    const { db } = setup();
    const options = { execute: async () => [], project: () => ({ results: [], inReview: 0 }), version: () => "save-refund", completionTimeoutMs: 1 };
    const jobs = new BridgeSearchJobs(db, options);
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    db.exec(`CREATE TEMP TRIGGER fail_bridge_done BEFORE UPDATE ON bridge_deep_job
      WHEN NEW.state='done' BEGIN SELECT RAISE(FAIL,'completion cannot be saved'); END`);
    try {
      for (let i = 0; i < 16; i++) {
        const job = jobs.start(actor(), query(`Save failure ${i}`));
        await vi.waitFor(async () => expect((await jobs.status(actor(), job.jobId)).state).toBe("failed"));
      }
      expect(db.prepare("SELECT count(*) AS n FROM bridge_deep_job WHERE state='failed' AND limit_refunded=1 AND error=?")
        .get("Bridge search completion could not be saved. Try again shortly.")).toEqual({ n: 16 });
      expect((jobs as unknown as { failedCompletions: Map<string, string> }).failedCompletions.size).toBe(0);
      await jobs.close(); db.exec("DROP TRIGGER fail_bridge_done");
      const restarted = new BridgeSearchJobs(db, options);
      try { expect(restarted.start(actor(), query())).toMatchObject({ state: "running" }); }
      finally { await restarted.close(); }
    } finally { await jobs.close(); warning.mockRestore(); }
  });

  it("deduplicates and throttles progress writes while persisting final completion", async () => {
    const { db } = setup();
    const prepare = vi.spyOn(db, "prepare");
    let now = 1_000_000;
    const jobs = new BridgeSearchJobs(db, { version: () => "progress-fixture", now: () => now,
      project: () => ({ results: [], inReview: 0 }), execute: async (_query, progress) => {
        for (let i = 0; i < 184; i++) progress("candidates", Math.floor(28 * i / 184));
        progress("checking", 30); progress("rating", 35);
        now += 1001; progress("rating", 70); progress("rating", 70);
        return [];
      } });
    try {
      const job = jobs.start(actor(), query()); await jobs.close();
      expect((await jobs.status(actor(), job.jobId))).toMatchObject({ state: "done", progress: 100 });
      expect(prepare.mock.calls.filter(([sql]) => sql.startsWith("UPDATE bridge_deep_job SET step="))).toHaveLength(2);
    } finally { prepare.mockRestore(); await jobs.close(); }
  });

  it("retries a failed completion transaction without an unhandled rejection", async () => {
    const { db, jobs, finish } = setup();
    db.exec(`CREATE TEMP TRIGGER fail_bridge_completion BEFORE UPDATE ON bridge_deep_job
      WHEN NEW.state='done' BEGIN SELECT RAISE(FAIL,'injected completion fault'); END`);
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const job = jobs.start(actor(), query()); await finish();
      expect((await jobs.status(actor(), job.jobId)).state).toBe("running");
      db.exec("DROP TRIGGER fail_bridge_completion");
      await vi.waitFor(async () => expect((await jobs.status(actor(), job.jobId)).state).toBe("done"));
      expect(warning).toHaveBeenCalled();
    } finally { await jobs.close(); warning.mockRestore(); }
  });

  it("contains drain write failures and retries queued jobs", async () => {
    const { db, jobs, execute, finish } = setup();
    db.exec(`CREATE TEMP TRIGGER fail_bridge_drain BEFORE UPDATE ON bridge_deep_job
      WHEN NEW.state='running' BEGIN SELECT RAISE(FAIL,'injected drain fault'); END`);
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const job = jobs.start(actor(), query());
      expect(job.state).toBe("queued");
      db.exec("DROP TRIGGER fail_bridge_drain");
      await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(1));
      await finish();
      expect((await jobs.status(actor(), job.jobId)).state).toBe("done");
    } finally { await jobs.close(); warning.mockRestore(); }
  });

  it("expires permanent completion failures in memory and frees global and actor slots", async () => {
    const { db } = setup();
    const execute = vi.fn(async () => []);
    const jobs = new BridgeSearchJobs(db, { execute, project: () => ({ results: [], inReview: 0 }), version: () => "deadline",
      completionTimeoutMs: 100 });
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    db.exec(`CREATE TEMP TRIGGER fail_bridge_terminal BEFORE UPDATE ON bridge_deep_job
      WHEN OLD.state='running' AND NEW.state IN ('done','failed') AND OLD.query_json LIKE '%Odion%'
      BEGIN SELECT RAISE(FAIL,'permanent completion fault'); END`);
    try {
      const first = jobs.start(actor(), query());
      const second = jobs.start(actor(2), { ...query(), target: "Ashtra" });
      const third = jobs.start(actor(3), query("Blue-Eyes"));
      expect(third.state).toBe("queued");
      await vi.waitFor(async () => expect((await jobs.status(actor(3), third.jobId)).state).toBe("done"));
      expect(await jobs.status(actor(), first.jobId)).toMatchObject({ state: "failed", error: expect.stringContaining("could not be saved") });
      expect((await jobs.status(actor(2), second.jobId)).state).toBe("failed");
      expect(db.prepare("SELECT state FROM bridge_deep_job WHERE id=?").get(first.jobId)).toEqual({ state: "running" });
      expect(jobs.start(actor(), query("Argostars"))).toMatchObject({ state: "running" });
      expect(execute).toHaveBeenCalledTimes(4);
      db.exec("DROP TRIGGER fail_bridge_terminal");
      jobs.start(actor(4), query("Recovered"));
      expect(db.prepare("SELECT state FROM bridge_deep_job WHERE id=?").get(first.jobId)).toEqual({ state: "failed" });
      expect((jobs as unknown as { failedCompletions: Map<string, string> }).failedCompletions.size).toBe(0);
    } finally { db.exec("DROP TRIGGER IF EXISTS fail_bridge_terminal"); await jobs.close(); warning.mockRestore(); }
  });

  it("shares a sorted multi-engine key without deck context and charges it as one search", async () => {
    const { db, jobs, execute, finish } = setup(0);
    const multi = { ...query(), engines: ["Odion", "Ashtra"], deckCards: [1], genesysRemaining: 100 };
    const first = jobs.start(actor(), multi);
    expect(jobs.start(actor(2), { ...multi, engines: ["ashtra", "odion"], deckCards: [2], genesysRemaining: 5 }).jobId).toBe(first.jobId);
    expect(execute).toHaveBeenCalledTimes(1);
    const stored = JSON.parse((db.prepare("SELECT query_json FROM bridge_deep_job WHERE id=?").get(first.jobId) as { query_json: string }).query_json);
    expect(stored).not.toHaveProperty("deckCards"); expect(stored).not.toHaveProperty("genesysRemaining");
    expect(db.prepare("SELECT count(*) AS n FROM bridge_deep_actor WHERE job_id=?").get(first.jobId)).toEqual({ n: 2 });
    await finish();
    expect(jobs.start(actor(3), { ...multi, deckCards: [3] })).toMatchObject({ jobId: first.jobId, cached: true });
    for (let i = 1; i < 15; i++) { jobs.start(actor(), { ...query(), engines: ["Odion", `Other ${i}`] }); await finish(); }
    expect(() => jobs.start(actor(), { ...query(), engines: ["Odion", "Sixteenth"] })).toThrowError(expect.objectContaining({ status: 429 }));
  });

  it("preserves the single-engine key and expires completed work after 24 hours or a version change", async () => {
    const { jobs, finish, results, advance, updateVersion } = setup(0);
    const first = jobs.start(actor(), query()); await finish();
    expect(jobs.start(actor(2), { ...query(), engines: ["Odion"] })).toMatchObject({ jobId: first.jobId, cached: true });
    expect(jobs.start(actor(3), query())).toMatchObject({ jobId: first.jobId, cached: true });
    updateVersion("v2"); await expect(jobs.status(actor(), first.jobId)).rejects.toThrowError(expect.objectContaining({ status: 404 }));
    updateVersion("v1"); advance(86_400_001);
    expect(jobs.start(actor(4), query()).cached).toBe(false); await finish();
  });
  it("coalesces repeat clicks, polls progress, and scopes job access to user and guild", async () => {
    const { jobs, execute, finish } = setup();
    const first = jobs.start(actor(), query());
    expect(jobs.start(actor(), query()).jobId).toBe(first.jobId);
    for (const changed of [query("Blue-Eyes"), { ...query(), target: "Argostars" }, { ...query(), format: "genesys" as const }]) {
      expect(() => jobs.start(actor(), changed)).toThrowError(expect.objectContaining({
        status: 409, message: "A deep search for Odion is still running", retryAfter: 10,
      }));
    }
    await new Promise(resolve => setImmediate(resolve));
    expect(execute).toHaveBeenCalledTimes(1);
    expect((await jobs.status(actor(), first.jobId))).toMatchObject({ state: "running", step: "checking", progress: 50 });
    await expect(jobs.status(actor(2), first.jobId)).rejects.toThrow("Not found");
    await expect(jobs.status(actor(1, "other"), first.jobId)).rejects.toThrow("Not found");
    await finish();
    expect((await jobs.status(actor(), first.jobId))).toMatchObject({ state: "done", step: "done", progress: 100, results: [], inReview: 2 });
  });

  it("admits another search immediately after completion and reuses identical results for 24 hours", async () => {
    const { jobs, finish, advance, execute } = setup(0);
    const first = jobs.start(actor(), query());
    advance(120_000); await finish();
    expect(jobs.start(actor(), query())).toMatchObject({ jobId: first.jobId, cached: true });
    expect(jobs.start(actor(2), query())).toMatchObject({ jobId: first.jobId, cached: true });
    expect((await jobs.status(actor(2), first.jobId)).state).toBe("done");
    jobs.start(actor(), query("Blue-Eyes")); await finish();
    advance(86_400_001);
    expect(jobs.start(actor(2), query()).cached).toBe(false);
    await finish(); expect(execute).toHaveBeenCalledTimes(3);
  });

  it("expires incomplete reviews after ten minutes so another search can retry", async () => {
    const { db, jobs, finish, advance, execute, results } = setup();
    importBridgeArtifact(db);
    results.push(JSON.parse((db.prepare("SELECT bridge_json FROM archetype_bridge WHERE source='Odion' AND target='Argostars' AND format='advanced'").get() as { bridge_json: string }).bridge_json));
    const first = jobs.start(actor(), query());
    await finish();
    expect(jobs.start(actor(2), query())).toMatchObject({ jobId: first.jobId, cached: true });
    advance(600_001);
    const retry = jobs.start(actor(2), query());
    expect(retry.cached).toBe(false);
    expect(retry.jobId).not.toBe(first.jobId);
    await finish();
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("invalidates resumed job IDs when artifact or prompt versions change", async () => {
    const { jobs, finish, updateVersion } = setup();
    const first = jobs.start(actor(), query());
    await finish();
    expect((await jobs.status(actor(), first.jobId)).state).toBe("done");
    updateVersion("v2");
    await expect(jobs.status(actor(), first.jobId)).rejects.toThrowError(expect.objectContaining({ status: 404 }));
    const next = jobs.start(actor(), query());
    expect(next).toMatchObject({ cached: false });
    expect(next.jobId).not.toBe(first.jobId);
    await finish();
    await jobs.close();
  });

  it("runs two jobs and queues the rest, sharing an identical in-flight query", async () => {
    const { jobs, execute, finish } = setup();
    jobs.start(actor(), query()); jobs.start(actor(2), query("Blue-Eyes"));
    const queued = jobs.start(actor(3), query("Argostars"));
    expect(queued.state).toBe("queued");
    expect(jobs.start(actor(4), query("Argostars")).jobId).toBe(queued.jobId);
    expect(execute).toHaveBeenCalledTimes(2);
    await finish(); expect(execute).toHaveBeenCalledTimes(3);
    await finish(); await finish();
  });

  it("returns queue overload as 503 rather than an hourly-limit countdown", async () => {
    const { jobs, finish } = setup();
    for (let i = 1; i <= 102; i++) jobs.start(actor(i), query(`Engine ${i}`));
    expect(() => jobs.start(actor(103), query("Overflow"))).toThrowError(expect.objectContaining({ status: 503, retryAfter: 10 }));
    for (let i = 0; i < 102; i++) await finish();
    await jobs.close();
  });

  it("keeps each subscriber's Genesys allowance when sharing a completed query", async () => {
    const { db, advance } = setup();
    const project = vi.fn((_rows, query) => {
      expect(db.inTransaction).toBe(false);
      return { results: [query.genesysRemaining], inReview: 0 };
    });
    const jobs = new BridgeSearchJobs(db, { execute: async () => [], project, version: () => "v1" });
    const first = jobs.start(actor(), { ...query(), format: "genesys", genesysRemaining: 100 });
    await new Promise(resolve => setImmediate(resolve)); advance(1);
    expect(jobs.start(actor(2), { ...query(), format: "genesys", genesysRemaining: 5 }).jobId).toBe(first.jobId);
    expect((await jobs.status(actor(), first.jobId)).results).toEqual([100]);
    expect((await jobs.status(actor(2), first.jobId)).results).toEqual([5]);
  });

  it("coalesces and bounds completed projections and invalidates them on feedback", async () => {
    const { db } = setup();
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const project = vi.fn(async () => { await gate; return { results: [], inReview: 0 }; });
    const jobs = new BridgeSearchJobs(db, { execute: async () => [], project, version: () => "status-cache" });
    const pending: Promise<unknown>[] = [];
    try {
      const first = jobs.start(actor(), query());
      await new Promise(resolve => setImmediate(resolve));
      for (let i = 0; i < 20; i++) pending.push(jobs.status(actor(), first.jobId));
      await new Promise(resolve => setImmediate(resolve));
      expect(project).toHaveBeenCalledTimes(1);
      for (let i = 2; i <= 4; i++) {
        jobs.start(actor(i), { ...query(), genesysRemaining: i });
        pending.push(jobs.status(actor(i), first.jobId));
      }
      jobs.start(actor(5), { ...query(), genesysRemaining: 5 });
      await expect(jobs.status(actor(5), first.jobId)).rejects.toMatchObject({ status: 503 });
      jobs.start(actor(), { ...query(), genesysRemaining: 30 });
      await expect(jobs.status(actor(), first.jobId)).rejects.toMatchObject({ status: 503 });
      release(); await Promise.all(pending);
      jobs.start(actor(), query());
      await jobs.status(actor(), first.jobId);
      expect(project).toHaveBeenCalledTimes(4);
      db.prepare("INSERT INTO bridge_feedback(evidence_hash,actor_hash,reason) VALUES('status-feedback','one','')").run();
      await jobs.status(actor(), first.jobId);
      expect(project).toHaveBeenCalledTimes(5);
    } finally { release(); await Promise.allSettled(pending); await jobs.close(); }
  });

  it("refreshes a subscriber's points and deck when reusing an identical active query", async () => {
    const { db } = setup(); let finish!: () => void;
    const ready = new Promise<void>(resolve => { finish = resolve; });
    const jobs = new BridgeSearchJobs(db, { execute: async () => { await ready; return []; },
      project: (_rows, query) => ({ results: [query.genesysRemaining, query.deckCards], inReview: 0 }), version: () => "v1" });
    const first = jobs.start(actor(), { ...query(), format: "genesys", genesysRemaining: 100, deckCards: [1] });
    try {
      expect(jobs.start(actor(), { ...query(), format: "genesys", genesysRemaining: 5, deckCards: [1, 2] }).jobId).toBe(first.jobId);
      expect(jobs.start(actor(2), { ...query(), format: "genesys", genesysRemaining: 20, deckCards: [3] }).jobId).toBe(first.jobId);
      finish(); await jobs.close();
      expect((await jobs.status(actor(), first.jobId)).results).toEqual([5, [1, 2]]);
      expect((await jobs.status(actor(2), first.jobId)).results).toEqual([20, [3]]);
    } finally { finish(); await jobs.close(); }
  });

  it("enforces fifteen new jobs per hour across guilds and persists the limit across restart", async () => {
    const { jobs, db, finish, advance } = setup();
    for (let i = 0; i < 15; i++) { jobs.start(actor(), query(`Engine ${i}`)); await finish(); advance(60_000); }
    expect(() => jobs.start(actor(1, "other"), query("Sixteenth"))).toThrowError(expect.objectContaining({ status: 429, retryAfter: 2700 }));
    const restarted = new BridgeSearchJobs(db, { execute: vi.fn(), project: () => ({ results: [], inReview: 0 }), version: () => "v1", now: () => 1_900_000 });
    expect(() => restarted.start(actor(), query("Sixteenth"))).toThrowError(expect.objectContaining({ status: 429, retryAfter: 2700 }));
    advance(2_700_000);
    expect(jobs.start(actor(), query("Sixteenth"))).toMatchObject({ cached: false });
    await finish();
  });

  it("fails safely and admits a new search immediately after failures and restarts", async () => {
    const { db } = setup();
    let now = 1_000_000;
    const options = { execute: vi.fn(async () => { throw new Error("private provider failure"); }), project: () => ({ results: [], inReview: 0 }), version: () => "v1", now: () => now };
    const jobs = new BridgeSearchJobs(db, options);
    const failed = jobs.start(actor(), query());
    await new Promise(resolve => setImmediate(resolve));
    expect((await jobs.status(actor(), failed.jobId))).toMatchObject({ state: "failed", results: [], error: "Bridge search could not finish. Try again shortly." });
    jobs.start(actor(), query("Other"));
    const restarted = new BridgeSearchJobs(db, options);
    expect(restarted.start(actor(), query("Third"))).toMatchObject({ state: "running", cached: false });
    await new Promise(resolve => setImmediate(resolve));
  });
});
