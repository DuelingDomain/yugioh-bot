import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";
import { migrate } from "@yugidraft/shared/db";
import { BridgeSearchJobs } from "../src/bridge-search-jobs.js";

const query = (source = "Odion") => ({ source, format: "advanced" as const });
const actor = (userId = 1, guildId = "g") => ({ userId, guildId });
const databases: Database.Database[] = [];
function setup() {
  const db = new Database(":memory:"); databases.push(db); migrate(db);
  let now = 1_000_000;
  const releases: (() => void)[] = [];
  const execute = vi.fn(async (_query, progress) => {
    progress("checking", 50);
    await new Promise<void>(resolve => releases.push(resolve));
    progress("rating", 90);
    return [];
  });
  const jobs = new BridgeSearchJobs(db, { execute, project: () => ({ results: [], inReview: 2 }), version: () => "v1", now: () => now });
  const finish = async () => { releases.shift()!(); await new Promise(resolve => setImmediate(resolve)); };
  return { db, jobs, execute, finish, advance: (ms: number) => { now += ms; } };
}
afterEach(() => { for (const db of databases.splice(0)) db.close(); });

describe("persistent bridge deep-search admission and lifecycle", () => {
  it("coalesces repeat clicks, polls progress, and scopes job access to user and guild", async () => {
    const { jobs, execute, finish } = setup();
    const first = jobs.start(actor(), query());
    expect(jobs.start(actor(), query("Blue-Eyes")).jobId).toBe(first.jobId);
    await new Promise(resolve => setImmediate(resolve));
    expect(execute).toHaveBeenCalledTimes(1);
    expect(jobs.status(actor(), first.jobId)).toMatchObject({ state: "running", step: "checking", progress: 50 });
    expect(() => jobs.status(actor(2), first.jobId)).toThrow("Not found");
    expect(() => jobs.status(actor(1, "other"), first.jobId)).toThrow("Not found");
    await finish();
    expect(jobs.status(actor(), first.jobId)).toMatchObject({ state: "done", step: "done", progress: 100, results: [], inReview: 2 });
  });

  it("starts cooldown at completion and returns retryAfter, while reusing identical results for 24 hours", async () => {
    const { jobs, finish, advance, execute } = setup();
    const first = jobs.start(actor(), query());
    advance(120_000); await finish();
    expect(() => jobs.start(actor(), query("Blue-Eyes"))).toThrowError(expect.objectContaining({ status: 429, retryAfter: 60 }));
    expect(jobs.start(actor(), query())).toMatchObject({ jobId: first.jobId, cached: true });
    expect(jobs.start(actor(2), query())).toMatchObject({ jobId: first.jobId, cached: true });
    expect(jobs.status(actor(2), first.jobId).state).toBe("done");
    advance(60_000);
    jobs.start(actor(), query("Blue-Eyes")); await finish();
    advance(86_400_001);
    expect(jobs.start(actor(2), query()).cached).toBe(false);
    await finish(); expect(execute).toHaveBeenCalledTimes(3);
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

  it("keeps each subscriber's Genesys allowance when sharing a completed query", async () => {
    const { db, advance } = setup();
    const project = vi.fn((_rows, query) => ({ results: [query.genesysRemaining], inReview: 0 }));
    const jobs = new BridgeSearchJobs(db, { execute: async () => [], project, version: () => "v1" });
    const first = jobs.start(actor(), { ...query(), format: "genesys", genesysRemaining: 100 });
    await new Promise(resolve => setImmediate(resolve)); advance(1);
    expect(jobs.start(actor(2), { ...query(), format: "genesys", genesysRemaining: 5 }).jobId).toBe(first.jobId);
    expect(jobs.status(actor(), first.jobId).results).toEqual([100]);
    expect(jobs.status(actor(2), first.jobId).results).toEqual([5]);
  });

  it("enforces ten new jobs per hour across guilds and persists the limit across restart", async () => {
    const { jobs, db, finish, advance } = setup();
    for (let i = 0; i < 10; i++) { jobs.start(actor(), query(`Engine ${i}`)); await finish(); advance(60_000); }
    expect(() => jobs.start(actor(1, "other"), query("Eleventh"))).toThrowError(expect.objectContaining({ status: 429, retryAfter: 3000 }));
    const restarted = new BridgeSearchJobs(db, { execute: vi.fn(), project: () => ({ results: [], inReview: 0 }), version: () => "v1", now: () => 1_600_000 });
    expect(() => restarted.start(actor(), query("Eleventh"))).toThrowError(expect.objectContaining({ status: 429 }));
  });

  it("fails safely, releases the slot, and keeps a completion cooldown on failures and restarts", async () => {
    const { db } = setup();
    let now = 1_000_000;
    const options = { execute: vi.fn(async () => { throw new Error("private provider failure"); }), project: () => ({ results: [], inReview: 0 }), version: () => "v1", now: () => now };
    const jobs = new BridgeSearchJobs(db, options);
    const failed = jobs.start(actor(), query());
    await new Promise(resolve => setImmediate(resolve));
    expect(jobs.status(actor(), failed.jobId)).toMatchObject({ state: "failed", results: [], error: "Bridge search could not finish. Try again shortly." });
    expect(() => jobs.start(actor(), query("Other"))).toThrowError(expect.objectContaining({ retryAfter: 60 }));
    now += 60_000;
    jobs.start(actor(), query("Other"));
    const restarted = new BridgeSearchJobs(db, options);
    expect(() => restarted.start(actor(), query("Third"))).toThrowError(expect.objectContaining({ status: 429 }));
    await new Promise(resolve => setImmediate(resolve));
  });
});
