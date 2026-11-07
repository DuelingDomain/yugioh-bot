import { fixtureUserId, fixtureDiscordId, seedFixtureUsers } from "./fixtures/identity";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { migrate } from "@yugidraft/shared/db";
import { createTournamentService } from "@yugidraft/shared/services";

const auth = vi.fn();
const announcer = { announce: vi.fn(async (..._args: unknown[]) => ({ ok: true as const })) };
const broadcaster = { draft: vi.fn(), tournament: vi.fn() };
vi.mock("@/lib/session-identity", async () => {
  const { sessionFixture } = await import("./fixtures/session");
  return sessionFixture(auth);
});
vi.mock("@/lib/notify", () => ({ announcer, broadcaster }));
const notifyDuelChange = vi.fn(async (_slug: string, _guildId: string) => {});
vi.mock("@/lib/notify-duel", () => ({ notifyDuelChange }));
const tempDirs: string[] = [];

function seed() {
  const dir = mkdtempSync(join(tmpdir(), "tduel-"));
  tempDirs.push(dir);
  process.env.DATABASE_PATH = join(dir, "bot.sqlite");
  process.env.DISCORD_GUILD_ID = "g1";
  process.env.DISCORD_TOKEN = "bot-token";
  process.env.WEB_URL = "https://duel.example.com/";
  const db = new Database(process.env.DATABASE_PATH);
  migrate(db);
  seedFixtureUsers(db, FIXTURE_KEYS);
  const insert = db.prepare("insert into players (guild_id, user_id, discord_user_id, display_name) values ('g1', ?, ?, ?)");
  const organizer = Number(insert.run(fixtureUserId("u-org"), fixtureDiscordId("u-org"), "Organizer").lastInsertRowid);
  const a = Number(insert.run(fixtureUserId("u-a"), fixtureDiscordId("u-a"), "Alice").lastInsertRowid);
  const b = Number(insert.run(fixtureUserId("u-b"), fixtureDiscordId("u-b"), "Bob").lastInsertRowid);
  const tournaments = createTournamentService(db);
  const tour = tournaments.create("g1", "Online Cup", "round_robin", fixtureUserId("u-org"));
  db.prepare("update tournaments set web_slug = 'cup' where id = ?").run(tour.id);
  tournaments.join(tour.id, a);
  tournaments.join(tour.id, b);
  tournaments.start(tour.id);
  // Both players registered a deck, so a series can start.
  const deckJson = JSON.stringify({ main: [], extra: [], side: [] });
  db.prepare("update tournament_participants set deck_json = ? where tournament_id = ?").run(deckJson, tour.id);
  const slot = db.prepare("select id from tournament_matches where tournament_id = ? order by id limit 1").get(tour.id) as { id: number };
  return { db, organizer, a, b, tournamentId: tour.id, tmId: slot.id };
}

const ctx = (tmId: number) => ({ params: Promise.resolve({ slug: "cup", tmId: String(tmId) }) });
const post = (body: unknown) =>
  new Request("http://localhost/x", { method: "POST", body: JSON.stringify(body) });

