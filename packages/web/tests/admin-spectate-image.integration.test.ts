import Database from "better-sqlite3";
import { migrate } from "@yugidraft/shared/db";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const { auth, getDb } = vi.hoisted(() => ({ auth: vi.fn(), getDb: vi.fn() }));
vi.mock("@/lib/session-identity", async () => { const { sessionFixture } = await import("./fixtures/session"); return sessionFixture(auth); });
vi.mock("@/lib/db", () => ({ getDb }));
let db: Database.Database; let cache: string;
beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks(); db = new Database(":memory:"); migrate(db); getDb.mockReturnValue(db);
  db.exec("insert into users(id,username,display_name) values(1,'owner','Owner')");
  auth.mockResolvedValue({ user: { id: "1", name: "Owner" } });
  cache = mkdtempSync(join(tmpdir(), "admin-spectate-images-"));
  vi.stubEnv("DISCORD_GUILD_ID", "g"); vi.stubEnv("OWNER_USER_IDS", "1"); vi.stubEnv("CARD_IMAGE_CACHE_DIR", cache);
  vi.stubGlobal("fetch", vi.fn(async () => new Response("missing", { status: 404 })));
});
afterEach(() => { db.close(); rmSync(cache, { recursive: true, force: true }); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
it("a missing watch image and alias fallback never register an owner player", async () => {
  const { GET } = await import("../app/api/cards/[passcode]/image/route");
  const response = await GET(new Request("http://localhost/api/cards/10000100/image"), { params: Promise.resolve({ passcode: "10000100" }) });
  expect(response.status).toBe(404);
  expect(db.prepare("select * from players").all()).toEqual([]);
  expect(db.prepare("select * from duel_seats").all()).toEqual([]);
  expect(db.prepare("select * from draft_players").all()).toEqual([]);
});
