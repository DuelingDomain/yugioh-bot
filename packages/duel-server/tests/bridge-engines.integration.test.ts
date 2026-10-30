import { bridgeProjectionRows, compactBridgeRows, type BridgeProjectionInput } from "../src/bridge-projection-input.js";
import Database from "better-sqlite3";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { migrate } from "@yugidraft/shared/db";
import { BRIDGE_JUDGE_FRAMINGS, buildBridgeJudgeEvidence, importBridgeArtifact, importCardEffectArtifact, makeBridgeJudgementRecord,
  saveBridgeJudgement, type ArchetypeBridge, type BridgeEnginesResponse } from "@yugidraft/shared/cards/effects";
import { createBridgeService } from "@yugidraft/shared/services";
import { BridgeEngineQueries, type EngineQuery } from "../src/bridge-engine-queries.js";
import { BridgeApi } from "../src/bridge-api.js";
import { BridgeFastQueries } from "../src/bridge-fast-queries.js";
import type { BridgeScan } from "../src/deck-suggestion-workers.js";
import { seedIdentity } from "./helpers/identity.js";

let db: Database.Database;
beforeAll(() => { db = new Database(":memory:"); migrate(db); importCardEffectArtifact(db); importBridgeArtifact(db); });
afterAll(() => db.close());
function approve(row: ArchetypeBridge) {
  const evidence = buildBridgeJudgeEvidence(db, row)!;
  expect(evidence).not.toBeNull();
  for (const framing of BRIDGE_JUDGE_FRAMINGS) saveBridgeJudgement(db, makeBridgeJudgementRecord(evidence, framing, {
    verdict: "valid", grade: "good", pros: ["The supplied cards interact."], cons: ["Needs the supplied cards."],
    lock_note: "Apply the printed conditions.", line: evidence.cards.map(card => card.name), format_ok: true,
  }));
}
const bridgeEngines = async (input: Record<string, unknown>, guildId: string) => {
  const queries = new BridgeEngineQueries(db), { query, detected } = queries.resolve(input, guildId);
  return { ...queries.project(queries.service.engineRows(query.engines, query.format), query), ...(detected ? { detected } : {}) };
};
const deck = { main: [29762407, 29762407, 97522863, 97522863, 1710647, 1710647, 37839434, 37839434], extra: [] };

const bridgeEngineShortlist = async (rows: ArchetypeBridge[], query: EngineQuery) => new BridgeEngineQueries(db).shortlist(rows, query);
const bridgeEngineProjection = async (rows: BridgeProjectionInput, query: EngineQuery) => new BridgeEngineQueries(db).project(bridgeProjectionRows(db, rows), query, 6);

