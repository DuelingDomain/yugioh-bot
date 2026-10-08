import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { migrate } from "@yugidraft/shared/db";
import { createDuelService, createDuelSeriesService, createLiveNowService, createTournamentService } from "@yugidraft/shared/services";
import { liveDuelSlugs } from "../src/components/player/live-duels";
import { fixtureUserId, seedFixtureUsers } from "./fixtures/identity";

const mocks = vi.hoisted(() => ({ db: null as Database.Database | null, post: vi.fn() }));
vi.mock("@/lib/db", () => ({ getDb: () => mocks.db }));
vi.mock("@/lib/env", () => ({ env: { discordGuildId: "g1", duelInternalUrl: "http://host", duelInternalSecret: "secret", wsInternalSecret: "ws-secret" } }));
vi.mock("@yugidraft/shared/notify", () => ({ httpTransport: () => ({ post: mocks.post }) }));
vi.mock("@/lib/web-access", () => ({ requireWebAccess: vi.fn() }));
vi.mock("@/lib/notify-duel", () => ({ notifyDuelChange: vi.fn() }));
vi.mock("@/lib/notify", () => ({ broadcaster: { tournament: vi.fn() } }));
import { callDuelHost } from "../src/lib/duel-host";
import { requireWebAccess } from "../src/lib/web-access";
import { POST as cancelSeries } from "../app/api/duels/series/[id]/cancel/route";
import { GET as connection } from "../app/api/duels/[slug]/connection/route";
import { GET as readRoom } from "../app/api/duels/[slug]/route";
import { POST as admitRoom } from "../app/api/duels/[slug]/invite/route";
import { verifyDuelConnectionToken } from "@yugidraft/shared/ws";

function setup() {
  const db = new Database(":memory:");
  migrate(db);
  seedFixtureUsers(db, ["owner", "a", "b", "stranger", "grant"]);
  const players = Object.fromEntries(["owner", "a", "b", "stranger", "grant"].map((key) => [key,
    Number(db.prepare("insert into players (guild_id, user_id, display_name) values ('g1', ?, ?)").run(fixtureUserId(key), key).lastInsertRowid),
  ]));
  const tournaments = createTournamentService(db);
  const tournament = tournaments.create("g1", "Secret Cup", "round_robin", fixtureUserId("owner"));
  db.prepare("update tournaments set web_slug = 'secret-cup' where id = ?").run(tournament.id);
  tournaments.join(tournament.id, players.a!);
  tournaments.join(tournament.id, players.b!);
  tournaments.start(tournament.id);
  db.prepare("update tournament_participants set deck_json = ? where tournament_id = ?").run(JSON.stringify({ main: [], extra: [], side: [] }), tournament.id);
  const slot = tournaments.openMatches(tournament.id)[0]!;
  const seriesService = createDuelSeriesService(db);
  const started = seriesService.startTournamentMatch({ guildId: "g1", tournamentMatchId: slot.id, actorPlayerId: players.a! });
  db.prepare("update duel_seats set ready = 1 where duel_id = ?").run(started.duel.id);
  mocks.db = db;
  return { db, players, tournament, started, seriesService, duels: createDuelService(db) };
}
let app: ReturnType<typeof setup>;
beforeEach(() => { mocks.post.mockReset(); app = setup(); });
afterEach(() => { app.db.close(); mocks.db = null; });

function expectHidden(payload: unknown) {
  const serialized = JSON.stringify(payload);
  expect(serialized).not.toContain("Secret Cup");
  expect(serialized).not.toContain("secret-cup");
}

