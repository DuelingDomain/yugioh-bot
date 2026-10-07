import { fixtureUserId, fixtureDiscordId, seedFixtureUsers } from "./fixtures/identity";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { migrate } from "@yugidraft/shared/db";
import { createTournamentService } from "@yugidraft/shared/services";

const auth = vi.fn();
const callDuelHost = vi.fn();
const linkDraftDeck = vi.fn();
vi.mock("@/lib/session-identity", async () => {
  const { sessionFixture } = await import("./fixtures/session");
  return sessionFixture(auth);
});
vi.mock("@/lib/duel-host", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/duel-host")>()),
  callDuelHost,
}));
vi.mock("@/lib/draft-decks", () => ({ linkDraftDeck, backfillDraftDecks: vi.fn(), draftDeckNoteFor: vi.fn() }));
vi.mock("@/lib/notify", () => ({
  broadcaster: { draft: vi.fn(), tournament: vi.fn() },
  announcer: { announce: vi.fn(async () => ({ ok: true as const })) },
}));
vi.mock("@/lib/notify-duel", () => ({ notifyDuelChange: vi.fn(async () => {}) }));

const tempDirs: string[] = [];
const CATALOG = { main: [1001, 1002, 1003], extra: [], side: [] };
const MAPPED = { main: [2001, 2002, 2003], extra: [], side: [] };

function seed(opts: { status?: "active" | "pending" } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "tdraft-start-"));
  tempDirs.push(dir);
  process.env.DATABASE_PATH = join(dir, "bot.sqlite");
  process.env.DISCORD_GUILD_ID = "g1";
  process.env.DISCORD_TOKEN = "bot-token";
  process.env.NEXTAUTH_URL = "https://duel.example.com/";
  const db = new Database(process.env.DATABASE_PATH);
  migrate(db);
  seedFixtureUsers(db, FIXTURE_KEYS);
  const insert = db.prepare("insert into players (guild_id, user_id, discord_user_id, display_name) values ('g1', ?, ?, ?)");
  const a = Number(insert.run(fixtureUserId("u-a"), fixtureDiscordId("u-a"), "Alice").lastInsertRowid);
  const b = Number(insert.run(fixtureUserId("u-b"), fixtureDiscordId("u-b"), "Bob").lastInsertRowid);
  insert.run(fixtureUserId("u-x"), fixtureDiscordId("u-x"), "Outsider");
  insert.run(fixtureUserId("u-org"), fixtureDiscordId("u-org"), "Organizer");
  const tournaments = createTournamentService(db);
  const tour = tournaments.create("g1", "Cube cup", "round_robin", fixtureUserId("u-org"));
  db.prepare("update tournaments set web_slug = 'cup' where id = ?").run(tour.id);
  db.prepare(
    `insert into drafts (guild_id, channel_id, name, status, created_by_user_id, config_json, web_slug, tournament_id) values ('g1', 'c', 'Cube', 'completed', ${fixtureUserId("u-org")}, '{}', 'cube-1', ?)`,
  ).run(tour.id);
  tournaments.join(tour.id, a);
  tournaments.join(tour.id, b);
  if ((opts.status ?? "active") === "active") tournaments.start(tour.id);
  db.prepare("update tournament_participants set deck_json = ?, deck_registered_at = '2026-10-03 10:00:00' where tournament_id = ?")
    .run(JSON.stringify(CATALOG), tour.id);
  const slot = db.prepare("select id from tournament_matches where tournament_id = ? order by id limit 1").get(tour.id) as { id: number } | undefined;
  return { db, a, b, tournamentId: tour.id, tmId: slot?.id ?? 0 };
}

const ctx = (tmId: number) => ({ params: Promise.resolve({ slug: "cup", tmId: String(tmId) }) });
const post = () => new Request("http://localhost/x", { method: "POST", body: "{}" });
const count = (db: Database.Database, table: string) => (db.prepare(`select count(*) n from ${table}`).get() as { n: number }).n;
const locked = (db: Database.Database) =>
  (db.prepare("select count(*) n from tournament_participants where deck_locked_at is not null").get() as { n: number }).n;

