import Database from "better-sqlite3";
import { migrate } from "@yugidraft/shared/db";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const { auth, getDb } = vi.hoisted(() => ({ auth: vi.fn(), getDb: vi.fn() }));
vi.mock("@/lib/session-identity", async () => {
  const { sessionFixture } = await import("./fixtures/session");
  return sessionFixture(auth);
});
vi.mock("@/lib/db", () => ({ getDb }));

const SECRET = "duel-secret-value";
const SHA = "0123456789abcdef0123456789abcdef01234567";
let db: Database.Database;
let calls: string[];

beforeEach(() => {
  vi.resetModules(); auth.mockReset(); getDb.mockReset(); calls = [];
  auth.mockResolvedValue({ user: { id: "1", name: "Operator" } });
  vi.stubEnv("OWNER_USER_IDS", "1"); vi.stubEnv("DISCORD_GUILD_ID", "guild-1");
  vi.stubEnv("DUEL_INTERNAL_URL", "http://duel.internal:4003"); vi.stubEnv("DUEL_INTERNAL_SECRET", SECRET);
  vi.stubEnv("SENTRY_RELEASE", SHA);
  db = new Database(":memory:"); migrate(db); getDb.mockReturnValue(db);
  db.exec(`insert into users(id,username,display_name) values(1,'op','Operator'),(2,'ann','Ann');
    insert into players(id,guild_id,discord_user_id,display_name,user_id) values(12,'guild-1','d2','Ann',2);
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

/** The network edge: the duel host answers by operation, or the connection fails. */
function stubDuelHost(mode: "up" | "down") {
  vi.stubGlobal("fetch", async (_url: string, init: { body: string }) => {
    const { op } = JSON.parse(init.body) as { op: string };
    calls.push(op);
    if (mode === "down") throw new TypeError("fetch failed");
    const body = op === "capabilities" ? { multiplayerTables: true, multiCoreReady: true, multiDomainCoreReady: true } : cardStatus;
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  });
}
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
  expect(calls).toEqual(["capabilities", "engine-data-status"]);
  const text = JSON.stringify(body);
  expect(text).not.toContain(SECRET);
  expect(text).not.toContain("duel.internal");
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
  expect(calls).toEqual(["capabilities"]);
  const text = JSON.stringify(body);
  expect(text).not.toContain(SECRET);
  expect(text).not.toContain("duel.internal");
});

it("warns when the worker heartbeat is older than 3 minutes, and when there is none", async () => {
  stubDuelHost("up"); beat(5 * 60_000);
  let body = await (await system()).json();
  expect(body.data.worker).toMatchObject({ ok: false, stale: true, pid: 4242 });
  expect(body.data.worker.lastTickAt).toBeLessThan(Date.now() - 4 * 60_000);
  db.exec("delete from worker_heartbeat");
  body = await (await system()).json();
  expect(body.data.worker).toEqual({ ok: false, lastTickAt: null, stale: true, pid: null });
});

it("answers 404 to a non-owner", async () => {
  auth.mockResolvedValue({ user: { id: "2", name: "Ann" } });
  expect((await system()).status).toBe(404);
});
