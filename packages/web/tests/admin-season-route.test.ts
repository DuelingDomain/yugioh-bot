import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockDiscordAccess } from "./fixtures/discord-access";

const auth = vi.fn();
const tempDirs: string[] = [];
let discord: ReturnType<typeof mockDiscordAccess>;
vi.mock("@/lib/auth", () => ({ auth }));

async function seed() {
  const tempDir = mkdtempSync(join(tmpdir(), "yugioh-admin-season-"));
  const dbPath = join(tempDir, "test.sqlite");
  tempDirs.push(tempDir);
  process.env.DATABASE_PATH = dbPath;
  process.env.DISCORD_GUILD_ID = "guild-1";
  const Database = (await import("better-sqlite3")).default;
  const { migrate } = await import("@yugidraft/shared/db");
  const db = new Database(dbPath);
  migrate(db);
  db.close();
}

describe("POST /api/admin/season", () => {
  beforeEach(() => { vi.resetModules(); auth.mockReset(); auth.mockResolvedValue({ user: { id: "u1", name: "Admin" } }); discord = mockDiscordAccess(); });
  afterEach(() => {
    vi.unstubAllGlobals(); vi.unstubAllEnvs();
    delete process.env.DATABASE_PATH; delete process.env.DISCORD_GUILD_ID;
    while (tempDirs.length) { const d = tempDirs.pop(); if (d) rmSync(d, { recursive: true, force: true }); }
  });

  it("401 when unauthenticated", async () => {
    await seed();
    auth.mockResolvedValue(null);
    const { POST } = await import("../app/api/admin/season/route");
    const res = await POST(new Request("http://x/api/admin/season", {
      method: "POST", body: JSON.stringify({ action: "start" }),
    }));
    expect(res.status).toBe(401);
  });

  it("start then end manages the active season", async () => {
    await seed();
    const { POST } = await import("../app/api/admin/season/route");
    const startRes = await POST(new Request("http://x/api/admin/season", {
      method: "POST", body: JSON.stringify({ action: "start" }),
    }));
    expect(startRes.status).toBe(200);
    expect((await startRes.json()).season.number).toBeGreaterThanOrEqual(1);

    const endRes = await POST(new Request("http://x/api/admin/season", {
      method: "POST", body: JSON.stringify({ action: "end" }),
    }));
    expect(endRes.status).toBe(200);
    expect((await endRes.json()).season.status).toBe("ended");
  });

  it.each(["start", "end"])("rejects a non-member attempting to %s", async (action) => {
    await seed();
    discord.memberStatus = 404;
    const { POST } = await import("../app/api/admin/season/route");
    const res = await POST(new Request("http://x", { method: "POST", body: JSON.stringify({ action }) }));
    expect(res.status).toBe(403);
    const { getDb } = await import("../src/lib/db");
    expect(getDb().prepare("select count(*) as n from seasons").get()).toEqual({ n: 0 });
  });

  it.each(["start", "end"])("rejects an ordinary member attempting to %s", async (action) => {
    await seed();
    discord.permissions = "0";
    const { POST } = await import("../app/api/admin/season/route");
    const res = await POST(new Request("http://x", { method: "POST", body: JSON.stringify({ action }) }));
    expect(res.status).toBe(403);
  });

  it.each(["discord", "token"])("fails closed when %s is unavailable", async (cause) => {
    await seed();
    if (cause === "token") vi.stubEnv("DISCORD_TOKEN", "");
    else discord.memberStatus = 500;
    const { POST } = await import("../app/api/admin/season/route");
    const res = await POST(new Request("http://x", { method: "POST", body: JSON.stringify({ action: "start" }) }));
    expect(res.status).toBe(503);
  });

  it("keeps GET readable by ordinary members", async () => {
    await seed();
    discord.permissions = "0";
    const { GET } = await import("../app/api/admin/season/route");
    expect((await GET()).status).toBe(200);
  });
});
