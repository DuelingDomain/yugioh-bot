import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { migrate } from "../../shared/src/db/schema";
import { createDuelService, createDuelSeriesService } from "@yugidraft/shared/services";

const state = vi.hoisted(() => ({ db: null as Database.Database | null, userId: 104 }));
vi.mock("@/lib/db", () => ({ getDb: () => state.db! }));
vi.mock("@/lib/env", () => ({ env: { discordGuildId: "g", discordBotEnabled: false } }));
vi.mock("@/lib/auth", () => ({ auth: async () => ({ user: { id: String(state.userId) } }) }));
vi.mock("@/lib/web-access", () => ({ requireWebAccess: async () => ({ ok: true, userId: state.userId, userName: "Viewer", discordUserId: null }) }));
vi.mock("@/lib/notify", () => ({ broadcaster: { tournament: vi.fn() }, announcer: { announce: vi.fn() } }));

beforeEach(() => {
  state.userId = 104; state.db = new Database(":memory:"); migrate(state.db);
  state.db.exec(`insert into users(id,username,display_name) values(101,'host','Host'),(102,'subject','Subject'),(103,'opponent','Opponent'),(104,'viewer','Viewer');
    insert into players(id,guild_id,user_id,display_name) values(1,'g',102,'Subject'),(2,'g',103,'Opponent');
    insert into tournaments(id,guild_id,name,format,status,created_by_user_id,web_slug) values(1,'g','Secret Cup','round_robin','active',101,'secret');
    insert into matches(id,guild_id,player_one_id,player_two_id,winner_id,reporter_id,status,source,tournament_id) values(1,'g',1,2,1,1,'pending','tournament',1);
    insert into seasons(id,guild_id,number,status) values(1,'g',1,'active');
    insert into point_awards(guild_id,season_id,player_id,kind,tournament_id,points) values('g',1,1,'placement',1,15);`);
});
afterEach(() => { state.db?.close(); vi.restoreAllMocks(); });

describe("match existence protection", () => {
  it.each(["approve", "deny"] as const)("%s returns an identical 404 for unreadable and absent matches", async op => {
    const route = op === "approve" ? await import("../app/api/matches/[id]/approve/route") : await import("../app/api/matches/[id]/deny/route");
    for (const id of ["1", "999"]) {
      const response = await route.POST(new Request("http://localhost/match", { method: "POST" }), { params: Promise.resolve({ id }) });
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: "Match not found" });
    }
  });
});

it("profile API uses the signed-in application identity, including grants without player rows", async () => {
  const { GET } = await import("../app/api/player/[id]/route");
  const read = async () => (await GET(new Request("http://localhost/api/player/1"), { params: Promise.resolve({ id: "1" }) })).json();
  expect((await read()).recent).toEqual([expect.objectContaining({ points: 15, tournament_id: null, tournament_name: null })]);
  state.db!.exec("insert into tournament_invite_grants(tournament_id,user_id) values(1,104)");
  expect((await read()).recent).toEqual([expect.objectContaining({ points: 15, tournament_id: 1, tournament_name: "Secret Cup" })]);
});

it("dashboard API excludes unrelated open tournaments for a viewer without a player", async () => {
  state.db!.exec(`insert into tournaments(id,guild_id,name,format,status,created_by_user_id,web_slug,visibility) values
    (2,'g','Unrelated','round_robin','pending',101,'open','open'),
    (3,'g','Created','round_robin','pending',104,'created','private'),
    (4,'g','Granted','round_robin','pending',101,'granted','private');
    insert into tournament_invite_grants(tournament_id,user_id) values(4,104);`);
  const { GET } = await import("../app/api/dashboard/route");
  const response = await GET();
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.tournaments.map((t: { name: string }) => t.name)).toEqual(["Granted", "Created"]);
  expect(body.drafts).toEqual([]);
  expect(body.stats).toEqual({ wins: 0, losses: 0 });
});

it("open-now applies application-user grants even before a player row exists", async () => {
  const db = state.db!;
  db.exec(`insert into tournament_participants(tournament_id,player_id,deck_json) values(1,1,'{"main":[],"extra":[],"side":[]}'),(1,2,'{"main":[],"extra":[],"side":[]}');
    insert into tournament_matches(id,tournament_id,player_one_id,player_two_id,round_number,status) values(1,1,1,2,1,'open');`);
  const started = createDuelSeriesService(db).startTournamentMatch({ guildId: "g", tournamentMatchId: 1, actorPlayerId: 1 });
  db.prepare("update duel_seats set ready=1 where duel_id=?").run(started.duel.id);
  createDuelService(db).activate(started.duel.slug, "g", null, ["seed"], "bundle", null);
  const { GET } = await import("../app/api/lobby/open/route");
  expect((await (await GET()).json()).duelsInProgress).toBe(0);
  db.exec("insert into tournament_invite_grants(tournament_id,user_id) values(1,104)");
  expect((await (await GET()).json()).duelsInProgress).toBe(1);
  expect(db.prepare("select id from players where user_id=104").get()).toBeUndefined();
});
