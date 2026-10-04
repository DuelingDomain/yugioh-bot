import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.fn();
const { checkDiscordWebAccess } = vi.hoisted(() => ({ checkDiscordWebAccess: vi.fn() }));
const tempDirs: string[] = [];

vi.mock("@/lib/auth", () => ({ auth }));
vi.mock("@/lib/discord-web-access", async (importOriginal) => ({
  ...await importOriginal<typeof import("../src/lib/discord-web-access")>(),
  checkDiscordWebAccess,
}));

describe("POST /api/drafts/[slug]/tournament", () => {
  beforeEach(() => {
    vi.resetModules();
    auth.mockReset();
    auth.mockResolvedValue({ user: { id: "creator-user", name: "Yugi" } });
    checkDiscordWebAccess.mockReset();
    checkDiscordWebAccess.mockResolvedValue({ ok: false, status: 403 });
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

    db.prepare("insert into players (guild_id, discord_user_id, display_name) values ('guild-1', 'creator-user', 'Yugi')").run();
    db.prepare("insert into players (guild_id, discord_user_id, display_name) values ('guild-1', 'other-user', 'Kaiba')").run();
    const p1 = db.prepare("select id from players where discord_user_id = 'creator-user'").get() as { id: number };
    const p2 = db.prepare("select id from players where discord_user_id = 'other-user'").get() as { id: number };

    db.prepare(
      `insert into drafts (guild_id, channel_id, name, status, created_by_user_id, config_json, web_slug)
       values ('guild-1', 'ch1', 'My Draft', 'completed', 'creator-user', '{}', 'test-slug')`,
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
    expect(checkDiscordWebAccess).not.toHaveBeenCalled();
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

  it("returns 403 when a non-creator is not an admin", async () => {
    await setupCompletedDraft();
    auth.mockResolvedValue({ user: { id: "other-user", name: "Kaiba" } });
    const { POST } = await import("../app/api/drafts/[slug]/tournament/route");
    const request = new Request("http://localhost/api/drafts/test-slug/tournament", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ format: "round_robin" }),
    }) as NextRequest;

    const response = await POST(request, { params: Promise.resolve({ slug: "test-slug" }) });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: "You must be a member of the Discord server and have permission for this action",
    });
    expect(checkDiscordWebAccess).toHaveBeenCalledExactlyOnceWith("other-user", "admin");
  });

  it("allows the creator when Discord verification is unavailable", async () => {
    await setupCompletedDraft();
    checkDiscordWebAccess.mockResolvedValue({ ok: false, status: 503 });
    expect((await postWithBody({ format: "round_robin" })).status).toBe(201);
    expect(checkDiscordWebAccess).not.toHaveBeenCalled();
  });

  it("returns 201 for an admin who did not create or join the draft", async () => {
    await setupCompletedDraft();
    auth.mockResolvedValue({ user: { id: "admin-user" } });
    checkDiscordWebAccess.mockResolvedValue({ ok: true });

    const created = await postWithBody({ format: "round_robin" });
    expect(created.status).toBe(201);
    const tournament = await created.json();
    expect(tournament).toMatchObject({ name: "My Draft", format: "round_robin" });
    expect(checkDiscordWebAccess).toHaveBeenCalledExactlyOnceWith("admin-user", "admin");

    const duplicate = await postWithBody({ format: "single_elim" });
    expect(duplicate.status).toBe(409);
    expect(await duplicate.json()).toEqual(tournament);
  });

  it("returns 503 when a non-creator's admin verification is unavailable", async () => {
    await setupCompletedDraft();
    auth.mockResolvedValue({ user: { id: "other-user" } });
    checkDiscordWebAccess.mockResolvedValue({ ok: false, status: 503 });

    const response = await postWithBody({ format: "round_robin" });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "Cannot verify Discord server membership or permissions. Please try again later.",
    });
    expect(checkDiscordWebAccess).toHaveBeenCalledExactlyOnceWith("other-user", "admin");
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
