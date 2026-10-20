import Database from "better-sqlite3";
import { migrate } from "@yugidraft/shared/db";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const { auth, getDb, statfs } = vi.hoisted(() => ({ auth: vi.fn(), getDb: vi.fn(), statfs: vi.fn() }));
vi.mock("node:fs/promises", async (original) => ({ ...(await original<typeof import("node:fs/promises")>()), statfs }));
vi.mock("@/lib/session-identity", async () => {
  const { sessionFixture } = await import("./fixtures/session");
  return sessionFixture(auth);
});
vi.mock("@/lib/db", () => ({ getDb }));

const SECRET = "duel-secret-value";
const GIB = 1024 ** 3;
/** A filesystem of `total` GiB with `free` GiB free, as fs.statfs reports it. */
const disk = (total: number, free: number) => ({ bsize: 4096, blocks: (total * GIB) / 4096, bfree: (free * GIB) / 4096, bavail: (free * GIB) / 4096 });
const SHA = "0123456789abcdef0123456789abcdef01234567";
let db: Database.Database;
let calls: string[];

beforeEach(() => {
  vi.resetModules(); auth.mockReset(); getDb.mockReset(); calls = [];
  auth.mockResolvedValue({ user: { id: "1", name: "Operator" } });
  vi.stubEnv("OWNER_USER_IDS", "1"); vi.stubEnv("DISCORD_GUILD_ID", "guild-1");
  vi.stubEnv("DUEL_INTERNAL_URL", "http://duel.internal:4003"); vi.stubEnv("DUEL_INTERNAL_SECRET", SECRET);
  vi.stubEnv("SENTRY_RELEASE", SHA); vi.stubEnv("WS_INTERNAL_URL", "http://ws.internal:4002");
  vi.stubEnv("DATABASE_PATH", "/data-volume/bot.sqlite");
  statfs.mockReset(); statfs.mockResolvedValue(disk(100, 50));
  db = new Database(":memory:"); migrate(db); getDb.mockReturnValue(db);
  db.exec(`insert into users(id,username,display_name) values(1,'op','Operator'),(2,'ann','Ann');
    insert into players(id,guild_id,discord_user_id,display_name,user_id) values(11,'guild-1','d1','Operator',1),(12,'guild-1','d2','Ann',2);
    insert into duels(id,guild_id,web_slug,name,organizer_player_id,mode,status,format) values(1,'guild-1','t1','Table',12,'domain','active','ffa4'),
      (2,'guild-1','t2','Lobby',12,'domain','lobby','tag');`);
});
afterEach(() => { db.close(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

const source = { status: "ok", repository: "ProjectIgnis/CardScripts", defaultBranch: null, latestSha: "a", latestCommitDate: null, behindCommits: 0, behindDays: 0, comparison: "identical" };
const cardStatus = {
  generatedAt: "2026-10-19T10:00:00.000Z",
  engine: { bundleVersion: "b1", preparedAt: null, preparedAtSource: "unknown", cardCount: 1, cdbFiles: [],
    sources: Object.fromEntries(["database", "scripts", "strings"].map((k) => [k, { repository: "r/r", pinnedSha: "a", pinnedCommitDate: "2026-10-17T00:00:00Z" }])) },
  catalog: { lastSuccessfulSyncAt: null, lastCardCachedAt: null, totalCards: 0, revision: 1, newestSets: [] },
  gap: { recentSetsMissingFromEngineCount: 0, recentSetsUnknownCount: 0, recentSets: [], cachedCatalogMissingCount: 0, cachedCatalogMissing: [], cachedCatalogIdMismatch: [] },
  upstream: { checkedAt: "2026-10-19T09:59:00.000Z", expiresAt: "2026-10-19T10:59:00.000Z",
    sources: { database: source, scripts: source, strings: source }, babelCdbFiles: { status: "ok", files: [] } },
  updateWorkflow: { lastRunStatus: "ok", lastRun: null, pullRequestStatus: "ok", openPullRequest: null },
};

/** The network edge: the duel host answers by operation, the WS server answers GET /health, or the connection fails. */
function stubServices(mode: "up" | "down", ws: "up" | "down" = "up") {
  vi.stubGlobal("fetch", async (url: string | URL, init?: { body?: string }) => {
    if (String(url).endsWith("/health")) {
      calls.push("ws-health");
      if (ws === "down") throw new TypeError("fetch failed");
      return Response.json({ ok: true, uptime: 7200, connections: 3 });
    }
    const { op } = JSON.parse(init!.body!) as { op: string };
    calls.push(op);
    if (mode === "down") throw new TypeError("fetch failed");
    const body = op === "capabilities" ? { multiplayerTables: true, multiCoreReady: true, multiDomainCoreReady: true } : cardStatus;
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  });
}
const stubDuelHost = stubServices;
async function system() { const { GET } = await import("../app/api/admin/console/system/route"); return GET(); }
const beat = (age: number) => db.prepare("insert into worker_heartbeat(id,at,pid) values(1,?,4242)").run(Date.now() - age);

it("reports a healthy system: version link, card data, duel server, worker and database", async () => {
  stubDuelHost("up"); beat(10_000);
  const response = await system();
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.state).toBe("ok");
  expect(body.data.version).toBe(SHA);
  expect(body.data.commit).toEqual({ short: "0123456", url: `https://github.com/DuelingDomain/yugioh-bot/commit/${SHA}` });
  expect(body.data.duelServer).toMatchObject({ ok: true, detail: null, activeTables: 1 });
  expect(body.data.duelServer.latencyMs).toBeGreaterThanOrEqual(0);
  expect(body.data.cardData).toMatchObject({ state: "up-to-date", dataAsOf: "2026-10-17T00:00:00Z" });
  expect(body.data.cardData.lastUpdate).toMatchObject({ pullRequestNumber: expect.any(Number), pullRequestUrl: expect.stringContaining("https://github.com/") });
  expect(body.data.worker).toMatchObject({ ok: true, stale: false, pid: 4242 });
  expect(body.data.database).toBeNull(); // in-memory database has no file
  expect(calls.filter((c) => c !== "ws-health")).toEqual(["capabilities", "engine-data-status"]);
  const text = JSON.stringify(body);
  expect(text).not.toContain(SECRET);
  expect(text).not.toContain("duel.internal");
  expect(text).not.toContain("ws.internal");
});

it("shows the duel host as down, without a secret or URL, and skips the card data call", async () => {
  stubDuelHost("down"); beat(10_000);
  const body = await (await system()).json();
  expect(body.state).toBe("ok");
  expect(body.data.duelServer).toMatchObject({ ok: false, latencyMs: null, activeTables: 1 });
  expect(body.data.duelServer.detail).toMatch(/duel engine did not answer/i);
  expect(body.data.cardData.state).toBe("unknown");
  expect(body.data.cardData.lastUpdate).not.toBeNull();
  expect(body.data.worker.ok).toBe(true);
  expect(calls.filter((c) => c !== "ws-health")).toEqual(["capabilities"]);
  const text = JSON.stringify(body);
  expect(text).not.toContain(SECRET);
  expect(text).not.toContain("duel.internal");
  expect(text).not.toContain("ws.internal");
});

it("answers 404 to a non-owner", async () => {
  auth.mockResolvedValue({ user: { id: "2", name: "Ann" } });
  expect((await system()).status).toBe(404);
});

const system_ = async () => (await (await system()).json()).data;
type Svc = { id: string; state: string; detail: string; latencyMs: number | null };
const service = (data: { services: Svc[] }, id: string) => data.services.find((s) => s.id === id) as Svc;

it("lists every service and says All systems up when nothing is wrong", async () => {
  stubServices("up"); beat(10_000);
  const data = await system_();
  expect(data.services.map((s: { id: string; state: string }) => [s.id, s.state])).toEqual([
    ["web", "up"], ["duel", "up"], ["worker", "up"], ["ws", "up"], ["bot", "not-deployed"], ["database", "up"],
  ]);
  expect(data.problems).toBe(0);
  expect(data.disk).toMatchObject({ tone: "ok", usedPercent: 50, totalBytes: 100 * GIB, freeBytes: 50 * GIB });
});

it("shows the WS server as up with its connection count and latency", async () => {
  stubServices("up", "up"); beat(10_000);
  const ws = service(await system_(), "ws") 
  expect(ws.state).toBe("up");
  expect(ws.detail).toBe("3 connections. Up 2 h");
  expect(ws.latencyMs).toBeGreaterThanOrEqual(0);
  expect(calls).toContain("ws-health");
});

it("shows the WS server as down and counts it as a problem", async () => {
  stubServices("up", "down"); beat(10_000);
  const data = await system_();
  expect(service(data, "ws")).toMatchObject({ state: "down", latencyMs: null });
  expect(data.problems).toBe(1);
  expect(JSON.stringify(data)).not.toContain("ws.internal");
});

it("says the WS server is not configured without WS_INTERNAL_URL", async () => {
  vi.stubEnv("WS_INTERNAL_URL", "");
  stubServices("up"); beat(10_000);
  const data = await system_();
  expect(service(data, "ws")).toMatchObject({ state: "not-configured", detail: "WS_INTERNAL_URL is not set." });
  expect(data.problems).toBe(0);
  expect(calls).not.toContain("ws-health");
});

it("has no disk breakdown until the worker measures, then returns the stored snapshot", async () => {
  stubServices("up"); beat(10_000);
  let data = await system_();
  expect(data.disk.breakdown).toBeNull();
  expect(data.disk.trend).toBeNull();
  const snapshot = { measuredAt: 1, dataBytes: 9 * GIB, database: { bytes: 5_000_000, walBytes: 30_000 }, images: { bytes: 3 * GIB, capBytes: 15 * GIB },
    engine: { bytes: 4 * GIB }, backups: null, other: { bytes: GIB } };
  const at = Date.now() - 4 * 60_000;
  db.prepare("insert into disk_usage_snapshot(id, at, json) values (1, ?, ?)").run(at, JSON.stringify(snapshot));
  data = await system_();
  expect(data.disk.breakdown).toEqual({ ...snapshot, measuredAt: at });
});