describe("starting a draft tournament series", () => {
  beforeEach(() => {
    vi.resetModules();
    for (const mock of [auth, callDuelHost, linkDraftDeck]) mock.mockReset();
    auth.mockResolvedValue({ user: { id: String(fixtureUserId("u-a")), discordUserId: fixtureDiscordId("u-a"), name: "Alice" } });
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

  it("links both players' draft decks, maps them and starts the series", async () => {
    const s = seed();
    callDuelHost.mockResolvedValue({ ok: true, data: { deck: MAPPED, report: { issues: [] } } });
    const { POST } = await import("../app/api/tournaments/[slug]/matches/[tmId]/duel/route");
    const res = await POST(post(), ctx(s.tmId));
    expect(res.status).toBe(201);
    expect(linkDraftDeck).toHaveBeenCalledWith(s.tournamentId, s.a, expect.anything());
    expect(linkDraftDeck).toHaveBeenCalledWith(s.tournamentId, s.b, expect.anything());
    const series = s.db.prepare("select deck0_json, deck1_json from duel_series").get() as { deck0_json: string; deck1_json: string };
    expect(JSON.parse(series.deck0_json)).toEqual(MAPPED);
    expect(JSON.parse(series.deck1_json)).toEqual(MAPPED);
    expect(locked(s.db)).toBe(2);
  });

  it("answers 503 and starts nothing when the duel host is down", async () => {
    const s = seed();
    callDuelHost.mockResolvedValue({ ok: false, response: new Response(null, { status: 503 }) });
    const { POST } = await import("../app/api/tournaments/[slug]/matches/[tmId]/duel/route");
    const res = await POST(post(), ctx(s.tmId));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "Duel engine unavailable, try again" });
    expect(count(s.db, "duel_series")).toBe(0);
    expect(locked(s.db)).toBe(0);
    // The player can try again once the host is back.
    callDuelHost.mockResolvedValue({ ok: true, data: { deck: MAPPED, report: { issues: [] } } });
    expect((await POST(post(), ctx(s.tmId))).status).toBe(201);
  });

  it("answers 400 with the report and starts nothing when a deck has issues", async () => {
    const s = seed();
    const report = { issues: [{ code: "unknown-card" }] };
    callDuelHost.mockResolvedValue({ ok: true, data: { deck: MAPPED, report } });
    const { POST } = await import("../app/api/tournaments/[slug]/matches/[tmId]/duel/route");
    const res = await POST(post(), ctx(s.tmId));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { report: unknown }).report).toEqual(report);
    expect(count(s.db, "duel_series")).toBe(0);
    expect(locked(s.db)).toBe(0);
  });

  it("checks who may start before it links or maps any deck", async () => {
    const s = seed();
    const { POST } = await import("../app/api/tournaments/[slug]/matches/[tmId]/duel/route");
    auth.mockResolvedValue({ user: { id: String(fixtureUserId("u-x")), discordUserId: fixtureDiscordId("u-x"), name: "Outsider" } });
    expect((await POST(post(), ctx(s.tmId))).status).toBe(403);
    expect(linkDraftDeck).not.toHaveBeenCalled();
    expect(callDuelHost).not.toHaveBeenCalled();
    // The organizer may start it.
    callDuelHost.mockResolvedValue({ ok: true, data: { deck: MAPPED, report: { issues: [] } } });
    auth.mockResolvedValue({ user: { id: String(fixtureUserId("u-org")), discordUserId: fixtureDiscordId("u-org"), name: "Organizer" } });
    const res = await POST(post(), ctx(s.tmId));
    expect(res.status).toBe(201);
  });

  it("does not touch the decks of a tournament that has not started", async () => {
    const s = seed({ status: "pending" });
    const { POST } = await import("../app/api/tournaments/[slug]/matches/[tmId]/duel/route");
    expect((await POST(post(), ctx(s.tmId))).status).toBe(404);
    expect(callDuelHost).not.toHaveBeenCalled();
    expect(linkDraftDeck).not.toHaveBeenCalled();
  });
});

const FIXTURE_KEYS = ["u-a", "u-b", "u-x", "u-org"] as const;

// Session resolution is mocked; authorization still runs through the real web boundary.
