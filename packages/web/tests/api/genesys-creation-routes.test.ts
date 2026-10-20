import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import { migrate } from "@yugidraft/shared/db";
import { createDuelService, createTournamentDuelService } from "@yugidraft/shared/services";

const auth = vi.fn();
vi.mock("@/lib/auth", () => ({ auth }));
vi.mock("@/lib/discord-guild-membership", () => ({ verifyDiscordGuildMembership: async () => ({ ok: true }) }));
vi.mock("@/lib/discord-web-access", async original => ({
  ...await original<typeof import("@/lib/discord-web-access")>(),
  checkDiscordWebAccess: async () => ({ ok: true }),
}));
vi.mock("@/lib/notify-duel", () => ({ notifyDuelChange: vi.fn(async () => {}) }));
vi.mock("@/lib/notify", () => ({ broadcaster: { tournament: vi.fn() }, announcer: { announce: vi.fn(async () => ({ ok: true })) } }));

let db: Database.Database;
let directory: string;
let opponent: number;
beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("DISCORD_GUILD_ID", "g1");
  vi.stubEnv("DISCORD_BOT_ENABLED", "0");
  vi.stubEnv("MULTIPLAYER_TABLES", "1");
  vi.stubEnv("DUEL_INTERNAL_URL", "http://duel.test");
  vi.stubEnv("DUEL_INTERNAL_SECRET", "genesys-api-test");
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({
    multiplayerTables: true, multiCoreReady: true, multiDomainCoreReady: true,
  })));
  directory = mkdtempSync(join(tmpdir(), "genesys-api-"));
  vi.stubEnv("DATABASE_PATH", join(directory, "bot.sqlite"));
  db = new Database(process.env.DATABASE_PATH!);
  migrate(db);
  const insert = db.prepare("insert into players (guild_id, discord_user_id, display_name) values ('g1', ?, ?)");
  insert.run("host", "Host");
  opponent = Number(insert.run("opponent", "Opponent").lastInsertRowid);
  auth.mockResolvedValue({ user: { id: "host", name: "Host" } });
});
afterEach(() => { db.close(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); rmSync(directory, { recursive: true, force: true }); });
const request = (body: unknown, method = "POST") => new Request("http://localhost/api", { method, body: JSON.stringify(body) }) as NextRequest;
const modes = ["normal", "domain"] as const;
const formats = ["1v1", "tag", "ffa3", "ffa4"] as const;
const caps = [0, 100, 101, 1000] as const;

describe("Genesys creation API settings", () => {
  it.each(modes.flatMap(mode => formats.map(format => ({ mode, format }))))(
    "persists host-settable caps for $mode $format duels", async ({ mode, format }) => {
      const { POST } = await import("../../app/api/duels/route");
      for (const pointCap of caps) {
        const response = await POST(request({ name: `Cap ${pointCap}`, mode, format,
          settings: { genesys: { pointCap }, banlist: "tcg-2026-10-19" } }));
        expect(response.status).toBe(201);
        const body = await response.json();
        expect(body.session).toMatchObject({ mode, format, settings: { genesys: { pointCap }, banlist: "none" } });
        expect(createDuelService(db).get(body.session.slug, "g1").settings.genesys).toEqual({ pointCap });
      }
    });

  it.each(modes)("persists %s Genesys challenge series caps", async mode => {
    const { POST } = await import("../../app/api/duels/route");
    const response = await POST(request({ mode, opponentPlayerId: opponent, bestOf: 3,
      settings: { genesys: { pointCap: 101 } } }));
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ session: { settings: { genesys: { pointCap: 101 }, banlist: "none" } },
      series: { bestOf: 3 } });
    const row = db.prepare("select settings_json from duel_series").get() as { settings_json: string };
    expect(JSON.parse(row.settings_json).genesys).toEqual({ pointCap: 101 });
  });

  it.each(modes)("allows a %s Genesys tournament organizer to set and change the cap", async mode => {
    const { POST } = await import("../../app/api/tournaments/route");
    const created = await POST(request({ name: "Genesys Cup", format: "round_robin",
      duelRules: { mode, settings: { genesys: {}, banlist: "tcg-2026-10-19" } } }));
    expect(created.status).toBe(201);
    const tournament = await created.json();
    const tournaments = createTournamentDuelService(db);
    expect(tournaments.rules(tournament.id).settings).toMatchObject({ genesys: { pointCap: 100 }, banlist: "none" });
    const { PUT } = await import("../../app/api/tournaments/[slug]/route");
    for (const pointCap of caps) {
      const changed = await PUT(request({ duelRules: { settings: { genesys: { pointCap } } } }, "PUT"),
        { params: Promise.resolve({ slug: tournament.webSlug }) });
      expect(changed.status).toBe(200);
      expect(await changed.json()).toMatchObject({ duelRules: { mode, settings: { genesys: { pointCap }, banlist: "none" } } });
      expect(tournaments.rules(tournament.id).settings.genesys).toEqual({ pointCap });
    }
  });

  it.each([-1, 1001, 0.5, "100", null])("rejects invalid cap %j before storing duels, series or tournaments", async pointCap => {
    const { POST: duel } = await import("../../app/api/duels/route");
    const settings = { genesys: { pointCap } };
    for (const opponentPlayerId of [undefined, opponent]) {
      const response = await duel(request({ name: "Invalid", mode: "normal", opponentPlayerId, settings }));
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ error: expect.stringContaining("genesys.pointCap") });
    }
    const { POST: tournament } = await import("../../app/api/tournaments/route");
    const response = await tournament(request({ name: "Invalid", format: "round_robin", duelRules: { settings } }));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: expect.stringContaining("genesys.pointCap") });
    for (const table of ["duels", "duel_series", "tournaments"]) {
      expect(db.prepare(`select count(*) as count from ${table}`).get()).toEqual({ count: 0 });
    }
  });
});


describe("Genesys saved-deck API", () => {
  it("persists, preserves, changes and clears the tag through create/update", async () => {
    const { POST } = await import("../../app/api/decks/route");
    const { PUT } = await import("../../app/api/decks/[id]/route");
    const deck = { main: [], extra: [], side: [] };
    const created = await POST(request({ name: "Genesys library", mode: "normal", deck, genesys: { pointCap: 0 } }));
    expect(created.status).toBe(201);
    const saved = (await created.json()).deck;
    expect(saved.genesys).toEqual({ pointCap: 0 });
    const params = { params: Promise.resolve({ id: String(saved.id) }) };
    for (const [tag, expected] of [[undefined, { pointCap: 0 }], [{ pointCap: 1000 }, { pointCap: 1000 }], [null, null]] as const) {
      const updated = await PUT(request({ name: "Updated", mode: "normal", deck, ...(tag !== undefined ? { genesys: tag } : {}) }, "PUT"), params);
      expect(updated.status).toBe(200);
      expect((await updated.json()).deck.genesys).toEqual(expected);
    }
    const invalid = await PUT(request({ name: "Invalid", mode: "normal", deck, genesys: { pointCap: -1 } }, "PUT"), params);
    expect(invalid.status).toBe(400);
  });
});
