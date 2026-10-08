import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { migrate } from "../../src/db/schema.js";
import { createScoringService } from "../../src/services/scoring.js";
import { createSeasonService } from "../../src/services/seasons.js";
import { createTournamentService } from "../../src/services/tournaments.js";
import { createDuelSeriesService } from "../../src/services/duel-series.js";
import { createDuelService } from "../../src/services/duels.js";
import { createLiveNowService } from "../../src/services/live-now.js";
import { createOpenNowService } from "../../src/services/open-now.js";
import { findTournamentDashboardSummaries } from "../../src/services/paged-lists.js";
import { seedIdentity, seedUser } from "../helpers/identity.js";

let db: Database.Database;
beforeEach(() => { db = new Database(":memory:"); migrate(db); });
afterEach(() => { vi.restoreAllMocks(); db.close(); });

describe("profile award tournament privacy", () => {
  for (const visibility of ["private", "open"] as const) {
    for (const role of ["creator", "participant", "grant", "stranger"] as const) {
      it(`${visibility} awards for ${role}, including viewers without players`, () => {
        const host = seedUser(db, "host");
        const subject = seedIdentity(db, { guildId: "g", name: "Subject" });
        const viewer = role === "creator" ? host : seedUser(db, "viewer");
        const t = createTournamentService(db).create("g", "Secret Cup", "round_robin", host.userId, { visibility });
        if (role === "participant") {
          const participant = seedIdentity(db, { guildId: "g", name: "Viewer", userId: viewer.userId });
          db.prepare("insert into tournament_participants(tournament_id,player_id) values(?,?)").run(t.id, participant.playerId);
        }
        if (role === "grant") db.prepare("insert into tournament_invite_grants(tournament_id,user_id) values(?,?)").run(t.id, viewer.userId);
        const season = createSeasonService(db).ensureActive("g");
        db.prepare("insert into point_awards(guild_id,season_id,player_id,kind,tournament_id,points) values('g',?,?,'placement',?,15)").run(season.id, subject.playerId, t.id);
        const scoring = createScoringService(db);
        const readable = visibility === "open" || role !== "stranger";
        const prepare = vi.spyOn(db, "prepare");
        const recent = scoring.getProfile("g", subject.playerId, "all", viewer.userId).recent;
        expect(recent).toEqual([expect.objectContaining({ points: 15, tournament_id: readable ? t.id : null, tournament_name: readable ? "Secret Cup" : null })]);
        expect(prepare.mock.calls.filter(([sql]) => sql.includes("point_awards"))).toHaveLength(1);
      });
    }
  }
  it("redacts a linked tournament outside the requested guild", () => {
    const viewer = seedIdentity(db, { guildId: "g", name: "Viewer" });
    const t = createTournamentService(db).create("other", "Other Cup", "round_robin", viewer.userId, { visibility: "open" });
    const season = createSeasonService(db).ensureActive("g");
    db.prepare("insert into point_awards(guild_id,season_id,player_id,kind,tournament_id,points) values('g',?,?,'placement',?,15)").run(season.id, viewer.playerId, t.id);
    expect(createScoringService(db).getProfile("g", viewer.playerId, "season", viewer.userId).recent)
      .toEqual([expect.objectContaining({ tournament_id: null, tournament_name: null })]);
  });
});

it("Your tournaments excludes unrelated open entries before the limit", () => {
  const host = seedUser(db, "host"), viewer = seedIdentity(db, { guildId: "g", name: "Viewer" });
  const tournaments = createTournamentService(db);
  const created = tournaments.create("g", "Created", "round_robin", viewer.userId);
  const joined = tournaments.create("g", "Joined", "round_robin", host.userId, { visibility: "open" });
  tournaments.join(joined.id, viewer.playerId);
  const granted = tournaments.create("g", "Granted", "round_robin", host.userId);
  db.prepare("insert into tournament_invite_grants(tournament_id,user_id) values(?,?)").run(granted.id, viewer.userId);
  for (let i = 0; i < 12; i++) tournaments.create("g", `Unrelated ${i}`, "round_robin", host.userId, { visibility: "open" });
  expect(findTournamentDashboardSummaries(db, "g", viewer.userId).map(t => t.name)).toEqual(["Granted", "Joined", "Created"]);
  db.prepare("delete from tournament_participants where player_id=?").run(viewer.playerId);
  db.prepare("delete from players where id=?").run(viewer.playerId);
  expect(findTournamentDashboardSummaries(db, "g", viewer.userId).map(t => t.name)).toEqual(["Granted", "Created"]);
});

function tournamentDuel() {
  const host = seedIdentity(db, { guildId: "g", name: "Host" });
  const a = seedIdentity(db, { guildId: "g", name: "A" });
  const b = seedIdentity(db, { guildId: "g", name: "B" });
  const grant = seedIdentity(db, { guildId: "g", name: "Grant" });
  const stranger = seedIdentity(db, { guildId: "g", name: "Stranger" });
  const tournaments = createTournamentService(db);
  const t = tournaments.create("g", "Secret Cup", "round_robin", host.userId);
  tournaments.join(t.id, a.playerId); tournaments.join(t.id, b.playerId); tournaments.start(t.id);
  db.prepare("insert into tournament_invite_grants(tournament_id,user_id) values(?,?)").run(t.id, grant.userId);
  db.prepare("update tournament_participants set deck_json=? where tournament_id=?").run(JSON.stringify({ main: [], extra: [], side: [] }), t.id);
  const series = createDuelSeriesService(db);
  const started = series.startTournamentMatch({ guildId: "g", tournamentMatchId: tournaments.openMatches(t.id)[0]!.id, actorPlayerId: a.playerId });
  db.prepare("update duel_seats set ready=1 where duel_id=?").run(started.duel.id);
  return { host, a, b, grant, stranger, t, started, series, duels: createDuelService(db) };
}

