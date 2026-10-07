import Database from "better-sqlite3";
import { migrate } from "@yugidraft/shared/db";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const { auth, host, getDb } = vi.hoisted(() => ({ auth: vi.fn(), host: vi.fn(), getDb: vi.fn() }));
vi.mock("@/lib/session-identity", async () => {
  const { sessionFixture } = await import("./fixtures/session");
  return sessionFixture(auth);
});
vi.mock("@/lib/duel-host", () => ({ callEngineDataStatus: host }));
vi.mock("@/lib/db", () => ({ getDb }));
let db: Database.Database;
beforeEach(() => {
  vi.resetModules(); auth.mockReset(); host.mockReset(); getDb.mockReset();
  auth.mockResolvedValue({ user: { id: "1", name: "Operator" } });
  vi.stubEnv("DISCORD_GUILD_ID", "guild-1"); vi.stubEnv("OWNER_USER_IDS", "1");
  db = new Database(":memory:"); migrate(db); getDb.mockReturnValue(db);
  db.prepare("insert into users (id, username, display_name) values (1, 'operator', 'Operator'), (2, 'member', 'Member')").run();
  host.mockResolvedValue({ ok: true, data: { generatedAt: "2026-10-01T00:00:00Z", engine: { bundleVersion: "v1" } } });
});
afterEach(() => { db.close(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
async function get() { const { GET } = await import("../app/api/admin/card-data-status/route"); return GET(); }

it("rejects unauthenticated users before reading data", async () => {
  auth.mockResolvedValue(null); expect((await get()).status).toBe(401);
  expect(host).not.toHaveBeenCalled(); expect(getDb).not.toHaveBeenCalled();
});
it("answers 404 to a signed-in user not in OWNER_USER_IDS, before reading data", async () => {
  auth.mockResolvedValue({ user: { id: "2", name: "Member" } });
  expect((await get()).status).toBe(404);
  expect(host).not.toHaveBeenCalled(); expect(getDb).not.toHaveBeenCalled();
});
it("answers 404 to everyone when OWNER_USER_IDS is empty", async () => {
  vi.stubEnv("OWNER_USER_IDS", "");
  expect((await get()).status).toBe(404);
  expect(host).not.toHaveBeenCalled();
});
it("fails closed with 503 when the session can't be read", async () => {
  auth.mockRejectedValue(new Error("down"));
  expect((await get()).status).toBe(503);
  expect(host).not.toHaveBeenCalled(); expect(getDb).not.toHaveBeenCalled();
});
it("allows an owner and scopes the host actor to the configured guild", async () => {
  const response = await get();
  expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.json()).toMatchObject({ engine: { bundleVersion: "v1" } });
  expect(host).toHaveBeenCalledWith({ guildId: "guild-1", playerId: expect.any(Number) });
});
it("returns 503 when the duel host or local data is unavailable", async () => {
  host.mockResolvedValue({ ok: false, response: Response.json({ error: "Unavailable" }, { status: 503 }) });
  expect((await get()).status).toBe(503);
  getDb.mockImplementation(() => { throw new Error("Database unavailable"); });
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  try { expect((await get()).status).toBe(503); } finally { log.mockRestore(); }
});