describe("private tournament metadata in accessible duels", () => {
  it("redacts the web lobby room while retaining spectator access and unredacted internal data", async () => {
    vi.mocked(requireWebAccess).mockResolvedValue({ ok: true, userId: fixtureUserId("stranger"), userName: "stranger", discordUserId: null });
    const response = await readRoom(new Request("http://localhost/duel"), { params: Promise.resolve({ slug: app.started.duel.slug }) });
    expect(response.status).toBe(200);
    const room = await response.json();
    expect(room.role).toBe("spectator");
    expect(room.session.settings.visibility).toBe("public");
    expectHidden(room);
    expect(room.session.name).toBe("Duel");
    expect(room.series).toMatchObject({ tournamentId: null, tournamentSlug: null, tournamentMatchId: null });
    expect(room.session.seriesId).toBe(app.started.series.id);
    expect(app.duels.room(app.started.duel.slug, "g1", app.players.stranger!).series?.tournamentId).toBe(app.tournament.id);
  });

  it("hides live and archived all-scope discovery from strangers", () => {
    expectHidden(app.duels.list("g1", app.players.stranger!));
    expect(app.duels.list("g1", app.players.stranger!)).toHaveLength(0);
    app.duels.activate(app.started.duel.slug, "g1", null, ["seed"], "bundle", null);
    app.duels.complete(app.started.duel.slug, "g1", 0, "done");
    app.duels.archive(app.started.duel.slug, "g1", app.started.duel.organizerPlayerId);
    const history = app.duels.list("g1", app.players.stranger!, { archived: true, scope: "all" });
    expect(history).toHaveLength(0);
    expectHidden(history);
  });

  it.each(["owner", "a", "b", "grant"])("preserves metadata for the tournament reader %s", (key) => {
    app.db.prepare("insert into tournament_invite_grants (tournament_id, user_id) values (?, ?)").run(app.tournament.id, fixtureUserId("grant"));
    const room = app.duels.room(app.started.duel.slug, "g1", app.players[key]!);
    expect(room.session.name).toContain("Secret Cup");
    expect(room.series).toMatchObject({ tournamentId: app.tournament.id, tournamentSlug: "secret-cup", tournamentMatchId: app.started.series.tournamentMatchId });
  });

  it("preserves metadata for a stranger when the tournament is open", () => {
    app.db.prepare("update tournaments set visibility = 'open' where id = ?").run(app.tournament.id);
    expect(app.duels.room(app.started.duel.slug, "g1", app.players.stranger!).session.name).toContain("Secret Cup");
  });

  it("does not turn a duel invite grant into a tournament grant and redacts the admission response", async () => {
    app.db.prepare("update duels set settings_json = json_set(settings_json, '$.visibility', 'private'), invite_code = 'duel-invite' where id = ?").run(app.started.duel.id);
    expect(() => app.duels.room(app.started.duel.slug, "g1", app.players.stranger!)).toThrow("Duel is invite-only");
    vi.mocked(requireWebAccess).mockResolvedValue({ ok: true, userId: fixtureUserId("stranger"), userName: "stranger", discordUserId: null });
    const { NextRequest } = await import("next/server");
    const response = await admitRoom(new NextRequest("http://localhost/invite", { method: "POST", body: JSON.stringify({ inviteCode: "duel-invite" }) }), { params: Promise.resolve({ slug: app.started.duel.slug }) });
    expect(response.status).toBe(200);
    expectHidden(await response.json());
    expect(app.db.prepare("select count(*) as n from tournament_invite_grants").get()).toEqual({ n: 0 });
  });

  it.each(["view", "replay", "series-side", "series-ready", "series-unready", "series-first"] as const)("redacts raw nested host session and series payloads for %s", async (op) => {
    const raw = { session: app.started.duel, series: app.started.series, frames: [], nested: { session: app.started.duel }, nextSlug: app.started.duel.slug };
    mocks.post.mockResolvedValue({ ok: true, text: JSON.stringify(raw) });
    const result = await callDuelHost({ op, slug: app.started.duel.slug, guildId: "g1", playerId: app.players.stranger! });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("host failed");
    expectHidden(result.data);
    expect(result.data).toMatchObject({ session: { name: "Duel", seriesId: app.started.series.id }, series: { tournamentId: null, tournamentSlug: null, tournamentMatchId: null }, nested: { session: { name: "Duel" } }, nextSlug: app.started.duel.slug });
    expect(app.started.duel.name).toContain("Secret Cup");
  });

  it("keeps host metadata for a tournament reader", async () => {
    mocks.post.mockResolvedValue({ ok: true, text: JSON.stringify({ session: app.started.duel, series: app.started.series }) });
    const result = await callDuelHost({ op: "replay", slug: app.started.duel.slug, guildId: "g1", playerId: app.players.a! });
    expect(result).toEqual({ ok: true, data: { session: app.started.duel, series: app.started.series } });
  });

  it("live-now and player/leaderboard watch links omit private-tournament duels", () => {
    app.duels.activate(app.started.duel.slug, "g1", null, ["seed"], "bundle", null);
    const live = createLiveNowService(app.db).forPlayer("g1", app.players.stranger!);
    expect(live).toEqual({ yourDuel: null, liveCount: 0 });
    expectHidden(live);
    expect(liveDuelSlugs(app.db, "g1", app.players.stranger!)).toEqual({});
    expect(liveDuelSlugs(app.db, "g1", app.players.a!)).toEqual({ [app.players.a!]: app.started.duel.slug, [app.players.b!]: app.started.duel.slug });
  });

  it("does not classify metadata database errors as invalid engine JSON", async () => {
    mocks.post.mockResolvedValue({ ok: true, text: JSON.stringify({ series: app.started.series }) });
    vi.spyOn(app.db, "prepare").mockImplementation(() => { throw new Error("Database unavailable"); });
    await expect(callDuelHost({ op: "view", slug: app.started.duel.slug, guildId: "g1", playerId: app.players.stranger! })).rejects.toThrow("Database unavailable");
  });

  it("does not identify a private tournament in a stranger's series cancellation denial", async () => {
    vi.mocked(requireWebAccess).mockResolvedValue({ ok: true, userId: fixtureUserId("stranger"), userName: "stranger", discordUserId: null });
    const response = await cancelSeries(new Request("http://localhost/cancel", { method: "POST" }), { params: Promise.resolve({ id: String(app.started.series.id) }) });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Only a player of this match can cancel it" });
    expect(app.seriesService.get(app.started.series.id, "g1").status).toBe("active");
  });

  it("continues issuing a spectator connection token without tournament identifiers", async () => {
    vi.mocked(requireWebAccess).mockResolvedValue({ ok: true, userId: fixtureUserId("stranger"), userName: "stranger", discordUserId: null });
    const response = await connection(new Request("http://localhost/connection"), { params: Promise.resolve({ slug: app.started.duel.slug }) });
    expect(response.status).toBe(200);
    const payload = await response.json();
    const claims = verifyDuelConnectionToken(payload.token, "ws-secret");
    expect(claims).toMatchObject({ slug: app.started.duel.slug, playerId: app.players.stranger, seat: null });
    expect(claims).not.toHaveProperty("tournamentId");
    expectHidden(payload);
  });
});