describe("stored multi-engine bridge API", () => {
  it("rehydrates compact completed pairs after their evidence changes or an artifact is imported", () => {
    const fixture = new Database(":memory:"); migrate(fixture); importBridgeArtifact(fixture);
    const row = createBridgeService(fixture).bridgeBetween("Odion", "Argostars")!;
    const input = compactBridgeRows([row]);
    try {
      expect(bridgeProjectionRows(fixture, input)).toEqual([row]);
      const changed = { ...row, evidence_hash: "new-evidence", score: row.score + 1 };
      fixture.prepare("UPDATE archetype_bridge SET evidence_hash=?,bridge_json=? WHERE source=? AND target=? AND format=?")
        .run(changed.evidence_hash, JSON.stringify(changed), row.source, row.target, row.format);
      expect(bridgeProjectionRows(fixture, input)).toEqual([changed]);
      fixture.exec("DELETE FROM bridge_artifact_import");
      expect(importBridgeArtifact(fixture).skipped).toBe(false);
      expect(bridgeProjectionRows(fixture, compactBridgeRows([changed]))).toEqual([row]);
    } finally { fixture.close(); }
  });

  it("coalesces identical work, bounds actor/global flights, and invalidates its short cache", async () => {
    const actors = Array.from({ length: 10 }, (_, i) => seedIdentity(db, { name: `Fast admission ${i}` }));
    let release!: () => void, now = Date.now();
    const ready = new Promise<void>(resolve => { release = resolve; });
    const bridgeEngines = vi.fn(async (_input: Record<string, unknown>, _guildId: string) => {
      await ready; return { engines: ["Odion"], between: [], next: [], inReview: 0 };
    });
    const api = new BridgeApi(db, { bridgeEngineShortlist, bridgeEngineProjection, bridgeEngines, bridgeCandidates: vi.fn(), rateBridge: vi.fn() }, () => now);
    const call = (i: number, engines = ["Odion"]) => api.handle({ userId: actors[i]!.userId, bridgeRequest: { op: "engines", engines } }, "g", actors[i]!.playerId);
    const pending: Promise<unknown>[] = [];
    try {
      pending.push(call(0), call(0, ["odion"]), call(1));
      await new Promise(resolve => setImmediate(resolve));
      expect(bridgeEngines).toHaveBeenCalledTimes(1);
      pending.push(call(0, ["Ashtra"]), call(0, ["Genex"]));
      for (let i = 2; i < 9; i++) pending.push(call(i, [Object.keys(new BridgeEngineQueries(db).service.rankingContext().groups)[i]!]));
      await expect(call(9, ["Fiendsmith"])).rejects.toMatchObject({ status: 503 });
      release(); await Promise.all(pending);
      expect(bridgeEngines.mock.calls.map(([input]) => input.engines)).toContainEqual(["Genex"]);
      expect(bridgeEngines.mock.calls.map(([input]) => input.engines)).toContainEqual(["Ashtra"]);
      const scans = bridgeEngines.mock.calls.length;
      await call(0); expect(bridgeEngines).toHaveBeenCalledTimes(scans);
      db.prepare("INSERT OR REPLACE INTO duel_host_heartbeat(id,last_tick_at) VALUES(1,?)").run(now);
      await call(0); expect(bridgeEngines).toHaveBeenCalledTimes(scans);
      db.prepare("INSERT INTO bridge_feedback(evidence_hash,actor_hash,reason) VALUES(?,?,'')").run("f".repeat(64), "cache-invalidation");
      await call(0); expect(bridgeEngines).toHaveBeenCalledTimes(scans + 1);
      now += 5001;
      await call(0); expect(bridgeEngines).toHaveBeenCalledTimes(scans + 2);
      let unblock!: () => void;
      const gate = new Promise<void>(resolve => { unblock = resolve; });
      const bounded = new BridgeFastQueries(db, { bridgeEngines: async input => {
        await gate; return { engines: input.engines as string[], between: [], next: [], inReview: 0 };
      } });
      const shortDeadline = performance.now() + 20;
      const stale = bounded.run({ engines: ["Odion"] }, "g", actors[0]!.userId, shortDeadline);
      const replaced = bounded.run({ engines: ["Ashtra"] }, "g", actors[0]!.userId, shortDeadline);
      const latest = bounded.run({ engines: ["Genex"] }, "g", actors[0]!.userId, performance.now() + 1000);
      try {
        expect((await Promise.allSettled([stale, replaced])).map(result => result.status)).toEqual(["rejected", "rejected"]);
        unblock();
        await expect(latest).resolves.toMatchObject({ engines: ["Genex"] });
      } finally { unblock(); await Promise.allSettled([stale, replaced, latest]); }
    } finally { release(); await Promise.allSettled(pending); await api.jobs.close(); }
  });

  it("keeps concurrent detected and corrected waiters tied to their own request keys", async () => {
    for (const correctedFirst of [false, true]) {
      let release!: () => void;
      const gate = new Promise<void>(resolve => { release = resolve; });
      const queries = new BridgeFastQueries(db, { bridgeEngines: async (input, guildId) => {
        await gate; return bridgeEngines(input, guildId);
      } });
      const stale = queries.run({ engines: ["Genex"] }, "g", 1);
      const requests = [{ deck }, { deck, engines: ["Odion"] }];
      if (correctedFirst) requests.reverse();
      const pending = requests.map(input => queries.run(input, "g", 1));
      // Rejoining the running key must not redirect either queued waiter.
      const rejoined = queries.run({ engines: ["Genex"] }, "g", 1);
      try {
        release();
        await expect(stale).resolves.toMatchObject({ engines: ["Genex"] });
        await expect(rejoined).resolves.toMatchObject({ engines: ["Genex"] });
        for (const [i, input] of requests.entries()) {
          const engines = "engines" in input ? ["Odion"] : ["Ashtra", "Odion"];
          await expect(pending[i]).resolves.toMatchObject({ engines });
          await expect(queries.run(input, "g", 1)).resolves.toMatchObject({ engines });
        }
      } finally { release(); await Promise.allSettled([stale, rejoined, ...pending]); }
    }
  });

  it("normalizes artwork identities before detection, points and missing-copy projection", () => {
    const main = 89631139, artwork = 89631140;
    for (const id of [main, artwork]) db.prepare(`INSERT OR IGNORE INTO card_catalog(ygoprodeck_id,name,type,frame_type,image_url,image_url_small,card_sets_json,cached_at)
      VALUES(?,'Artwork fixture '||?,'Normal Monster','normal','','','[]','2026-10-30')`).run(id, id);
    db.prepare("INSERT OR REPLACE INTO card_artworks(card_id,artwork_id,image_url,image_url_small,is_main) VALUES(?,?,'','',0)").run(main, artwork);
    const queries = new BridgeEngineQueries(db);
    const resolved = queries.resolve({ op: "engines", format: "genesys", deck: { main: [artwork, artwork, 8240199, 8240199], extra: [artwork], deckMaster: artwork } }, "g");
    expect(resolved.query.engines).toContain("Blue-Eyes");
    expect(resolved.query.deckCards!.filter(id => id === main)).toHaveLength(4);
    expect(resolved.query.deckCards).not.toContain(artwork);
    expect(resolved.query.genesysRemaining).toBeTypeOf("number");
    const row = createBridgeService(db).bridgeBetween("Blue-Eyes", "Black Luster Soldier", "genesys")!;
    const pack = queries.package([row], resolved.query);
    expect(pack.missing).not.toContain(main);
  });

  it("prefers the editor allowance and falls back to the open deck point cap, including zero", () => {
    const queries = new BridgeEngineQueries(db);
    const resolve = (pointCap: unknown, genesysRemaining?: unknown) => queries.resolve({ op: "engines", format: "genesys", engines: ["Odion"],
      deck: { main: [29762407, 97522863, 1710647], extra: [], pointCap }, genesysRemaining }, "g").query;
    expect(resolve(3).genesysRemaining).toBe(0);
    expect(resolve(0).genesysRemaining).toBe(-3);
    expect(resolve(250).genesysRemaining).toBe(247);
    expect(resolve(250, 0).genesysRemaining).toBe(0);
    expect(resolve(0, 250).genesysRemaining).toBe(250);
    expect(resolve(100, 1000).genesysRemaining).toBe(1000);
    for (const cap of [-1, 1001, 0.5, "100"]) expect(() => resolve(cap)).toThrowError(expect.objectContaining({ status: 400 }));
    for (const allowance of [-1, 1001, 0.5, "100", null, true, {}, NaN, Infinity]) {
      expect(() => resolve(100, allowance)).toThrowError(expect.objectContaining({ status: 400 }));
    }
    const unknownPoints = { op: "engines", format: "genesys", engines: ["Odion"], deck: { main: [0xffffffff], extra: [] } };
    expect(queries.resolve(unknownPoints, "g").query).toMatchObject({ engines: ["Odion"], deckCards: [0xffffffff] });
    expect(queries.resolve(unknownPoints, "g").query.genesysRemaining).toBeUndefined();
    expect(queries.resolve({ ...unknownPoints, genesysRemaining: 5 }, "g").query).toMatchObject({ genesysRemaining: 5, deckCards: [0xffffffff] });
  });

  it("computes coverage bonuses, idf and reverse-link bonuses from accepted display pairs", async () => {
    const user = seedIdentity(db, { name: "Engine scoring" }), service = createBridgeService(db);
    const context = service.rankingContext();
    const first = service.bridgeBetween("Azamina", "White Forest")!, second = service.bridgeBetween("Diabell", "White Forest")!;
    approve(first); approve(second);
    const forward = service.bridgeBetween("Blue-Eyes", "Black Luster Soldier")!;
    const reverse = service.bridgeBetween("Black Luster Soldier", "Blue-Eyes")!;
    approve(forward);
    const api = new BridgeApi(db, { bridgeEngineShortlist, bridgeEngineProjection, bridgeEngines, bridgeCandidates: vi.fn(), rateBridge: vi.fn() });
    const call = (engines: string[]) => api.handle({ userId: user.userId, bridgeRequest: { op: "engines", engines, format: "advanced" } }, "g", user.playerId) as Promise<BridgeEnginesResponse>;
    const round = (n: number) => Math.round(n * 1000) / 1000;
    try {
      const combined = (await call(["Azamina", "Diabell"])).next.find(row => row.engine === "White Forest")!;
      expect(combined).toMatchObject({ covered: 2, of: 2, twoWay: [] });
      expect([first, second].some(row => row.reasons[0]!.cards.some(id => context.hubs.has(id)))).toBe(false);
      const values = [first.score * 0.8, second.score * 0.8].sort((a, b) => b - a);
      expect(combined.score).toBe(round((values[0]! + 0.8 * values[1]!) * 1.3 * (context.idf.advanced.get("White Forest") ?? 1)));
      const oneWay = (await call(["Blue-Eyes"])).next.find(row => row.engine === "Black Luster Soldier")!;
      expect(oneWay.twoWay).toEqual([]); expect(oneWay.links[0]!.bridge.two_way).toBe(false);
      approve(reverse);
      const twoWay = (await call(["Blue-Eyes"])).next.find(row => row.engine === "Black Luster Soldier")!;
      expect(twoWay.twoWay).toEqual(["Blue-Eyes"]);
      const f = forward.score * 0.8, b = reverse.score * 0.8;
      expect(twoWay.score).toBe(round((Math.max(f, 0.7 * b) + 0.3 * Math.min(f, b)) * (context.idf.advanced.get("Black Luster Soldier") ?? 1)));
    } finally { await api.jobs.close(); }
  });

  it("detects the open deck and projects only accepted links without admitting work", async () => {
    const user = seedIdentity(db), workers = { bridgeEngineShortlist, bridgeEngineProjection, bridgeEngines, bridgeCandidates: vi.fn(), rateBridge: vi.fn() };
    const api = new BridgeApi(db, workers);
    const call = (request: Record<string, unknown>) => api.handle({ userId: user.userId, bridgeRequest: { op: "engines", format: "advanced", ...request } }, "g", user.playerId) as Promise<BridgeEnginesResponse>;
    try {
      expect(await call({ deck })).toMatchObject({ engines: ["Ashtra", "Odion"], next: [], between: [], detected: expect.any(Array) });
      const service = createBridgeService(db);
      for (const [from, to] of [["Odion", "Ashtra"], ["Ashtra", "Odion"], ["Odion", "Argostars"], ["Ashtra", "Argostars"], ["Argostars", "Odion"]]) {
        const row = service.bridgeBetween(from!, to!); if (row) approve(row);
      }
      const result = await call({ deck });
      expect(result.between).not.toHaveLength(0);
      const argostars = result.next.find(row => row.engine === "Argostars")!;
      expect(argostars).toBeDefined();
      expect(argostars.links.length).toBeLessThanOrEqual(3);
      expect(argostars.links.every(link => link.bridge.judge === "accepted")).toBe(true);
      // The pinned graph has Odion -> Argostars, but no Ashtra -> Argostars.
      expect(argostars.covered).toBe(1);
      expect(argostars.of).toBe(2);
      expect(argostars.score).toBeGreaterThanOrEqual(4);
      expect(argostars.missing).not.toContain(29762407);
      expect(result.next.every(row => !/synchron/i.test(row.engine))).toBe(true);
      expect(await call({ deck, engines: ["odion"] })).toMatchObject({ engines: ["Odion"], detected: expect.any(Array) });
      expect(await call({ engines: ["odion", " ASHTRA "] })).toMatchObject({ engines: ["Ashtra", "Odion"] });
      expect(workers.bridgeCandidates).not.toHaveBeenCalled(); expect(workers.rateBridge).not.toHaveBeenCalled();
      expect(db.prepare("SELECT count(*) AS n FROM bridge_deep_job").get()).toEqual({ n: 0 });
      for (const request of [{}, { engines: [] }, { engines: ["missing"] }, { engines: Array(5).fill("Odion") },
        { deck: { ...deck, side: [] } }, { deck: { main: Array(92).fill(1), extra: [] } }, { deck: { main: [0], extra: [] } }, { engines: ["Odion"], userId: 3 }]) {
        await expect(call(request)).rejects.toMatchObject({ status: 400 });
      }
    } finally { await api.jobs.close(); }
  });

  it("rechecks feedback and keeps Genesys package costs specific to the open deck", async () => {
    const user = seedIdentity(db, { name: "Engine points" });
    const row = createBridgeService(db).bridgeBetween("Odion", "Ashtra", "genesys")!; approve(row);
    const api = new BridgeApi(db, { bridgeEngineShortlist, bridgeEngineProjection, bridgeEngines, bridgeCandidates: vi.fn(), rateBridge: vi.fn() });
    const call = (request: Record<string, unknown>) => api.handle({ userId: user.userId, bridgeRequest: { op: "engines", format: "genesys", ...request } }, "g", user.playerId) as Promise<BridgeEnginesResponse>;
    try {
      expect((await call({ engines: ["Odion"], genesysRemaining: 0 })).next.some(next => next.engine === "Ashtra")).toBe(false);
      const context = { engines: ["Odion"], deck: { main: [], extra: [], pointCap: 0 } };
      expect((await call({ ...context, genesysRemaining: 3 })).next.some(next => next.engine === "Ashtra")).toBe(true);
      expect((await call({ ...context, genesysRemaining: 0 })).next.some(next => next.engine === "Ashtra")).toBe(false);
      expect((await call(context)).next.some(next => next.engine === "Ashtra")).toBe(false);
      expect((await call({ ...context, genesysRemaining: 1000 })).next.some(next => next.engine === "Ashtra")).toBe(true);
      const result = await call({ engines: ["Odion"], deck: { main: row.cards, extra: [] }, genesysRemaining: 0 });
      const ashtra = result.next.find(next => next.engine === "Ashtra")!;
      expect(ashtra).toBeDefined(); expect(ashtra.genesysPoints).toBe(0); expect(ashtra.missing).toEqual([]);
      for (const actor of ["engine-report-one", "engine-report-two"]) db.prepare("INSERT INTO bridge_feedback(evidence_hash,actor_hash,reason) VALUES(?,?,'')").run(row.evidence_hash, actor);
      expect((await call({ engines: ["Odion"] })).next.some(next => next.engine === "Ashtra")).toBe(false);
    } finally { await api.jobs.close(); }
  });
});

