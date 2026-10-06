import { fixtureUserId, fixtureDiscordId, seedFixtureUsers } from "./fixtures/identity";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { migrate } from "@yugidraft/shared/db";
import { createDuelService } from "@yugidraft/shared/services";

const auth = vi.fn();
const notifyDuelChange = vi.fn(async (..._args: unknown[]) => {});
vi.mock("@/lib/auth", () => ({ auth }));
vi.mock("@/lib/notify-duel", () => ({ notifyDuelChange }));
const tempDirs: string[] = [];

function seed(botSeated = true) {
  const dir = mkdtempSync(join(tmpdir(), "duel-bot-route-"));
  tempDirs.push(dir);
  process.env.DATABASE_PATH = join(dir, "bot.sqlite");
  process.env.DISCORD_GUILD_ID = "g1";
  process.env.DISCORD_TOKEN = "bot-token";
  const db = new Database(process.env.DATABASE_PATH);
  migrate(db);
  seedFixtureUsers(db, FIXTURE_KEYS);
  const insert = db.prepare("insert into players (guild_id, user_id, discord_user_id, display_name) values ('g1', ?, ?, ?)");
  const host = Number(insert.run(fixtureUserId("u-host"), fixtureDiscordId("u-host"), "Yugi").lastInsertRowid);
  insert.run(fixtureUserId("u-other"), fixtureDiscordId("u-other"), "Kaiba");
  const duels = createDuelService(db);
  const session = duels.create({ guildId: "g1", organizerPlayerId: host, name: "Solo", mode: "normal" });
  if (botSeated) duels.addPracticeBot(session.slug, "g1", host, { main: Array.from({ length: 40 }, (_, i) => 9000 + i), extra: [], side: [] });
  return { db, duels, slug: session.slug };
}

const call = (slug: string) => [
  new Request(`http://localhost/api/duels/${slug}/bot`, { method: "DELETE" }),
  { params: Promise.resolve({ slug }) },
] as const;

describe("DELETE /api/duels/[slug]/bot", () => {
  beforeEach(() => {
    vi.resetModules();
    auth.mockReset();
    notifyDuelChange.mockClear();
    auth.mockResolvedValue({ user: { id: String(fixtureUserId("u-host")), discordUserId: fixtureDiscordId("u-host"), name: "Yugi" } });
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

  it("removes the bot for the organizer and notifies viewers", async () => {
    const s = seed();
    const { DELETE } = await import("../app/api/duels/[slug]/bot/route");
    const res = await DELETE(...call(s.slug));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { session: { seats: { isBot: boolean }[] } };
    expect(body.session.seats).toHaveLength(1);
    expect(s.duels.get(s.slug, "g1").seats.some((seat) => seat.isBot)).toBe(false);
    expect(notifyDuelChange).toHaveBeenCalledWith(s.slug, "g1");
  });

  it("refuses a player who is not the organizer and leaves the bot seated", async () => {
    const s = seed();
    auth.mockResolvedValue({ user: { id: String(fixtureUserId("u-other")), discordUserId: fixtureDiscordId("u-other"), name: "Kaiba" } });
    const { DELETE } = await import("../app/api/duels/[slug]/bot/route");
    const res = await DELETE(...call(s.slug));
    expect(res.status).toBe(403);
    expect(s.duels.get(s.slug, "g1").seats.some((seat) => seat.isBot)).toBe(true);
    expect(notifyDuelChange).not.toHaveBeenCalled();
  });

  it("answers 409 when no bot is seated", async () => {
    const s = seed(false);
    const { DELETE } = await import("../app/api/duels/[slug]/bot/route");
    const res = await DELETE(...call(s.slug));
    expect(res.status).toBe(409);
  });
});

const FIXTURE_KEYS = ["u-host", "u-other"] as const;

// Membership is a dependency of these routes; authorization still runs through the real web boundary.
vi.mock("@/lib/discord-guild-membership", () => ({ verifyDiscordGuildMembership: vi.fn(async () => ({ ok: true })) }));
