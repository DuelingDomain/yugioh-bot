import { fixtureUserId, fixtureDiscordId, seedFixtureUsers } from "./fixtures/identity";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.fn();
const tempDirs: string[] = [];

vi.mock("@/lib/session-identity", async () => {
  const { sessionFixture } = await import("./fixtures/session");
  return sessionFixture(auth);
});

describe("POST /api/drafts/[slug]/tournament", () => {
  beforeEach(() => {
    vi.resetModules();
    auth.mockReset();
    auth.mockResolvedValue({ user: { id: String(fixtureUserId("creator-user")), discordUserId: fixtureDiscordId("creator-user"), name: "Yugi" } });
  });

  afterEach(() => {
    delete process.env.DATABASE_PATH;
    delete process.env.DISCORD_GUILD_ID;
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) rmSync(dir, { recursive: true, force: true });
    }
  });

  async function setupCompletedDraft() {
    const tempDir = mkdtempSync(join(tmpdir(), "yugioh-tournament-route-"));
    const dbPath = join(tempDir, "test.sqlite");
    tempDirs.push(tempDir);
    process.env.DATABASE_PATH = dbPath;
    process.env.DISCORD_GUILD_ID = "guild-1";

    const Database = (await import("better-sqlite3")).default;
    const { migrate } = await import("@yugidraft/shared/db");
    const db = new Database(dbPath);
    migrate(db);
    seedFixtureUsers(db, FIXTURE_KEYS);

    db.prepare(`insert into players (guild_id, user_id, discord_user_id, display_name) values ('guild-1', ${fixtureUserId("creator-user")}, '${fixtureDiscordId("creator-user")}', 'Yugi')`).run();
    db.prepare(`insert into players (guild_id, user_id, discord_user_id, display_name) values ('guild-1', ${fixtureUserId("other-user")}, '${fixtureDiscordId("other-user")}', 'Kaiba')`).run();
    const p1 = db.prepare(`select id from players where user_id = ${fixtureUserId("creator-user")}`).get() as { id: number };
    const p2 = db.prepare(`select id from players where user_id = ${fixtureUserId("other-user")}`).get() as { id: number };

    db.prepare(
      `insert into drafts (guild_id, channel_id, name, status, created_by_user_id, config_json, web_slug) values ('guild-1', 'ch1', 'My Draft', 'completed', ${fixtureUserId("creator-user")}, '{}', 'test-slug')`,
    ).run();
    db.prepare("insert into draft_players (draft_id, player_id) values (1, ?)").run(p1.id);
    db.prepare("insert into draft_players (draft_id, player_id) values (1, ?)").run(p2.id);
    db.close();
  }

  it("creates a round-robin tournament seeded with draft players", async () => {
    await setupCompletedDraft();
    const { POST } = await import("../app/api/drafts/[slug]/tournament/route");
    const request = new Request("http://localhost/api/drafts/test-slug/tournament", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ format: "round_robin" }),
    }) as NextRequest;

    const response = await POST(request, { params: Promise.resolve({ slug: "test-slug" }) });
    expect(response.status).toBe(201);
    const data = await response.json();
    expect(data.format).toBe("round_robin");
    expect(data.name).toBe("My Draft");
  });

  it("returns 409 when tournament already linked", async () => {
    await setupCompletedDraft();
    const { POST } = await import("../app/api/drafts/[slug]/tournament/route");
    const req = () => new Request("http://localhost/api/drafts/test-slug/tournament", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ format: "round_robin" }),
    }) as NextRequest;

    const created = await POST(req(), { params: Promise.resolve({ slug: "test-slug" }) });
    expect(created.status).toBe(201);
    const response2 = await POST(req(), { params: Promise.resolve({ slug: "test-slug" }) });
    expect(response2.status).toBe(409);
    expect(await response2.json()).toEqual(await created.json());
  });

  it("returns 403 for a non-creator", async () => {
    await setupCompletedDraft();
    auth.mockResolvedValue({ user: { id: String(fixtureUserId("other-user")), discordUserId: fixtureDiscordId("other-user"), name: "Kaiba" } });
    const { POST } = await import("../app/api/drafts/[slug]/tournament/route");
    const request = new Request("http://localhost/api/drafts/test-slug/tournament", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ format: "round_robin" }),
    }) as NextRequest;

    const response = await POST(request, { params: Promise.resolve({ slug: "test-slug" }) });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: "Only the draft creator can create a tournament",
    });
  });

  it("allows an email-only creator", async () => {
    await setupCompletedDraft();
    auth.mockResolvedValue({ user: { id: String(fixtureUserId("creator-user")), discordUserId: null, name: "Host" } });
    expect((await postWithBody({ format: "round_robin" })).status).toBe(201);
  });

  it("rejects a former admin who did not create or join the draft", async () => {
    await setupCompletedDraft();
    auth.mockResolvedValue({ user: { id: String(fixtureUserId("admin-user")), discordUserId: null } });
    expect((await postWithBody({ format: "round_robin" })).status).toBe(403);
    const { getDb } = await import("../src/lib/db");
    expect(getDb().prepare("select count(*) as n from tournaments").get()).toEqual({ n: 0 });
  });

  it("rejects a non-creator independently of Discord availability", async () => {
    await setupCompletedDraft();
    auth.mockResolvedValue({ user: { id: String(fixtureUserId("other-user")), discordUserId: fixtureDiscordId("other-user") } });

    const response = await postWithBody({ format: "round_robin" });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: "Only the draft creator can create a tournament",
    });
  });

  it("returns 400 for invalid format", async () => {
    await setupCompletedDraft();
    const { POST } = await import("../app/api/drafts/[slug]/tournament/route");
    const request = new Request("http://localhost/api/drafts/test-slug/tournament", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ format: "invalid" }),
    }) as NextRequest;

    const response = await POST(request, { params: Promise.resolve({ slug: "test-slug" }) });
    expect(response.status).toBe(400);
  });

  async function postWithBody(body: unknown) {
    const { POST } = await import("../app/api/drafts/[slug]/tournament/route");
    const request = new Request("http://localhost/api/drafts/test-slug/tournament", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }) as NextRequest;
    return POST(request, { params: Promise.resolve({ slug: "test-slug" }) });
  }

  async function storedBestOf(): Promise<number> {
    const Database = (await import("better-sqlite3")).default;
    const db = new Database(process.env.DATABASE_PATH!);
    const row = db.prepare("select best_of from tournaments order by id desc limit 1").get() as { best_of: number };
    db.close();
    return row.best_of;
  }

  it("makes a Best of 3 tournament when bestOf is missing", async () => {
    await setupCompletedDraft();
    expect((await postWithBody({ format: "round_robin" })).status).toBe(201);
    expect(await storedBestOf()).toBe(3);
  });

  it("passes bestOf 1 on to the tournament", async () => {
    await setupCompletedDraft();
    expect((await postWithBody({ format: "round_robin", bestOf: 1 })).status).toBe(201);
    expect(await storedBestOf()).toBe(1);
  });

  it("returns 400 when bestOf is not 1 or 3", async () => {
    await setupCompletedDraft();
    const response = await postWithBody({ format: "round_robin", bestOf: 5 });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/bestOf/);
  });
});

const FIXTURE_KEYS = ["creator-user", "other-user", "admin-user"] as const;
