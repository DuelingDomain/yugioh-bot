import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.fn();
const tempDirs: string[] = [];

vi.mock("@/lib/auth", () => ({ auth }));
vi.mock("@/lib/notify", () => ({ announcer: { announce: vi.fn() } }));

describe("POST /api/drafts (theme mode)", () => {
  beforeEach(() => {
    vi.resetModules();
    auth.mockReset();
    auth.mockResolvedValue({ user: { id: "creator-user", name: "Yugi" } });
  });

  afterEach(() => {
    delete process.env.DATABASE_PATH;
    delete process.env.DISCORD_GUILD_ID;
    delete process.env.DISCORD_DEFAULT_CHANNEL_ID;
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) rmSync(dir, { recursive: true, force: true });
    }
  });

  async function setupHostCreation() {
    const tempDir = mkdtempSync(join(tmpdir(), "yugioh-theme-create-"));
    tempDirs.push(tempDir);
    process.env.DATABASE_PATH = join(tempDir, "theme-create.sqlite");
    process.env.DISCORD_GUILD_ID = "guild-1";
    process.env.DISCORD_DEFAULT_CHANNEL_ID = "channel-1";

    const { getDb } = await import("@/lib/db");
    const db = getDb();
    db.prepare("insert into cubes (guild_id, name, created_by_user_id) values ('guild-1', 'Blue-Eyes', 'u')").run();
    db.prepare("insert into cubes (guild_id, name, created_by_user_id) values ('guild-1', 'Dark Magician', 'u')").run();
    return db;
  }

  it.each([undefined, {}, { "999": 1 }, { "1": null }, { "1": 3 }])(
    "rejects host assignment without an allowed theme for the creator (%j)",
    async (themeAssignments) => {
      const tempDir = mkdtempSync(join(tmpdir(), "yugioh-theme-create-"));
      tempDirs.push(tempDir);
      process.env.DATABASE_PATH = join(tempDir, "theme-create.sqlite");
      process.env.DISCORD_GUILD_ID = "guild-1";
      process.env.DISCORD_DEFAULT_CHANNEL_ID = "channel-1";

      const { POST } = await import("../app/api/drafts/route");
      const response = await POST(new Request("http://localhost/api/drafts", {
        method: "POST",
        body: JSON.stringify({
          name: "Theme Night",
          config: { mode: "theme", allowedCubeIds: [1, 2], themeSelection: "host_assigned", themeAssignments },
        }),
      }) as NextRequest);

      expect(response.status).toBe(400);
      expect((await response.json()).error).toMatch(/assignment for every player/i);
      const { getDb } = await import("@/lib/db");
      expect(getDb().prepare("select count(*) as n from drafts").get()).toEqual({ n: 0 });
    },
  );

  it("accepts host assignment when the creator has an allowed theme", async () => {
    const db = await setupHostCreation();

    const { POST } = await import("../app/api/drafts/route");
    const response = await POST(new Request("http://localhost/api/drafts", {
      method: "POST",
      body: JSON.stringify({
        name: "Theme Night",
        config: { mode: "theme", allowedCubeIds: [1, 2], themeSelection: "host_assigned", themeAssignments: { "1": 1 } },
      }),
    }) as NextRequest);

    expect(response.status).toBe(201);
    const row = db.prepare("select config_json from drafts").get() as { config_json: string };
    expect(JSON.parse(row.config_json)).toMatchObject({ themeSelection: "host_assigned", themeAssignments: { "1": 1 } });
  });

  it.each(["foreign-guild", "deleted", "nonexistent"])("rejects a %s assigned theme", async (invalidCube) => {
    const db = await setupHostCreation();
    if (invalidCube === "foreign-guild") db.prepare("update cubes set guild_id = 'guild-2' where id = 1").run();
    if (invalidCube === "deleted") db.prepare("delete from cubes where id = 1").run();
    const cubeId = invalidCube === "nonexistent" ? 999 : 1;

    const { POST } = await import("../app/api/drafts/route");
    const response = await POST(new Request("http://localhost/api/drafts", {
      method: "POST",
      body: JSON.stringify({
        name: "Theme Night",
        config: { mode: "theme", allowedCubeIds: [cubeId, 2], themeSelection: "host_assigned", themeAssignments: { "1": cubeId } },
      }),
    }) as NextRequest);

    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/exist.*draft.*guild/i);
    expect(db.prepare("select count(*) as n from drafts").get()).toEqual({ n: 0 });
  });

  it("validates assignments beyond the creator", async () => {
    const db = await setupHostCreation();
    const { POST } = await import("../app/api/drafts/route");
    const response = await POST(new Request("http://localhost/api/drafts", {
      method: "POST",
      body: JSON.stringify({
        name: "Theme Night",
        config: { mode: "theme", allowedCubeIds: [1, 2], themeSelection: "host_assigned", themeAssignments: { "1": 1, "2": 999 } },
      }),
    }) as NextRequest);

    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/allowed theme assignment/i);
    expect(db.prepare("select count(*) as n from drafts").get()).toEqual({ n: 0 });
  });

  it.each([true, false, undefined])("enforces assignment uniqueness with uniqueThemes=%s", async (uniqueThemes) => {
    const db = await setupHostCreation();
    db.prepare("insert into players (guild_id, discord_user_id, display_name) values ('guild-1', 'creator-user', 'Yugi')").run();
    db.prepare("insert into players (guild_id, discord_user_id, display_name) values ('guild-1', 'other-user', 'Kaiba')").run();
    const { POST } = await import("../app/api/drafts/route");
    const response = await POST(new Request("http://localhost/api/drafts", {
      method: "POST",
      body: JSON.stringify({
        name: "Theme Night",
        config: { mode: "theme", allowedCubeIds: [1, 2], themeSelection: "host_assigned", themeAssignments: { "1": 1, "2": 1 }, uniqueThemes },
      }),
    }) as NextRequest);

    if (uniqueThemes === false) {
      expect(response.status).toBe(201);
      const row = db.prepare("select config_json from drafts").get() as { config_json: string };
      expect(JSON.parse(row.config_json)).toMatchObject({ uniqueThemes: false, themeAssignments: { "1": 1, "2": 1 } });
    } else {
      expect(response.status).toBe(400);
      expect((await response.json()).error).toMatch(/distinct.*uniqueThemes/i);
      expect(db.prepare("select count(*) as n from drafts").get()).toEqual({ n: 0 });
    }
  });

  it("creates a theme draft and persists theme config without a card pool", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "yugioh-theme-create-"));
    const dbPath = join(tempDir, "theme-create.sqlite");
    tempDirs.push(tempDir);

    process.env.DATABASE_PATH = dbPath;
    process.env.DISCORD_GUILD_ID = "guild-1";
    process.env.DISCORD_DEFAULT_CHANNEL_ID = "channel-1";

    const Database = (await import("better-sqlite3")).default;
    const { migrate } = await import("@yugidraft/shared/db");
    const db = new Database(dbPath);
    migrate(db);
    // two cubes to allow
    db.prepare("insert into cubes (guild_id, name, created_by_user_id, created_at, updated_at) values ('guild-1','Blue-Eyes','u','t','t')").run();
    db.prepare("insert into cubes (guild_id, name, created_by_user_id, created_at, updated_at) values ('guild-1','Dark Magician','u','t','t')").run();
    db.close();

    const { POST } = await import("../app/api/drafts/route");
    const request = new Request("http://localhost/api/drafts", {
      method: "POST",
      body: JSON.stringify({
        name: "Theme Night",
        config: { mode: "theme", allowedCubeIds: [1, 2], themePackSize: 4, extraDeckEnabled: false },
      }),
    }) as NextRequest;
    const response = await POST(request);
    expect(response.status).toBe(201);

    const verifyDb = new Database(dbPath);
    const row = verifyDb.prepare("select config_json from drafts where name = ?").get("Theme Night") as { config_json: string };
    const config = JSON.parse(row.config_json);
    expect(config.mode).toBe("theme");
    expect(config.allowedCubeIds).toEqual([1, 2]);
    expect(config.themePackSize).toBe(4);
    expect(config.uniqueThemes).toBe(true); // default applied
    verifyDb.close();
  });
});