describe("tournament match duel and result routes", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("DISCORD_BOT_ENABLED", "1");
    auth.mockReset();
    announcer.announce.mockClear();
    broadcaster.tournament.mockClear();
    notifyDuelChange.mockClear();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 200 })));
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    for (const key of ["DATABASE_PATH", "DISCORD_GUILD_ID", "DISCORD_TOKEN", "WEB_URL"]) delete process.env[key];
    vi.unstubAllGlobals();
    while (tempDirs.length) {
      const d = tempDirs.pop();
      if (d) rmSync(d, { recursive: true, force: true });
    }
  });

  it("remote: paired players start one private reserved table with tournament rules and no registered deck", async () => {
    const s = seed();
    vi.stubEnv("REMOTE_DUELS", "1");
    vi.stubEnv("REMOTE_DUELS_USERS", "*");
    s.db.prepare("update tournaments set duel_type='remote', best_of=1, duel_rules_json=? where id=?")
      .run(JSON.stringify({ mode: "normal", masterRule: 5, settings: { startingLP: 4000 } }), s.tournamentId);
    s.db.prepare("update tournament_participants set deck_json=null where tournament_id=?").run(s.tournamentId);
    const { POST } = await import("../app/api/tournaments/[slug]/matches/[tmId]/remote/route");
    const { GET: getResult } = await import("../app/api/tournaments/[slug]/matches/[tmId]/remote-result/route");
    const { POST: seat } = await import("../app/api/remote/[slug]/seat/route");
    const { createRemoteDuelService } = await import("@yugidraft/shared/services");
    const remote = createRemoteDuelService(s.db);
    const as = (key: typeof FIXTURE_KEYS[number]) => auth.mockResolvedValue({ user: { id: String(fixtureUserId(key)), discordUserId: fixtureDiscordId(key), name: key } });
    as("u-org");
    expect((await POST(post({}), ctx(s.tmId))).status).toBe(403);
    as("u-a");
    const serverNow = Date.now();
    const clock = vi.spyOn(Date, "now").mockReturnValue(serverNow);
    try {
      const empty = await getResult(new Request("http://localhost/x"), ctx(s.tmId));
      expect(empty.status).toBe(200);
      expect(empty.headers.get("cache-control")).toBe("private, no-store");
      expect(await empty.json()).toEqual({ remoteResult: null, now: serverNow });
    } finally { clock.mockRestore(); }
    expect((await POST(post({}), ctx(s.tmId + 999))).status).toBe(404);
    const first = await POST(post({}), ctx(s.tmId));
    expect(first.status).toBe(201);
    const body = await first.json();
    expect(body).toMatchObject({ created: true, table: { tournamentMatchId: s.tmId, seatCount: 2,
      bestOf: 1, status: "lobby", visibility: "private", detectionDefault: "auto", format: { id: "normal", settings: { startingLP: 4000 } } } });
    expect(body.table.state).toBeUndefined();
    expect(body.tableUrl).toBe(`/duels/remote/${body.table.slug}`);
    const playing = await getResult(new Request("http://localhost/x"), ctx(s.tmId));
    expect(await playing.json()).toMatchObject({ now: expect.any(Number), remoteResult: {
      tournamentMatchId: s.tmId, tableSlug: body.table.slug, status: "playing",
      winnerPlayerId: null, organizerDecision: null, finalizationReason: null,
    } });
    const linked = s.db.prepare("select id,tournament_match_id from remote_tables where slug=?").get(body.table.slug) as { id: number; tournament_match_id: number };
    expect(linked.tournament_match_id).toBe(s.tmId);
    expect(s.db.prepare("select status,table_id from tournament_remote_matches where tournament_match_id=?").get(s.tmId))
      .toMatchObject({ status: "playing", table_id: linked.id });
    const seatCtx = { params: Promise.resolve({ slug: body.table.slug }) };
    as("u-org");
    expect((await seat(post({}), seatCtx)).status).toBe(403);
    // Reservation is also enforced in the shared service, not just the web handler.
    expect(() => remote.join(body.table.slug, "g1", fixtureUserId("u-x"), "Outsider")).toThrow(/paired players/i);
    as("u-b");
    const repeated = await POST(post({}), ctx(s.tmId));
    expect(repeated.status).toBe(200);
    expect(await repeated.json()).toMatchObject({ created: false, table: { slug: body.table.slug } });
    expect((await seat(post({ seat: 0 }), seatCtx)).status).toBe(409);
    const seated = await seat(post({ seat: 1 }), seatCtx);
    expect(seated.status).toBe(200);
    expect(await seated.json()).toMatchObject({ mySeat: 1, seats: [{ userId: fixtureUserId("u-a") }, { userId: fixtureUserId("u-b") }] });
    expect(() => remote.configure(body.table.slug, "g1", fixtureUserId("u-a"), { bestOf: 3 })).toThrow(/rules/i);
    expect(() => remote.spectate(body.table.slug, "g1", fixtureUserId("u-org"))).toThrow(/private/i);
    vi.stubEnv("REMOTE_DUELS_USERS", String(fixtureUserId("u-a")));
    as("u-a");
    expect((await POST(post({}), ctx(s.tmId))).status).toBe(409);
    vi.stubEnv("REMOTE_DUELS_USERS", "*");
    vi.stubEnv("REMOTE_DUELS", "0");
    expect((await POST(post({}), ctx(s.tmId))).status).toBe(404);
    vi.stubEnv("REMOTE_DUELS", "1");
    // The online service must not provide a second start path for Remote pairings.
    const { createDuelSeriesService } = await import("@yugidraft/shared/services");
    expect(() => createDuelSeriesService(s.db).startTournamentMatch({ guildId: "g1", tournamentMatchId: s.tmId, actorPlayerId: s.a })).toThrow(/Remote/i);
    remote.leave(body.table.slug, "g1", fixtureUserId("u-a"));
    // Either paired player can create the replacement and becomes seat 0.
    as("u-b");
    const replay = await POST(post({}), ctx(s.tmId));
    expect(replay.status).toBe(201);
    const next = await replay.json();
    expect(next.table.slug).not.toBe(body.table.slug);
    expect(next.table.seats[0].userId).toBe(fixtureUserId("u-b"));
    expect(() => s.db.prepare("update remote_tables set status='active' where id=?").run(linked.id)).toThrow(/UNIQUE/i);
    remote.leave(next.table.slug, "g1", fixtureUserId("u-b"));
    // An outstanding proposal cannot be bypassed by creating another room.
    s.db.prepare("update tournament_remote_matches set status='proposed' where tournament_match_id=?").run(s.tmId);
    expect((await POST(post({}), ctx(s.tmId))).status).toBe(409);
    s.db.close();
  });

  it.each(["lobby", "active", "proposed", "disputed", "purged-proposal"])("report: blocks manual reports for a Remote %s slot", async status => {
    const s = seed();
    try {
      vi.stubEnv("REMOTE_DUELS", "1");
      vi.stubEnv("REMOTE_DUELS_USERS", "*");
      s.db.prepare("update tournaments set duel_type='remote' where id=?").run(s.tournamentId);
      const {createTournamentRemoteService,createRemoteDuelService} = await import("@yugidraft/shared/services");
      const {table} = createTournamentRemoteService(s.db).startMatch({guildId:"g1",tournamentId:s.tournamentId,
        tournamentMatchId:s.tmId,actorUserId:fixtureUserId("u-a")});
      const remote=createRemoteDuelService(s.db);
      if (status === "active") {
        remote.join(table.slug,"g1",fixtureUserId("u-b"),"Bob");
        remote.ready(table.slug,"g1",fixtureUserId("u-a"),true);
        remote.ready(table.slug,"g1",fixtureUserId("u-b"),true);
        remote.start(table.slug,"g1",fixtureUserId("u-a"));
      } else if (status !== "lobby") {
        remote.leave(table.slug,"g1",fixtureUserId("u-a"));
        s.db.prepare("update tournament_remote_matches set status=? where tournament_match_id=?")
          .run(status === "disputed" ? "disputed" : "proposed",s.tmId);
        if (status === "purged-proposal") s.db.prepare("delete from remote_tables where slug=?").run(table.slug);
      }
      const {POST} = await import("../app/api/tournaments/[slug]/report/route");
      auth.mockResolvedValue({user:{id:String(fixtureUserId("u-a")),discordUserId:fixtureDiscordId("u-a"),name:"Alice"}});
      const response=await POST(post({tournamentMatchId:s.tmId,result:"win"}),{params:Promise.resolve({slug:"cup"})});
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({code:"REMOTE_MATCH_OPEN",error:expect.stringMatching(/open Remote table or result/)});
      expect(s.db.prepare("select count(*) n from matches").get()).toEqual({n:0});
      expect(s.db.prepare("select status,match_id from tournament_matches where id=?").get(s.tmId))
        .toEqual({status:"open",match_id:null});
      expect(announcer.announce).not.toHaveBeenCalled();
      expect(broadcaster.tournament).not.toHaveBeenCalled();
    } finally {s.db.close();}
  });

  it("report: returns a conflict if an online series starts after the precheck", async () => {
    const s = seed();
    const services = await import("@yugidraft/shared/services");
    const errorResponse = vi.spyOn(await import("@yugidraft/shared/observability"), "errorResponseBody");
    const create = services.createTournamentService;
    const raced = vi.spyOn(services, "createTournamentService").mockImplementation(db => {
      services.createDuelSeriesService(s.db).startTournamentMatch({
        guildId: "g1", tournamentMatchId: s.tmId, actorPlayerId: s.a,
      });
      return create(db);
    });
    try {
      const { POST } = await import("../app/api/tournaments/[slug]/report/route");
      auth.mockResolvedValue({ user: { id: String(fixtureUserId("u-a")), discordUserId: fixtureDiscordId("u-a"), name: "Alice" } });
      const response = await POST(post({ tournamentMatchId: s.tmId, result: "win" }), { params: Promise.resolve({ slug: "cup" }) });
      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({ error: "This match is being played as an online duel series. The result records itself." });
      expect(errorResponse).not.toHaveBeenCalled();
      expect(s.db.prepare("select count(*) n from matches").get()).toEqual({ n: 0 });
      expect(announcer.announce).not.toHaveBeenCalled();
    } finally { raced.mockRestore(); errorResponse.mockRestore(); s.db.close(); }
  });

  it("report: allows a Remote fallback after a table ends without a result", async () => {
    const s = seed();
    try {
      vi.stubEnv("REMOTE_DUELS", "1");
      vi.stubEnv("REMOTE_DUELS_USERS", "*");
      s.db.prepare("update tournaments set duel_type='remote' where id=?").run(s.tournamentId);
      const {createTournamentRemoteService,createRemoteDuelService} = await import("@yugidraft/shared/services");
      const {table}=createTournamentRemoteService(s.db).startMatch({guildId:"g1",tournamentId:s.tournamentId,
        tournamentMatchId:s.tmId,actorUserId:fixtureUserId("u-a")});
      createRemoteDuelService(s.db).leave(table.slug,"g1",fixtureUserId("u-a"));
      const {POST} = await import("../app/api/tournaments/[slug]/report/route");
      auth.mockResolvedValue({user:{id:String(fixtureUserId("u-a")),discordUserId:fixtureDiscordId("u-a"),name:"Alice"}});
      const response=await POST(post({tournamentMatchId:s.tmId,result:"win"}),{params:Promise.resolve({slug:"cup"})});
      expect(response.status).toBe(200);
      expect(s.db.prepare("select status from tournament_matches where id=?").get(s.tmId)).toEqual({status:"pending_approval"});
    } finally {s.db.close();}
  });

  it.each(["lobby", "disputed"])("result: organizer rulings resolve a Remote %s slot and stop its table", async status => {
    const s = seed();
    try {
      vi.stubEnv("REMOTE_DUELS", "1");
      vi.stubEnv("REMOTE_DUELS_USERS", "*");
      s.db.prepare("update tournaments set duel_type='remote' where id=?").run(s.tournamentId);
      const {createTournamentRemoteService,createRemoteDuelService,createTournamentRemoteResultService} = await import("@yugidraft/shared/services");
      const {table}=createTournamentRemoteService(s.db).startMatch({guildId:"g1",tournamentId:s.tournamentId,
        tournamentMatchId:s.tmId,actorUserId:fixtureUserId("u-a")});
      if (status === "disputed") s.db.prepare("update tournament_remote_matches set status='disputed' where tournament_match_id=?").run(s.tmId);
      const {POST} = await import("../app/api/tournaments/[slug]/matches/[tmId]/result/route");
      auth.mockResolvedValue({user:{id:String(fixtureUserId("u-org")),discordUserId:fixtureDiscordId("u-org"),name:"Organizer"}});
      expect((await POST(post({winnerPlayerId:s.b}),ctx(s.tmId))).status).toBe(200);
      expect(s.db.prepare("select status from remote_tables where slug=?").get(table.slug)).toEqual({status:"ended"});
      expect(s.db.prepare("select status,winner_player_id,finalization_reason from tournament_remote_matches where tournament_match_id=?").get(s.tmId))
        .toEqual({status:"final",winner_player_id:s.b,finalization_reason:"organizer"});
      expect(()=>createRemoteDuelService(s.db).start(table.slug,"g1",fixtureUserId("u-a"))).toThrow();
      expect(createTournamentRemoteResultService(s.db).finalizeDue(Date.now()+7200001)).toEqual([]);
      expect(s.db.prepare("select count(*) n from matches").get()).toEqual({n:1});
    } finally {s.db.close();}

  });
  it("remote evidence: only the organizer or an admin can read a guild-scoped match copy", async () => {
    const s = seed();
    try {
      vi.stubEnv("OWNER_USER_IDS", String(fixtureUserId("u-x")));
      const { GET } = await import("../app/api/tournaments/[slug]/matches/[tmId]/remote-evidence/route");
      const as = (key: typeof FIXTURE_KEYS[number]) => auth.mockResolvedValue({ user: {
        id: String(fixtureUserId(key)), discordUserId: fixtureDiscordId(key), name: key,
      } });
      const get = (tmId = s.tmId) => GET(new Request("http://localhost/x"), ctx(tmId));
      auth.mockResolvedValue(null);
      expect((await get()).status).toBe(401);
      as("u-org");
      expect((await get()).status).toBe(404);
      s.db.prepare(`insert into tournament_remote_evidence(tournament_match_id,table_slug,
        player_one_user_id,player_two_user_id,players_json,table_ended_at,end_reason,
        games_json,result_events_json,final_lp_json,public_board_json,reports_json,
        detection_summary_json,captured_at,hard_delete_at)
        values(?,'deleted-table',?,?,'[]',1000,'concede','[]','[]','[]','[]','[]','[]',1001,9999999999999)`)
        .run(s.tmId, fixtureUserId("u-a"), fixtureUserId("u-b"));
      const evidence = s.db.prepare("select * from tournament_remote_evidence where tournament_match_id=?").get(s.tmId);
      const response = await get();
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(await response.json()).toEqual({ evidence });
      for (const key of ["u-a", "u-b"] as const) {
        as(key);
        expect((await get()).status).toBe(403);
      }
      as("u-x");
      vi.stubEnv("OWNER_USER_IDS", "");
      expect((await get()).status).toBe(404);
      s.db.prepare("update tournaments set visibility='open' where id=?").run(s.tournamentId);
      expect((await get()).status).toBe(403);
      vi.stubEnv("OWNER_USER_IDS", String(fixtureUserId("u-x")));
      s.db.prepare("update tournaments set visibility='private' where id=?").run(s.tournamentId);
      expect((await get()).status).toBe(200);
      expect((await get(s.tmId + 999)).status).toBe(404);
      expect((await GET(new Request("http://localhost/x"), { params: Promise.resolve({ slug: "cup", tmId: "bad" }) })).status).toBe(404);
      const other = createTournamentService(s.db).create("g1", "Other cup", "round_robin", fixtureUserId("u-org"));
      s.db.prepare("update tournaments set web_slug='other-cup' where id=?").run(other.id);
      expect((await GET(new Request("http://localhost/x"), { params: Promise.resolve({ slug: "other-cup", tmId: String(s.tmId) }) })).status).toBe(404);
      s.db.prepare("update tournaments set guild_id='g2' where id=?").run(s.tournamentId);
      expect((await get()).status).toBe(404);
    } finally {
      s.db.close();
    }
  });

  it("result: rejects an unauthenticated caller and a bad body", async () => {
    const s = seed();
    const { POST } = await import("../app/api/tournaments/[slug]/matches/[tmId]/result/route");
    auth.mockResolvedValue(null);
    expect((await POST(post({ winnerPlayerId: s.a }), ctx(s.tmId))).status).toBe(401);
    auth.mockResolvedValue({ user: { id: String(fixtureUserId("u-org")), discordUserId: fixtureDiscordId("u-org"), name: "Organizer" } });
    expect((await POST(post({}), ctx(s.tmId))).status).toBe(400);
    expect((await POST(post({ winnerPlayerId: s.a }), ctx(s.tmId + 999))).status).toBe(404);
  });

  it("result: only the organizer can set it", async () => {
    const s = seed();
    const { POST } = await import("../app/api/tournaments/[slug]/matches/[tmId]/result/route");
    auth.mockResolvedValue({ user: { id: String(fixtureUserId("u-a")), discordUserId: fixtureDiscordId("u-a"), name: "Alice" } });
    const res = await POST(post({ winnerPlayerId: s.a }), ctx(s.tmId));
    expect(res.status).toBe(403);
    expect(broadcaster.tournament).not.toHaveBeenCalled();
  });

  it.each(["online", "remote"])("result: the organizer sets a %s winner and the web is told", async duelType => {
    const s = seed();
    if (duelType === "remote") {
      vi.stubEnv("REMOTE_DUELS", "1");
      vi.stubEnv("REMOTE_DUELS_USERS", "*");
      s.db.prepare("update tournaments set duel_type='remote' where id=?").run(s.tournamentId);
      const { createTournamentRemoteService } = await import("@yugidraft/shared/services");
      createTournamentRemoteService(s.db).startMatch({ guildId: "g1", tournamentId: s.tournamentId,
        tournamentMatchId: s.tmId, actorUserId: fixtureUserId("u-a") });
      s.db.prepare("update tournament_remote_matches set status='disputed',winner_player_id=? where tournament_match_id=?")
        .run(s.b, s.tmId);
    }
    const { POST } = await import("../app/api/tournaments/[slug]/matches/[tmId]/result/route");
    auth.mockResolvedValue({ user: { id: String(fixtureUserId("u-org")), discordUserId: fixtureDiscordId("u-org"), name: "Organizer" } });
    const res = await POST(post({ winnerPlayerId: s.a }), ctx(s.tmId));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
    expect(broadcaster.tournament).toHaveBeenCalledWith({ kind: "match-updated", slug: "cup" });
    const slot = s.db.prepare("select status from tournament_matches where id = ?").get(s.tmId) as { status: string };
    expect(slot.status).toBe("completed");
    const match = s.db
      .prepare("select m.winner_id from matches m join tournament_matches t on t.match_id = m.id where t.id = ?")
      .get(s.tmId) as { winner_id: number };
    expect(match.winner_id).toBe(s.a);
    if (duelType === "remote") {
      const { GET } = await import("../app/api/tournaments/[slug]/matches/[tmId]/remote-result/route");
      const ruled = await GET(new Request("http://localhost/x"), ctx(s.tmId));
      expect(ruled.status).toBe(200);
      expect(await ruled.json()).toMatchObject({ now: expect.any(Number), remoteResult: {
        status: "final", winnerPlayerId: s.a, finalizationReason: "organizer",
        organizerDecision: { userId: fixtureUserId("u-org"), winnerPlayerId: s.a,
          void: false, note: null, at: expect.any(Number) },
      } });
      const { POST: voidResult } = await import("../app/api/tournaments/[slug]/matches/[tmId]/remote-result/void/route");
      expect((await voidResult(post({ note: "Replay required" }), ctx(s.tmId))).status).toBe(200);
      const voided = await GET(new Request("http://localhost/x"), ctx(s.tmId));
      expect(voided.status).toBe(200);
      expect(await voided.json()).toMatchObject({ now: expect.any(Number), remoteResult: {
        status: "void", winnerPlayerId: null, finalizationReason: null,
        organizerDecision: { userId: fixtureUserId("u-org"), winnerPlayerId: null,
          void: true, note: "Replay required", at: expect.any(Number) },
      } });
    }
    s.db.close();
  });

  it("duel: starts a series, DMs the other player once and returns the existing one after", async () => {
    const s = seed();
    const { POST } = await import("../app/api/tournaments/[slug]/matches/[tmId]/duel/route");
    auth.mockResolvedValue({ user: { id: String(fixtureUserId("u-a")), discordUserId: fixtureDiscordId("u-a"), name: "Alice" } });
    const first = await POST(post({}), ctx(s.tmId));
    expect(first.status).toBe(201);
    const body = (await first.json()) as { series: { bestOf: number }; duel: { slug: string }; created: boolean };
    expect(body.created).toBe(true);
    await vi.waitFor(() => expect(announcer.announce).toHaveBeenCalledTimes(1));
    expect(announcer.announce.mock.calls[0][0]).toMatchObject({
      kind: "duel-invite",
      guildId: "g1",
      opponentDiscordUserId: fixtureDiscordId("u-b"),
      challengerName: "Alice",
      tournamentName: "Online Cup",
      url: `https://duel.example.com/duels/${body.duel.slug}`,
    });
    expect(broadcaster.tournament).toHaveBeenCalledWith({ kind: "match-updated", slug: "cup" });

    const second = await POST(post({}), ctx(s.tmId));
    expect(second.status).toBe(200);
    expect(((await second.json()) as { created: boolean }).created).toBe(false);
    expect(announcer.announce).toHaveBeenCalledTimes(1);
  });

  it("duel: maps the decks of both seats before it starts the series", async () => {
    const s = seed();
    const mapDraftTournamentDecks = vi.fn(async (..._args: unknown[]) => ({ ok: true as const }));
    vi.doMock("@/lib/draft-deck-codes", () => ({ mapDraftTournamentDecks }));
    const { POST } = await import("../app/api/tournaments/[slug]/matches/[tmId]/duel/route");
    auth.mockResolvedValue({ user: { id: String(fixtureUserId("u-a")), discordUserId: fixtureDiscordId("u-a"), name: "Alice" } });
    const res = await POST(post({}), ctx(s.tmId));
    vi.doUnmock("@/lib/draft-deck-codes");
    expect(res.status).toBe(201);
    expect(mapDraftTournamentDecks).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ tournamentId: s.tournamentId, guildId: "g1", playerIds: expect.arrayContaining([s.a, s.b]) }),
    );
  });

  it("duel: an outsider cannot start the series", async () => {
    const s = seed();
    const { POST } = await import("../app/api/tournaments/[slug]/matches/[tmId]/duel/route");
    auth.mockResolvedValue({ user: { id: String(fixtureUserId("u-x")), discordUserId: fixtureDiscordId("u-x"), name: "Outsider" } });
    const res = await POST(post({}), ctx(s.tmId));
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(announcer.announce).not.toHaveBeenCalled();
  });
  async function startSeries(s: ReturnType<typeof seed>) {
    const { POST } = await import("../app/api/tournaments/[slug]/matches/[tmId]/duel/route");
    auth.mockResolvedValue({ user: { id: String(fixtureUserId("u-a")), discordUserId: fixtureDiscordId("u-a"), name: "Alice" } });
    const res = await POST(post({}), ctx(s.tmId));
    expect(res.status).toBe(201);
    const body = (await res.json()) as { series: { id: number }; duel: { slug: string } };
    notifyDuelChange.mockClear();
    broadcaster.tournament.mockClear();
    return body;
  }

  const seriesStatus = (s: ReturnType<typeof seed>, id: number) =>
    (s.db.prepare("select status from duel_series where id = ?").get(id) as { status: string }).status;

  it("DELETE: cancels the tournament, closes the open series and notifies each game", async () => {
    const s = seed();
    const started = await startSeries(s);
    const { DELETE } = await import("../app/api/tournaments/[slug]/route");
    auth.mockResolvedValue({ user: { id: String(fixtureUserId("u-org")), discordUserId: fixtureDiscordId("u-org"), name: "Organizer" } });
    const res = await DELETE(new Request("http://localhost/x", { method: "DELETE" }), { params: Promise.resolve({ slug: "cup" }) });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { status: string }).status).toBe("cancelled");
    expect(seriesStatus(s, started.series.id)).toBe("cancelled");
    expect(
      (s.db.prepare("select status, ended_at from tournaments where id = ?").get(s.tournamentId) as { status: string; ended_at: string | null }),
    ).toMatchObject({ status: "cancelled", ended_at: expect.any(String) });
    expect(broadcaster.tournament).toHaveBeenCalledWith({ kind: "cancelled", slug: "cup" });
    expect(notifyDuelChange.mock.calls).toEqual([[started.duel.slug, "g1"]]);
  });

  it("DELETE: a non-creator and a closed tournament change nothing", async () => {
    const s = seed();
    const started = await startSeries(s);
    const { DELETE } = await import("../app/api/tournaments/[slug]/route");
    const del = () => DELETE(new Request("http://localhost/x", { method: "DELETE" }), { params: Promise.resolve({ slug: "cup" }) });
    auth.mockResolvedValue({ user: { id: String(fixtureUserId("u-a")), discordUserId: fixtureDiscordId("u-a"), name: "Alice" } });
    expect((await del()).status).toBe(403);
    expect(seriesStatus(s, started.series.id)).not.toBe("cancelled");
    auth.mockResolvedValue({ user: { id: String(fixtureUserId("u-org")), discordUserId: fixtureDiscordId("u-org"), name: "Organizer" } });
    expect((await del()).status).toBe(200);
    notifyDuelChange.mockClear();
    expect((await del()).status).toBe(409);
    expect(notifyDuelChange).not.toHaveBeenCalled();
  });

  it("complete: ends the tournament, closes the open series and notifies each game", async () => {
    const s = seed();
    const started = await startSeries(s);
    const { POST } = await import("../app/api/tournaments/[slug]/complete/route");
    auth.mockResolvedValue({ user: { id: String(fixtureUserId("u-org")), discordUserId: fixtureDiscordId("u-org"), name: "Organizer" } });
    const res = await POST(new Request("http://localhost/x", { method: "POST" }), { params: Promise.resolve({ slug: "cup" }) });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { status: string }).status).toBe("completed");
    expect(seriesStatus(s, started.series.id)).toBe("cancelled");
    expect(broadcaster.tournament).toHaveBeenCalledWith({ kind: "completed", slug: "cup" });
    expect(notifyDuelChange.mock.calls).toEqual([[started.duel.slug, "g1"]]);
  });

  it("GET: rulesLocked turns true once a series exists", async () => {
    const s = seed();
    auth.mockResolvedValue({ user: { id: String(fixtureUserId("u-org")), discordUserId: fixtureDiscordId("u-org"), name: "Organizer" } });
    const { GET } = await import("../app/api/tournaments/[slug]/route");
    const get = async () =>
      ((await (await GET(new Request("http://localhost/x"), { params: Promise.resolve({ slug: "cup" }) })).json()) as { rulesLocked: boolean }).rulesLocked;
    expect(await get()).toBe(false);
    await startSeries(s);
    expect(await get()).toBe(true);
  });
});

const FIXTURE_KEYS = ["u-org", "u-a", "u-b", "u-x"] as const;

// Session resolution is mocked; authorization still runs through the real web boundary.
