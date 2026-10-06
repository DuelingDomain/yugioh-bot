import Database from "better-sqlite3";
import { migrate } from "@yugidraft/shared/db";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mockDiscordAccess } from "./fixtures/discord-access";

const { auth, host, getDb } = vi.hoisted(() => ({ auth: vi.fn(), host: vi.fn(), getDb: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth }));
vi.mock("@/lib/duel-host", () => ({ callEngineDataStatus: host }));
vi.mock("@/lib/db", () => ({ getDb }));
let discord: ReturnType<typeof mockDiscordAccess>;
let db: Database.Database;
beforeEach(() => {
  vi.resetModules(); auth.mockReset(); host.mockReset(); getDb.mockReset();
  auth.mockResolvedValue({ user: { id: "operator", name: "Operator" } });
  discord = mockDiscordAccess(); vi.stubEnv("DISCORD_GUILD_ID", "guild-1");
  db = new Database(":memory:"); migrate(db); getDb.mockReturnValue(db);
  host.mockResolvedValue({ ok: true, data: { generatedAt: "2026-10-01T00:00:00Z", engine: { bundleVersion: "v1" } } });
});
afterEach(() => { db.close(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
async function get() { const { GET } = await import("../app/api/admin/card-data-status/route"); return GET(); }

it("rejects unauthenticated users before reading data", async () => {
  auth.mockResolvedValue(null); expect((await get()).status).toBe(401);
  expect(host).not.toHaveBeenCalled(); expect(getDb).not.toHaveBeenCalled();
});
it.each(["non-member", "ordinary-member"])("rejects %s before reading data", async (who) => {
  if (who === "non-member") discord.memberStatus = 404; else discord.permissions = "0";
  expect((await get()).status).toBe(403);
  expect(host).not.toHaveBeenCalled(); expect(getDb).not.toHaveBeenCalled();
});
it.each(["membership", "permissions", "token", "guild-config"])("fails closed with 503 when %s is unavailable", async (cause) => {
  if (cause === "membership") discord.memberStatus = 500;
  else if (cause === "permissions") discord.guildStatus = 500;
  else if (cause === "token") vi.stubEnv("DISCORD_TOKEN", "");
  else vi.stubEnv("DISCORD_GUILD_ID", "");
  expect((await get()).status).toBe(503);
  expect(host).not.toHaveBeenCalled(); expect(getDb).not.toHaveBeenCalled();
});
it.each(["manager", "administrator", "owner"])("allows a guild %s and scopes the host actor to the configured guild", async (role) => {
  if (role === "administrator") discord.permissions = "8";
  if (role === "owner") { auth.mockResolvedValue({ user: { id: "guild-owner", name: "Owner" } }); discord.permissions = "0"; }
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