describe("multi-source deep search", () => {
  async function finish(api: BridgeApi, user: ReturnType<typeof seedIdentity>, jobId: string) {
    for (let i = 0; i < 100; i++) {
      const status = (await api.jobs.status({ userId: user.userId, guildId: "g" }, jobId));
      if (status.state === "done" || status.state === "failed") return status;
      await new Promise(resolve => setImmediate(resolve));
    }
    throw new Error("Fixture job did not finish");
  }

  it("shares deep work while retaining each editor allowance and refreshing deck context", async () => {
    const user = seedIdentity(db, { name: "Editor allowance" }), other = seedIdentity(db, { name: "Side deck allowance" });
    const row = createBridgeService(db).bridgeBetween("Snake-Eye", "Fire King", "genesys")!; approve(row);
    expect(row.genesys_points).toBeGreaterThan(0);
    let release!: () => void;
    const ready = new Promise<void>(resolve => { release = resolve; });
    const workers = { bridgeEngineShortlist, bridgeEngineProjection, bridgeEngines,
      bridgeCandidates: vi.fn(async () => { await ready; return [row]; }), rateBridge: vi.fn() };
    const api = new BridgeApi(db, workers);
    const context = { op: "start", engines: ["Snake-Eye", "Blue-Eyes"], format: "genesys", deck: { main: [], extra: [], pointCap: 0 } };
    const start = (identity: typeof user, extra: Record<string, unknown>) => api.handle({ userId: identity.userId,
      bridgeRequest: { ...context, ...extra } }, "g", identity.playerId) as Promise<{ jobId: string; cached: boolean }>;
    const status = (identity: typeof user, jobId: string) => api.jobs.status({ userId: identity.userId, guildId: "g" }, jobId);
    try {
      const unknown = await start(user, { deck: { main: [0xffffffff], extra: [] } });
      const first = await start(user, { genesysRemaining: row.genesys_points });
      expect(first.jobId).toBe(unknown.jobId);
      expect(await start(other, { genesysRemaining: 0 })).toMatchObject({ jobId: first.jobId, cached: false });
      const work = JSON.parse((db.prepare("SELECT query_json FROM bridge_deep_job WHERE id=?").get(first.jobId) as { query_json: string }).query_json);
      expect(work).not.toHaveProperty("genesysRemaining"); expect(work).not.toHaveProperty("deckCards");
      release();
      const completed = await finish(api, user, first.jobId);
      expect(completed).toMatchObject({ state: "done", next: [{ engine: "Fire King", genesysPoints: row.genesys_points }] });
      expect((await status(other, first.jobId)).next).toEqual([]);
      const scans = workers.bridgeCandidates.mock.calls.length;
      expect(await start(user, { genesysRemaining: 0 })).toMatchObject({ jobId: first.jobId, cached: true });
      expect((await status(user, first.jobId)).next).toEqual([]);
      expect(await start(other, { genesysRemaining: 0, deck: { main: row.cards, extra: [] } })).toMatchObject({ jobId: first.jobId, cached: true });
      expect((await status(other, first.jobId)).next).toMatchObject([{ engine: "Fire King", missing: [], genesysPoints: 0 }]);
      expect(workers.bridgeCandidates).toHaveBeenCalledTimes(scans);
      expect(workers.rateBridge).not.toHaveBeenCalled();
    } finally { release(); await api.jobs.close(); }
  });

  it("preserves legacy results when a single-engine selector creates the shared job first", async () => {
    const user = seedIdentity(db, { name: "One engine" }), other = seedIdentity(db, { name: "Legacy subscriber" });
    const row = createBridgeService(db).bridgeBetween("Snake-Eye", "Fire King")!; approve(row);
    const workers = { bridgeEngineShortlist, bridgeEngineProjection, bridgeEngines, bridgeCandidates: vi.fn(async () => [row]), rateBridge: vi.fn() };
    const api = new BridgeApi(db, workers);
    try {
      const started = await api.handle({ userId: user.userId, bridgeRequest: { op: "start", engines: ["Snake-Eye"], deck: { main: [], extra: [] } } }, "g", user.playerId) as { jobId: string };
      expect(await finish(api, user, started.jobId)).toMatchObject({ state: "done", results: [{ target: "Fire King" }], next: [{ engine: "Fire King" }] });
      expect(await api.handle({ userId: other.userId, bridgeRequest: { op: "start", source: "Snake-Eye" } }, "g", other.playerId)).toMatchObject({ jobId: started.jobId, cached: true });
      expect((await api.jobs.status({ userId: other.userId, guildId: "g" }, started.jobId)).results).toHaveLength(1);
      expect(workers.bridgeCandidates).toHaveBeenCalledTimes(1);
    } finally { await api.jobs.close(); }
  });

  it("rescans full outgoing rows after a truncated single job and shares deck-free work", async () => {
    const user = seedIdentity(db, { name: "Multi-source" }), other = seedIdentity(db, { name: "Multi subscriber" });
    const service = createBridgeService(db);
    const workers = { bridgeEngineShortlist, bridgeEngineProjection, bridgeEngines, bridgeCandidates: vi.fn(async (scan: BridgeScan) => {
      if (scan.op === "live") return service.deepFrom(scan.source, scan.format, 25);
      return service.engineRows([scan.source], scan.format).filter(row => scan.op === "into" ? row.target === scan.source : row.source === scan.source);
    }), rateBridge: vi.fn(async (row: ArchetypeBridge) => approve(row)) };
    const api = new BridgeApi(db, workers);
    const call = (request: Record<string, unknown>, identity = user) => api.handle({ userId: identity.userId, bridgeRequest: request }, "g", identity.playerId);
    try {
      const first = await call({ op: "start", source: "Odion" }) as { jobId: string };
      expect((await finish(api, user, first.jobId)).state).toBe("done");
      workers.bridgeCandidates.mockClear(); workers.rateBridge.mockClear();
      const multi = await call({ op: "start", deck, engines: ["odion", "ashtra"] }) as { jobId: string };
      const result = await finish(api, user, multi.jobId);
      expect(result).toMatchObject({ state: "done", engines: ["Ashtra", "Odion"], results: [], next: expect.any(Array) });
      expect(workers.bridgeCandidates.mock.calls.map(([scan]) => [scan.op, scan.source])).toEqual([
        ["outgoing", "Ashtra"], ["into", "Ashtra"], ["outgoing", "Odion"], ["into", "Odion"],
      ]);
      expect(workers.rateBridge.mock.calls.length).toBeLessThanOrEqual(12);
      expect(result.next.length).toBeGreaterThan(0);
      expect(result.next.length).toBeLessThanOrEqual(6);
      const reviews = workers.rateBridge.mock.calls.length;
      expect(await call({ op: "start", deck })).toMatchObject({ jobId: multi.jobId, cached: true });
      const differentDeck = { main: [89631139, 89631139, 8240199, 8240199], extra: [] };
      expect(await call({ op: "start", engines: ["odion", "ashtra"], deck: differentDeck }, other)).toMatchObject({ jobId: multi.jobId, cached: true });
      expect(workers.rateBridge.mock.calls).toHaveLength(reviews);
      const subscribed = (await api.jobs.status({ userId: other.userId, guildId: "g" }, multi.jobId));
      expect(subscribed.engines).toEqual(["Ashtra", "Odion"]);
      expect(subscribed.next.some((next, i) => next.missing.length > result.next[i]!.missing.length)).toBe(true);
      const owned = result.next[0]!;
      expect(await call({ op: "start", engines: ["Ashtra", "Odion"], deck: { main: owned.cards, extra: [] } })).toMatchObject({ jobId: multi.jobId, cached: true });
      const refreshed = await api.jobs.status({ userId: user.userId, guildId: "g" }, multi.jobId);
      expect(refreshed.next.find(next => next.engine === owned.engine)!.missing).toEqual([]);
      const stored = JSON.parse((db.prepare("SELECT query_json FROM bridge_deep_job WHERE id=?").get(multi.jobId) as { query_json: string }).query_json);
      expect(stored).toEqual({ source: "Ashtra", engines: ["Ashtra", "Odion"], format: "advanced" });
      for (const input of [{ op: "start", deck, source: "Odion" }, { op: "start", deckId: 1, engines: ["Odion"] },
        { op: "start", deck: { main: [], extra: [] } }]) await expect(call(input)).rejects.toMatchObject({ status: 400 });
    } finally { await api.jobs.close(); }
  });

  it("excludes rejected and reported pairs before shortlist slots and access paths are claimed", () => {
    const queries = new BridgeEngineQueries(db), engines = ["Genex", "The Weather"];
    const query = { source: engines[0]!, engines, format: "advanced" as const };
    const rows = queries.service.engineRows(engines, "advanced");
    const initial = queries.shortlist(rows, query);
    expect(initial.length).toBeGreaterThanOrEqual(6);
    const rejected = initial.slice(0, 6).flatMap(engine => rows.filter(row => row.source === engine.engine || row.target === engine.engine));
    for (const [i, row] of rejected.entries()) {
      if (i % 2) {
        for (const actor of ["shortlist-report-one", "shortlist-report-two"]) db.prepare("INSERT OR IGNORE INTO bridge_feedback(evidence_hash,actor_hash,reason) VALUES(?,?,'')").run(row.evidence_hash, actor);
      } else {
        const evidence = buildBridgeJudgeEvidence(db, row)!;
        for (const framing of BRIDGE_JUDGE_FRAMINGS) saveBridgeJudgement(db, makeBridgeJudgementRecord(evidence, framing, {
          verdict: "invalid", grade: "risky", pros: [], cons: [], lock_note: "", line: [], format_ok: true,
        }));
      }
    }
    const after = queries.shortlist(rows, query);
    expect(after.some(engine => initial.slice(0, 6).some(old => old.engine === engine.engine))).toBe(false);
    expect(after.length).toBeGreaterThan(0);
  });

  it("retries partially failed reviews after ten minutes instead of caching them for a day", async () => {
    const user = seedIdentity(db, { name: "Partial review outage" }), service = createBridgeService(db);
    let calls = 0, now = Date.now();
    const workers = { bridgeEngineShortlist, bridgeEngineProjection, bridgeEngines, bridgeCandidates: vi.fn(async (scan: BridgeScan) => service.engineRows([scan.source], scan.format)
      .filter(row => scan.op === "into" ? row.target === scan.source : row.source === scan.source)),
      rateBridge: vi.fn(async (row: ArchetypeBridge) => { if (!calls++) approve(row); }) };
    const api = new BridgeApi(db, workers, () => now);
    const start = () => api.handle({ userId: user.userId, bridgeRequest: { op: "start", engines: ["Blue-Eyes", "Fiendsmith"] } }, "g", user.playerId) as Promise<{ jobId: string; cached: boolean }>;
    try {
      const first = await start();
      expect((await finish(api, user, first.jobId)).state).toBe("done");
      expect(await start()).toMatchObject({ jobId: first.jobId, cached: true });
      now += 600_001;
      const retry = await start();
      expect(retry.cached).toBe(false);
      expect(retry.jobId).not.toBe(first.jobId);
      await finish(api, user, retry.jobId);
    } finally { await api.jobs.close(); }
  });

  it("stops at twelve new pair reviews when reviews are unavailable, and at six reviewed engines when they succeed", async () => {
    const user = seedIdentity(db, { name: "Budget" }), service = createBridgeService(db);
    const engines = ["Archfiend", "Performapal"];
    const workers = { bridgeEngineShortlist, bridgeEngineProjection, bridgeEngines, bridgeCandidates: vi.fn(async (scan: BridgeScan) => service.engineRows([scan.source], scan.format)
      .filter(row => scan.op === "into" ? row.target === scan.source : row.source === scan.source)),
      rateBridge: vi.fn(async (_row: ArchetypeBridge) => {}) };
    let now = Date.now();
    const api = new BridgeApi(db, workers, () => now);
    const start = () => api.handle({ userId: user.userId, bridgeRequest: { op: "start", engines } }, "g", user.playerId) as Promise<{ jobId: string; cached: boolean }>;
    try {
      const failed = await start();
      expect(await finish(api, user, failed.jobId)).toMatchObject({ state: "failed", error: "Review service unavailable, try later." });
      expect(workers.rateBridge).toHaveBeenCalledTimes(12);
      workers.rateBridge.mockClear(); workers.rateBridge.mockImplementation(async row => approve(row));
      const retry = await start();
      const result = await finish(api, user, retry.jobId);
      expect(result.state).toBe("done");
      const reviewedTargets = new Set(workers.rateBridge.mock.calls.map(([row]) => engines.includes(row.source) ? row.target : row.source));
      expect(reviewedTargets.size).toBe(6);
      expect(workers.rateBridge.mock.calls.length).toBeLessThan(12);
      expect(result.next.length).toBeLessThanOrEqual(6);
      expect(result.next.every(next => next.links.every(link => link.bridge.judge === "accepted"))).toBe(true);
      const reviews = workers.rateBridge.mock.calls.length;
      now += 600_001;
      expect(await start()).toMatchObject({ jobId: retry.jobId, cached: true });
      expect(workers.rateBridge.mock.calls).toHaveLength(reviews);
    } finally { await api.jobs.close(); }
  });
});