it("internal room data retains tournament metadata even for a slug spectator", () => {
  const app = tournamentDuel();
  const room = app.duels.room(app.started.duel.slug, "g", app.stranger.playerId);
  expect(room.role).toBe("spectator");
  expect(room.series?.tournamentId).toBe(app.t.id);
  expect(room.session.name).toContain("Secret Cup");
});

describe("tournament duel discovery", () => {
  it("omits private sources from live and all-history lists while preserving readers and open sources", () => {
    const app = tournamentDuel();
    expect(app.duels.list("g", app.stranger.playerId)).toEqual([]);
    for (const viewer of [app.host, app.a, app.b, app.grant]) expect(app.duels.list("g", viewer.playerId).map(d => d.slug)).toEqual([app.started.duel.slug]);
    db.prepare("update tournaments set visibility='open' where id=?").run(app.t.id);
    expect(app.duels.list("g", app.stranger.playerId).map(d => d.slug)).toEqual([app.started.duel.slug]);
    db.prepare("update tournaments set visibility='private' where id=?").run(app.t.id);
    app.duels.activate(app.started.duel.slug, "g", null, ["seed"], "bundle", null);
    app.duels.complete(app.started.duel.slug, "g", 0, "done");
    app.duels.archive(app.started.duel.slug, "g", app.started.duel.organizerPlayerId);
    expect(app.duels.list("g", app.stranger.playerId, { archived: true, scope: "all" })).toEqual([]);
    expect(app.duels.list("g", app.grant.playerId, { archived: true, scope: "all" })).toHaveLength(1);
  });

  it("filters live-now and open-now counts with the same reader scope", () => {
    const app = tournamentDuel();
    app.duels.activate(app.started.duel.slug, "g", null, ["seed"], "bundle", null);
    const live = createLiveNowService(db), open = createOpenNowService(db);
    expect(live.forPlayer("g", app.stranger.playerId)).toEqual({ yourDuel: null, liveCount: 0 });
    expect(live.countInProgress("g", null)).toBe(0);
    expect(open.forPlayer("g", app.stranger.playerId).duelsInProgress).toBe(0);
    for (const viewer of [app.host, app.a, app.b, app.grant]) expect(live.forPlayer("g", viewer.playerId).liveCount).toBe(1);
    expect(open.forPlayer("g", app.grant.playerId).duelsInProgress).toBe(1);
    db.prepare("update tournaments set visibility='open' where id=?").run(app.t.id);
    expect(live.forPlayer("g", app.stranger.playerId).liveCount).toBe(1);
    expect(live.countInProgress("g", null)).toBe(1);
  });

  it("requires tournament access even when the viewer has a duel invite or a seat", () => {
    const app = tournamentDuel();
    db.prepare("insert into duel_invite_grants(duel_id,player_id) values(?,?)").run(app.started.duel.id, app.stranger.playerId);
    db.prepare("delete from tournament_participants where tournament_id=? and player_id=?").run(app.t.id, app.a.playerId);
    expect(app.duels.list("g", app.stranger.playerId)).toEqual([]);
    expect(app.duels.list("g", app.a.playerId)).toEqual([]);
    expect(createLiveNowService(db).forPlayer("g", app.a.playerId).yourDuel).toBeNull();
    app.duels.activate(app.started.duel.slug, "g", null, ["seed"], "bundle", null);
    app.duels.complete(app.started.duel.slug, "g", 0, "done");
    expect(createLiveNowService(db).forPlayer("g", app.a.playerId).yourDuel).toBeNull();
    expect(app.duels.room(app.started.duel.slug, "g", app.stranger.playerId).role).toBe("spectator");
  });

  it("keeps open-now discovery available to creators and grantees without player rows", () => {
    const app = tournamentDuel();
    const creator = seedUser(db, "creatorNoPlayer"), grantee = seedUser(db, "granteeNoPlayer"), stranger = seedUser(db, "strangerNoPlayer");
    db.prepare("update tournaments set created_by_user_id=? where id=?").run(creator.userId, app.t.id);
    db.prepare("insert into tournament_invite_grants(tournament_id,user_id) values(?,?)").run(app.t.id, grantee.userId);
    app.duels.activate(app.started.duel.slug, "g", null, ["seed"], "bundle", null);
    const open = createOpenNowService(db);
    expect(open.forPlayer("g", null, stranger.userId).duelsInProgress).toBe(0);
    expect(open.forPlayer("g", null, creator.userId).duelsInProgress).toBe(1);
    expect(open.forPlayer("g", null, grantee.userId).duelsInProgress).toBe(1);
  });
});
