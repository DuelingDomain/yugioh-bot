import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { NextRequest } from "next/server";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { migrate } from "@yugidraft/shared/db";

const auth = vi.fn();
vi.mock("@/lib/auth", () => ({ auth }));
const tempDirs: string[] = [];

describe("GET /api/players", () => {
  beforeEach(() => {
    vi.resetModules();
    auth.mockReset();
    auth.mockResolvedValue({ user: { id: "u-me", name: "Yugi" } });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 200 })));
  });
  afterEach(() => {
    for (const key of ["DATABASE_PATH", "DISCORD_GUILD_ID", "DISCORD_TOKEN"]) delete process.env[key];
    vi.unstubAllGlobals();
    while (tempDirs.length) {
      const d = tempDirs.pop();
      if (d) rmSync(d, { recursive: true, force: true });
    }
  });

  function seed() {
    const dir = mkdtempSync(join(tmpdir(), "players-"));
    tempDirs.push(dir);
    process.env.DATABASE_PATH = join(dir, "bot.sqlite");
    process.env.DISCORD_GUILD_ID = "g1";
    process.env.DISCORD_TOKEN = "bot-token";
    const db = new Database(process.env.DATABASE_PATH);
    migrate(db);
    const insert = db.prepare("insert into players (guild_id, discord_user_id, display_name) values (?, ?, ?)");
    insert.run("g1", "u-me", "Yugi");
    insert.run("g1", "u-k", "Kaiba");
    insert.run("g1", "u-j", "Joey");
    insert.run("g2", "u-o", "Kaiba Other Guild");
    db.close();
  }

  const call = (query = "") => import("../app/api/players/route").then(({ GET }) => GET(new NextRequest(`http://localhost/api/players${query}`)));

  it("lists guild players without the caller and without other guilds", async () => {
    seed();
    const res = await call();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { players: Array<{ id: number; displayName: string }> };
    expect(body.players.map((p) => p.displayName)).toEqual(["Joey", "Kaiba"]);
  });

  it("filters by name and treats wildcards literally", async () => {
    seed();
    const filtered = (await (await call("?q=kai")).json()) as { players: Array<{ displayName: string }> };
    expect(filtered.players.map((p) => p.displayName)).toEqual(["Kaiba"]);
    const wild = (await (await call("?q=%25")).json()) as { players: unknown[] };
    expect(wild.players).toEqual([]);
  });

  it("requires a signed-in user", async () => {
    seed();
    auth.mockResolvedValue(null);
    expect((await call()).status).toBe(401);
  });
});
