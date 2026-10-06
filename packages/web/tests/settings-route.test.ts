import { fixtureUserId, fixtureDiscordId } from "./fixtures/identity";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockDiscordAccess } from "./fixtures/discord-access";

const auth = vi.fn();
vi.mock("@/lib/auth", () => ({ auth }));
let tempDir: string;
let discord: ReturnType<typeof mockDiscordAccess>;

describe("guild settings access", () => {
  beforeEach(async () => {
    vi.resetModules();
    auth.mockResolvedValue({ user: { id: String(fixtureUserId("member")), discordUserId: fixtureDiscordId("member") } });
    discord = mockDiscordAccess();
    tempDir = mkdtempSync(join(tmpdir(), "yugioh-settings-access-"));
    vi.stubEnv("DATABASE_PATH", join(tempDir, "test.sqlite"));
    vi.stubEnv("DISCORD_GUILD_ID", "guild-1");
    const { getDb } = await import("../src/lib/db");
    getDb();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    rmSync(tempDir, { recursive: true, force: true });
  });

  const write = async () => {
    const { PUT } = await import("../app/api/settings/route");
    return PUT(new Request("http://x/api/settings", {
      method: "PUT", body: JSON.stringify({ announceChannelId: "new-channel" }),
    }) as NextRequest);
  };

  it("rejects unauthenticated writes", async () => {
    auth.mockResolvedValue(null);
    expect((await write()).status).toBe(401);
  });

  it("rejects non-members without changing settings", async () => {
    discord.memberStatus = 404;
    expect((await write()).status).toBe(403);
    const { getDb } = await import("../src/lib/db");
    expect(getDb().prepare("select count(*) as n from guild_settings").get()).toEqual({ n: 0 });
  });

  it("rejects members without Manage Server", async () => {
    discord.permissions = "0";
    expect((await write()).status).toBe(403);
  });

  it("allows guild admins to update settings", async () => {
    const res = await write();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ announceChannelId: "new-channel" });
  });

  it.each(["member", "guild", "token"])("fails closed when %s lookup is unavailable", async (cause) => {
    if (cause === "token") vi.stubEnv("DISCORD_TOKEN", "");
    else if (cause === "member") discord.memberStatus = 500;
    else discord.guildStatus = 500;
    expect((await write()).status).toBe(503);
  });

  it("allows ordinary members to read settings", async () => {
    discord.permissions = "0";
    const { GET } = await import("../app/api/settings/route");
    expect((await GET()).status).toBe(200);
  });

  it("denies GET to non-members", async () => {
    discord.memberStatus = 404;
    const { GET } = await import("../app/api/settings/route");
    expect((await GET()).status).toBe(403);
  });
});

const FIXTURE_KEYS = ["member"] as const;
