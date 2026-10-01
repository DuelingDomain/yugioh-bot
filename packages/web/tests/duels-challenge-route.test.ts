import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { migrate } from "@yugidraft/shared/db";

const auth = vi.fn();
const announcer = { announce: vi.fn(async (..._args: unknown[]) => ({ ok: true as const })) };
vi.mock("@/lib/auth", () => ({ auth }));
vi.mock("@/lib/notify", () => ({ announcer, broadcaster: { draft: vi.fn(), tournament: vi.fn() } }));
vi.mock("@/lib/notify-duel", () => ({ notifyDuelChange: vi.fn(async () => {}) }));
const tempDirs: string[] = [];

function seed() {
  const dir = mkdtempSync(join(tmpdir(), "challenge-"));
  tempDirs.push(dir);
  process.env.DATABASE_PATH = join(dir, "bot.sqlite");
  process.env.DISCORD_GUILD_ID = "g1";
  process.env.DISCORD_TOKEN = "bot-token";
  process.env.NEXTAUTH_URL = "https://duel.example.com";
  const db = new Database(process.env.DATABASE_PATH);
  migrate(db);
  const insert = db.prepare("insert into players (guild_id, discord_user_id, display_name) values ('g1', ?, ?)");
  const me = Number(insert.run("u-me", "Yugi").lastInsertRowid);
  const opponent = Number(insert.run("u-opp", "Kaiba").lastInsertRowid);
  return { db, me, opponent };
}

const post = (body: unknown) =>
  new Request("http://localhost/api/duels", { method: "POST", body: JSON.stringify(body) });

describe("POST /api/duels challenges", () => {
  beforeEach(() => {
    vi.resetModules();
    auth.mockReset();
    announcer.announce.mockClear();
    auth.mockResolvedValue({ user: { id: "u-me", name: "Yugi" } });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 200 })));
  });
  afterEach(() => {
    for (const key of ["DATABASE_PATH", "DISCORD_GUILD_ID", "DISCORD_TOKEN", "NEXTAUTH_URL"]) delete process.env[key];
    vi.unstubAllGlobals();
    while (tempDirs.length) {
      const d = tempDirs.pop();
      if (d) rmSync(d, { recursive: true, force: true });
    }
  });

  it("creates a challenge series and DMs the opponent", async () => {
    const s = seed();
    const { POST } = await import("../app/api/duels/route");
    const res = await POST(post({ mode: "normal", bestOf: 3, ranked: true, opponentPlayerId: s.opponent }) as never);
    expect(res.status).toBe(201);
    const body = (await res.json()) as { session: { slug: string }; series: { bestOf: number; ranked: boolean } };
    expect(body.series).toMatchObject({ bestOf: 3, ranked: true });

    await vi.waitFor(() => expect(announcer.announce).toHaveBeenCalledTimes(1));
    expect(announcer.announce.mock.calls[0][0]).toMatchObject({
      kind: "duel-invite",
      guildId: "g1",
      opponentDiscordUserId: "u-opp",
      challengerName: "Yugi",
      bestOf: 3,
      ranked: true,
      tournamentName: null,
      url: `https://duel.example.com/duels/${body.session.slug}`,
    });
  });

  it("reports notified true when the bot accepted the invite", async () => {
    const s = seed();
    const { POST } = await import("../app/api/duels/route");
    const res = await POST(post({ mode: "normal", opponentPlayerId: s.opponent }) as never);
    expect(res.status).toBe(201);
    expect(((await res.json()) as { notified: boolean }).notified).toBe(true);
  });

  it("reports notified false when the bot refuses or cannot be reached", async () => {
    const s = seed();
    const { POST } = await import("../app/api/duels/route");
    announcer.announce.mockResolvedValueOnce({ ok: false, error: "bot down" } as never);
    const refused = await POST(post({ mode: "normal", opponentPlayerId: s.opponent }) as never);
    expect(refused.status).toBe(201);
    expect(((await refused.json()) as { notified: boolean }).notified).toBe(false);

    announcer.announce.mockRejectedValueOnce(new Error("network"));
    const down = await POST(post({ mode: "normal", opponentPlayerId: s.opponent }) as never);
    expect(down.status).toBe(201);
    expect(((await down.json()) as { notified: boolean }).notified).toBe(false);
  });

  it("keeps the match options on an open table and makes no series for it", async () => {
    seed();
    const { POST } = await import("../app/api/duels/route");
    const res = await POST(post({ name: "Open", mode: "normal", bestOf: 3, ranked: true }) as never);
    expect(res.status).toBe(201);
    const body = (await res.json()) as { session: { bestOf: number; ranked: boolean; seriesId: number | null }; series?: unknown; notified?: unknown };
    expect(body.session).toMatchObject({ bestOf: 3, ranked: true, seriesId: null });
    expect(body.series).toBeUndefined();
    expect(body.notified).toBeUndefined();
  });

  it("creates an open table without an announce", async () => {
    seed();
    const { POST } = await import("../app/api/duels/route");
    const res = await POST(post({ name: "Open table", mode: "normal" }) as never);
    expect(res.status).toBe(201);
    expect(((await res.json()) as { series?: unknown }).series).toBeUndefined();
    expect(announcer.announce).not.toHaveBeenCalled();
  });

  it("rejects a bad best-of, a bad opponent and a self challenge", async () => {
    const s = seed();
    const { POST } = await import("../app/api/duels/route");
    expect((await POST(post({ mode: "normal", bestOf: 5 }) as never)).status).toBe(400);
    expect((await POST(post({ mode: "normal", ranked: "yes" }) as never)).status).toBe(400);
    expect((await POST(post({ mode: "normal", opponentPlayerId: "x" }) as never)).status).toBe(400);
    expect((await POST(post({ mode: "normal", opponentPlayerId: s.me }) as never)).status).toBe(400);
    expect(announcer.announce).not.toHaveBeenCalled();
  });

  it("returns the service error for an unknown opponent", async () => {
    seed();
    const { POST } = await import("../app/api/duels/route");
    const res = await POST(post({ mode: "normal", opponentPlayerId: 9999 }) as never);
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(announcer.announce).not.toHaveBeenCalled();
  });
});
