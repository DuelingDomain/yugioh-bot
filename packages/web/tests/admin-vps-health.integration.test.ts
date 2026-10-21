import Database from "better-sqlite3";
import { migrate } from "@yugidraft/shared/db";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const { auth, getDb } = vi.hoisted(() => ({ auth: vi.fn(), getDb: vi.fn() }));
vi.mock("@/lib/session-identity", async () => {
  const { sessionFixture } = await import("./fixtures/session"); return sessionFixture(auth);
});
vi.mock("@/lib/db", () => ({ getDb }));
let db: Database.Database;
beforeEach(() => {
  vi.resetModules(); vi.stubEnv("OWNER_USER_IDS", "1"); vi.stubEnv("DISCORD_GUILD_ID", "guild-1");
  auth.mockResolvedValue({ user: { id: "1", name: "Operator" } });
  db = new Database(":memory:"); migrate(db); getDb.mockReturnValue(db);
});
afterEach(() => { db.close(); vi.unstubAllEnvs(); });
const request = async () => (await import("../app/api/admin/console/vps-health/route")).GET();
it("protects diagnostics with the existing session and owner guard before touching SQLite", async () => {
  getDb.mockClear(); auth.mockResolvedValue(null); expect((await request()).status).toBe(401);
  auth.mockResolvedValue({ user: { id: "2", name: "Member" } }); expect((await request()).status).toBe(404);
  expect(getDb).not.toHaveBeenCalled();
});
it("is private/no-store, returns n/a before the worker starts, and never exposes cross-guild activity", async () => {
  const response = await request(); expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(await response.json()).toMatchObject({ current: null, status: null, stale: true });
  db.exec(`insert into users(id,username,display_name) values(1,'owner','Owner');
    insert into players(id,guild_id,discord_user_id,display_name,user_id) values(1,'guild-1','d1','Owner',1);
    insert into duels(guild_id,web_slug,name,organizer_player_id,mode,status,kind) values
      ('guild-1','live','Live',1,'normal','active','play'), ('guild-1','replay','Replay',1,'normal','active','replay-fork'),
      ('other-guild','other','Other',1,'normal','active','play');
    insert into drafts(guild_id,channel_id,name,status,created_by_user_id) values
      ('guild-1','c','Draft','active',1), ('other-guild','c','Other','active',1);`);
  const { collectVpsHealth } = await import("@yugidraft/shared/health");
  collectVpsHealth(db, { cpuPercent: 25, vcpuCount: 2, load: [0.5, 0.3, 0.1], memory: { usedBytes: 2, availableBytes: 2, totalBytes: 4, usedPercent: 50 }, swap: { usedBytes: 0, totalBytes: 0 }, uptimeSeconds: 200 }, "other-guild");
  expect(await (await request()).json()).toMatchObject({ status: "OK", current: { activity: null } });
  const { createHostSampler } = await import("@yugidraft/shared/health");
  collectVpsHealth(db, createHostSampler()(), "guild-1");
  expect(await (await request()).json()).toMatchObject({ current: { activity: { guildId: "guild-1", liveDuels: 1, liveDrafts: 1 } } });
});
it("renders persisted metrics, capacity, n/a and a gap-aware sparkline through the health section", async () => {
  const { collectVpsHealth } = await import("@yugidraft/shared/health");
  const { createElement } = await import("react"); const { renderToStaticMarkup } = await import("react-dom/server");
  const { VpsHealthPanel } = await import("../src/components/admin-console/views/vps-health");
  collectVpsHealth(db, { cpuPercent: 25, vcpuCount: 2, load: [0.5, 0.3, 0.1], memory: { usedBytes: 2e9, availableBytes: 2e9, totalBytes: 4e9, usedPercent: 50 }, swap: { usedBytes: 0, totalBytes: 0 }, uptimeSeconds: 200 }, "guild-1");
  const data = await (await request()).json();
  const html = renderToStaticMarkup(createElement(VpsHealthPanel, { data }));
  expect(html).toContain("VPS health"); expect(html).toContain("25%"); expect(html).toContain("2 vCPU");
  expect(html).toContain("No swap"); expect(html).toContain("n/a"); expect(html).toContain("Live duels");
  expect(html).toContain("ws"); expect(html).toContain("caddy"); expect(html).toContain("Last 24 hours");
});
