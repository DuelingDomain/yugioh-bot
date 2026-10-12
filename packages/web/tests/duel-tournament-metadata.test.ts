import Database from "better-sqlite3";
import { afterEach, expect, it, vi } from "vitest";
import { migrate } from "@yugidraft/shared/db";
import { createDuelService, createDuelSeriesService, createTournamentService } from "@yugidraft/shared/services";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
const mocks = vi.hoisted(() => ({ actor: vi.fn(), host: vi.fn() }));
vi.mock("@/lib/duel-host", async original => ({
  ...await original<typeof import("../src/lib/duel-host")>(),
  requireDuelActor: mocks.actor, callDuelHost: mocks.host,
}));
import { GET } from "../app/api/duels/[slug]/route";

let db: Database.Database | undefined;
afterEach(() => { db?.close(); db = undefined; vi.clearAllMocks(); });

it("reads a tournament lobby for a spectator without requesting private deck checks from the host", async () => {
  db = new Database(":memory:");
  migrate(db);
  const addPlayer = (identity: string) => Number(db!.prepare(
    "insert into players(guild_id,discord_user_id,display_name) values ('fixture',?,?)",
  ).run(identity, identity).lastInsertRowid);
  const owner = addPlayer("fixture-owner");
  const opponent = addPlayer("fixture-opponent");
  const spectator = addPlayer("fixture-spectator");
  const tournaments = createTournamentService(db);
  const tournament = tournaments.create("fixture", "Fixture Cup", "round_robin", "fixture-owner");
  tournaments.join(tournament.id, owner);
  tournaments.join(tournament.id, opponent);
  tournaments.start(tournament.id);
  db.prepare("update tournament_participants set deck_json=? where tournament_id=?")
    .run(JSON.stringify({ main: [], extra: [], side: [] }), tournament.id);
  const match = tournaments.openMatches(tournament.id)[0]!;
  const { duel } = createDuelSeriesService(db, new Map()).startTournamentMatch({
    guildId: "fixture", tournamentMatchId: match.id, actorPlayerId: owner,
  });
  const duels = createDuelService(db);
  mocks.actor.mockResolvedValue({ ok: true, guildId: "fixture", playerId: spectator, userId: "fixture-spectator", duels });
  const response = await GET(new Request("http://localhost/fixture"), { params: Promise.resolve({ slug: duel.slug }) });
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ role: "spectator", mySeat: null, myDeck: null, session: { status: "lobby" } });
  expect(mocks.host).not.toHaveBeenCalled();
});
