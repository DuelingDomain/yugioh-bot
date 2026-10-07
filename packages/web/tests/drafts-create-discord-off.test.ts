import Database from "better-sqlite3";
import type { NextRequest } from "next/server";
import { migrate } from "@yugidraft/shared/db";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { auth, getDb, announce } = vi.hoisted(() => ({
  auth: vi.fn(),
  getDb: vi.fn(),
  announce: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth }));
vi.mock("@/lib/db", () => ({ getDb }));
vi.mock("@/lib/notify", () => ({
  announcer: { announce },
  broadcaster: { draft: vi.fn() },
}));

describe.each(["theme", "booster"] as const)("POST /api/drafts (%s Discord settings)", (mode) => {
  let db: Database.Database;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.stubEnv("DISCORD_GUILD_ID", "guild-1");
    vi.stubEnv("DISCORD_DEFAULT_CHANNEL_ID", "default-channel");
    vi.stubEnv("DISCORD_REMINDER_CHANNEL_ID", undefined);
    vi.stubEnv("DISCORD_BOT_ENABLED", "0");
    auth.mockResolvedValue({ user: { id: "creator-user", name: "Yugi" } });
    announce.mockResolvedValue({ ok: true });
    db = new Database(":memory:");
    migrate(db);
    getDb.mockReturnValue(db);
    const insert = db.prepare(`insert into card_catalog
      (ygoprodeck_id, name, type, frame_type, image_url, image_url_small, card_sets_json, cached_at)
      values (?, ?, 'Effect Monster', 'effect', 'image', 'small', '[]', '2026-10-07T00:00:00Z')`);
    for (const id of [46986414, 83764718]) insert.run(id, `Card ${id}`);
  });

  afterEach(() => {
    db.close();
    vi.unstubAllEnvs();
  });

  async function createDraft(channelId?: unknown) {
    const { POST } = await import("../app/api/drafts/route");
    const config = mode === "theme"
      ? { mode: "theme" }
      : { customCardIds: [46986414, 83764718], packSize: 8, packsPerPlayer: 5 };
    return POST(new Request("http://localhost/api/drafts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Discord Settings Draft", config, channelId }),
    }) as NextRequest);
  }

  it.each([undefined, "0"])("does not announce creation when DISCORD_BOT_ENABLED=%s", async (flag) => {
    vi.stubEnv("DISCORD_BOT_ENABLED", flag);

    const response = await createDraft();

    expect(response.status).toBe(201);
    expect(db.prepare("select count(*) as count from drafts").get()).toEqual({ count: 1 });
    expect(announce).not.toHaveBeenCalled();
  });

  it("announces creation when Discord is enabled", async () => {
    vi.stubEnv("DISCORD_BOT_ENABLED", "1");

    const response = await createDraft();
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(announce).toHaveBeenCalledExactlyOnceWith({
      kind: "draft-created",
      draftId: body.id,
      channelId: "default-channel",
      name: "Discord Settings Draft",
      webSlug: body.webSlug,
    });
  });
});
