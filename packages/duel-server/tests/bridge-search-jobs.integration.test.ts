import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";
import { migrate } from "@yugidraft/shared/db";
import { importBridgeArtifact, type ArchetypeBridge } from "@yugidraft/shared/cards/effects";
import { BridgeSearchJobs } from "../src/bridge-search-jobs.js";

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
    updateVersion("v2"); expect(() => jobs.status(actor(), first.jobId)).toThrowError(expect.objectContaining({ status: 404 }));
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
    expect(jobs.status(actor(), first.jobId)).toMatchObject({ state: "running", step: "checking", progress: 50 });
    expect(() => jobs.status(actor(2), first.jobId)).toThrow("Not found");
    expect(() => jobs.status(actor(1, "other"), first.jobId)).toThrow("Not found");
    await finish();
    expect(jobs.status(actor(), first.jobId)).toMatchObject({ state: "done", step: "done", progress: 100, results: [], inReview: 2 });
  });

  it("admits another search immediately after completion and reuses identical results for 24 hours", async () => {
    const { jobs, finish, advance, execute } = setup(0);
    const first = jobs.start(actor(), query());
    advance(120_000); await finish();
    expect(jobs.start(actor(), query())).toMatchObject({ jobId: first.jobId, cached: true });
    expect(jobs.start(actor(2), query())).toMatchObject({ jobId: first.jobId, cached: true });
    expect(jobs.status(actor(2), first.jobId).state).toBe("done");
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
    expect(jobs.status(actor(), first.jobId).state).toBe("done");
    updateVersion("v2");
    expect(() => jobs.status(actor(), first.jobId)).toThrowError(expect.objectContaining({ status: 404 }));
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
    expect(jobs.status(actor(), first.jobId).results).toEqual([100]);
    expect(jobs.status(actor(2), first.jobId).results).toEqual([5]);
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
      expect(jobs.status(actor(), first.jobId).results).toEqual([5, [1, 2]]);
      expect(jobs.status(actor(2), first.jobId).results).toEqual([20, [3]]);
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
    expect(jobs.status(actor(), failed.jobId)).toMatchObject({ state: "failed", results: [], error: "Bridge search could not finish. Try again shortly." });
    jobs.start(actor(), query("Other"));
    const restarted = new BridgeSearchJobs(db, options);
    expect(restarted.start(actor(), query("Third"))).toMatchObject({ state: "running", cached: false });
    await new Promise(resolve => setImmediate(resolve));
  });
});
