import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { migrate } from "@yugidraft/shared/db";

const auth = vi.fn();
const tempDirs: string[] = [];

vi.mock("@/lib/auth", () => ({ auth }));

function jsonResponse(status: number): Response {
  return new Response("{}", { status, headers: { "content-type": "application/json" } });
}

function seedDb(): void {
  const tempDir = mkdtempSync(join(tmpdir(), "yugioh-duel-actor-"));
  const dbPath = join(tempDir, "test.sqlite");
  tempDirs.push(tempDir);
  process.env.DATABASE_PATH = dbPath;
  process.env.DISCORD_GUILD_ID = "guild-1";
  process.env.DISCORD_TOKEN = "bot-token";
  const db = new Database(dbPath);
  migrate(db);
  db.close();
}

describe("requireDuelActor guild membership", () => {
  beforeEach(() => {
    vi.resetModules();
    auth.mockReset();
    auth.mockResolvedValue({
      user: { id: "196382527131222016", name: "Yugi" },
    });
  });

  afterEach(() => {
    delete process.env.DATABASE_PATH;
    delete process.env.DISCORD_GUILD_ID;
    delete process.env.DISCORD_TOKEN;
    vi.unstubAllGlobals();
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) rmSync(dir, { recursive: true, force: true });
    }
  });

  it("creates the player after Discord confirms membership", async () => {
    seedDb();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200)));
    // env.discordGuildId and getDb bind process.env at module load.
    const { requireDuelActor } = await import("../src/lib/duel-host");
    const { getDb } = await import("../src/lib/db");

    const actor = await requireDuelActor();
    expect(actor.ok).toBe(true);
    if (!actor.ok) throw new Error("expected member actor");
    expect(actor.guildId).toBe("guild-1");

    const row = getDb()
      .prepare("select count(*) as c from players where guild_id = ? and discord_user_id = ?")
      .get("guild-1", "196382527131222016") as { c: number };
    expect(row.c).toBe(1);
  });

  it("does not create a player for an outsider", async () => {
    seedDb();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(404)));
    // env.discordGuildId and getDb bind process.env at module load.
    const { requireDuelActor } = await import("../src/lib/duel-host");
    const { getDb } = await import("../src/lib/db");

    const actor = await requireDuelActor();
    expect(actor.ok).toBe(false);
    if (actor.ok) throw new Error("expected outsider to fail");
    expect(actor.response.status).toBe(403);

    const row = getDb().prepare("select count(*) as c from players").get() as { c: number };
    expect(row.c).toBe(0);
  });

  it("does not create a player when membership cannot be verified", async () => {
    seedDb();
    delete process.env.DISCORD_TOKEN;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    // env.discordGuildId and getDb bind process.env at module load.
    const { requireDuelActor } = await import("../src/lib/duel-host");
    const { getDb } = await import("../src/lib/db");

    const actor = await requireDuelActor();
    expect(actor.ok).toBe(false);
    if (actor.ok) throw new Error("expected unavailable membership to fail");
    expect(actor.response.status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();

    const row = getDb().prepare("select count(*) as c from players").get() as { c: number };
    expect(row.c).toBe(0);
  });
});
