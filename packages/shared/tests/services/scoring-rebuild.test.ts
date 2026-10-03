import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";
import { migrate } from "../../src/db/index.js";
import { createMatchService } from "../../src/services/matches.js";
import { createScoringService } from "../../src/services/scoring.js";
import { createSeasonService } from "../../src/services/seasons.js";
import { createTournamentService } from "../../src/services/tournaments.js";

const databases: Database.Database[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
  vi.restoreAllMocks();
});

function setup() {
  const db = new Database(":memory:");
  databases.push(db);
  migrate(db);
  const ins = db.prepare("insert into players (guild_id, discord_user_id, display_name) values ('g1', ?, ?)");
  const a = Number(ins.run("a", "Alice").lastInsertRowid);
  const b = Number(ins.run("b", "Bob").lastInsertRowid);
  return { db, a, b, matches: createMatchService(db), scoring: createScoringService(db), seasons: createSeasonService(db) };
}

function snapshot(db: Database.Database) {
  return {
    ratings: db.prepare("select * from player_ratings order by guild_id, player_id").all(),
    standings: db.prepare("select * from season_standings order by season_id, player_id").all(),
    awards: db.prepare("select * from point_awards order by id").all(),
    achievements: db.prepare("select * from player_achievements order by guild_id, player_id, achievement_key").all(),
  };
}

describe("scoring.rebuildStandings", () => {
  it("restores ratings, W/L and streaks in scoring order and is deterministic", () => {
    const { db, a, b, matches, scoring } = setup();
    const report = (winnerId: number) => matches.report({ guildId: "g1", reporterId: a, opponentId: b, winnerId, source: "casual" });
    const firstReported = report(a);
    const secondReported = report(b);
    matches.approve(secondReported.id, b);
    matches.approve(firstReported.id, b);
    // Scoring sequence survives equal timestamps and a clock correction.
    db.prepare("update point_awards set created_at='2026-01-01 00:00:00' where match_id=?").run(firstReported.id);
    const expected = snapshot(db);
    db.prepare("update player_ratings set elo=4444, career_winnings=9999, best_streak_alltime=88").run();
    db.prepare("update season_standings set winnings=9999, wins=88, losses=88, current_streak=88, best_streak=88").run();
    scoring.rebuildStandings("g1");
    expect(snapshot(db)).toEqual(expected);
    scoring.rebuildStandings("g1");
    expect(snapshot(db)).toEqual(expected);
    scoring.recordMatchResult(firstReported.id);
    expect(snapshot(db)).toEqual(expected);
  });

  it("preserves scoring seasons and continuous Elo when an older result is overturned", () => {
    const { db, a, b, matches, scoring, seasons } = setup();
    const oldSeason = seasons.start("g1");
    // Reporting time is not scoring time: this report is approved in season 2.
    const delayed = matches.report({ guildId: "g1", reporterId: a, opponentId: b, winnerId: a, source: "casual" });
    const overturned = matches.recordConfirmedResult({ guildId: "g1", playerOneId: a, playerTwoId: b, winnerId: a, source: "casual" });
    seasons.end("g1");
    const newSeason = seasons.start("g1");
    matches.approve(delayed.id, b);
    matches.recordConfirmedResult({ guildId: "g1", playerOneId: a, playerTwoId: b, winnerId: b, source: "casual" });
    db.prepare("update matches set status='denied' where id=?").run(overturned.id);
    seasons.end("g1");

    scoring.rebuildStandings("g1");

    expect(seasons.getActive("g1")).toBeUndefined();
    expect(db.prepare("select * from season_standings where season_id=?").all(oldSeason.id)).toEqual([]);
    expect(db.prepare("select season_id, player_id, winnings, wins, losses, current_streak, best_streak from season_standings order by player_id").all())
      .toEqual([
        { season_id: newSeason.id, player_id: a, winnings: 5, wins: 1, losses: 1, current_streak: 0, best_streak: 1 },
        { season_id: newSeason.id, player_id: b, winnings: 5, wins: 1, losses: 1, current_streak: 1, best_streak: 1 },
      ]);
    expect(db.prepare("select player_id, elo, career_winnings from player_ratings order by player_id").all())
      .toEqual([{ player_id: a, elo: 999, career_winnings: 5 }, { player_id: b, elo: 1001, career_winnings: 5 }]);
  });

  it("keeps Elo across seasons while restarting each season's streak", () => {
    const { db, a, b, matches, scoring, seasons } = setup();
    matches.recordConfirmedResult({ guildId: "g1", playerOneId: a, playerTwoId: b, winnerId: a, source: "casual" });
    seasons.end("g1");
    seasons.start("g1");
    matches.recordConfirmedResult({ guildId: "g1", playerOneId: a, playerTwoId: b, winnerId: a, source: "casual" });
    const expected = snapshot(db);
    db.prepare("update player_ratings set elo=1000, career_winnings=0").run();
    scoring.rebuildStandings("g1");
    expect(snapshot(db)).toEqual(expected);
    expect(db.prepare("select elo from player_ratings where player_id=?").get(a)).toEqual({ elo: 1031 });
    expect(db.prepare("select current_streak from season_standings where player_id=? order by season_id").all(a))
      .toEqual([{ current_streak: 1 }, { current_streak: 1 }]);
  });

  it("repairs stale round-robin placements left by an earlier reopen and correction", () => {
    const { db, a, b, matches, scoring } = setup();
    const tournaments = createTournamentService(db);
    const t = tournaments.create("g1", "Cup", "round_robin", "host");
    tournaments.join(t.id, a);
    tournaments.join(t.id, b);
    tournaments.start(t.id);
    const slot = tournaments.matches(t.id)[0];
    const old = tournaments.reportTournamentMatch(slot.id, a, a);
    matches.approve(old.id, b);
    // Reproduce production data from before this fix, bypassing the reopen service.
    db.prepare("update matches set status='denied' where id=?").run(old.id);
    db.prepare("update tournament_matches set status='open', match_id=null where id=?").run(slot.id);
    db.prepare("update tournaments set status='active', ended_at=null where id=?").run(t.id);
    const corrected = tournaments.reportTournamentMatch(slot.id, a, b);
    matches.approve(corrected.id, b);

    scoring.rebuildStandings("g1");

    expect(db.prepare("select player_id, elo, career_winnings from player_ratings order by player_id").all())
      .toEqual([{ player_id: a, elo: 984, career_winnings: 0 }, { player_id: b, elo: 1016, career_winnings: 55 }]);
    expect(db.prepare("select player_id, placement, points from point_awards where kind='placement'").all())
      .toEqual([{ player_id: b, placement: "champion", points: 50 }]);
    const rebuilt = snapshot(db);
    scoring.rebuildStandings("g1");
    expect(snapshot(db)).toEqual(rebuilt);
  });

  it.each(["reopened", "recompleted"])("removes a stale champion after failed final scoring and a legacy reopen (%s)", (state) => {
    const { db, a, b, matches, scoring, seasons } = setup();
    const season = seasons.start("g1");
    const tournaments = createTournamentService(db);
    const t = tournaments.create("g1", "Cup", "round_robin", "host");
    tournaments.join(t.id, a);
    tournaments.join(t.id, b);
    tournaments.start(t.id);
    const slot = tournaments.matches(t.id)[0];
    const old = tournaments.reportTournamentMatch(slot.id, a, a);
    db.exec(`create trigger reject_final before insert on point_awards when new.kind='match_win' and new.match_id=${old.id} begin select raise(abort, 'missing final score'); end`);
    vi.spyOn(console, "error").mockImplementation(() => {});
    matches.approve(old.id, b);
    db.exec("drop trigger reject_final");
    expect(db.prepare("select kind, player_id, points from point_awards").all())
      .toEqual([{ kind: "placement", player_id: a, points: 50 }]);
    expect(scoring.getProfile("g1", a, "all").achievements)
      .toContainEqual(expect.objectContaining({ achievement_key: "first_tournament_win" }));

    // The deployed legacy reopen retained bonuses without rebuilding ratings.
    db.prepare("update matches set status='denied' where id=?").run(old.id);
    db.prepare("update tournament_matches set status='open', match_id=null where id=?").run(slot.id);
    db.prepare("update tournaments set status='active', ended_at=null where id=?").run(t.id);
    if (state === "recompleted") {
      const corrected = tournaments.reportTournamentMatch(slot.id, a, b);
      matches.approve(corrected.id, b);
    }

    scoring.rebuildStandings("g1", { recoverMissing: true });

    expect(scoring.getProfile("g1", a, "all").careerWinnings).toBe(0);
    expect(scoring.getProfile("g1", a, "all").achievements).toEqual([]);
    expect(db.prepare("select player_id, season_id, placement, points from point_awards where kind='placement'").all())
      .toEqual(state === "recompleted"
        ? [{ player_id: b, season_id: season.id, placement: "champion", points: 50 }] : []);
    expect(db.prepare("select player_id, elo, career_winnings from player_ratings order by player_id").all())
      .toEqual(state === "recompleted"
        ? [{ player_id: a, elo: 984, career_winnings: 0 }, { player_id: b, elo: 1016, career_winnings: 55 }] : []);
    expect(db.prepare("select player_id, achievement_key from player_achievements").all())
      .toEqual(state === "recompleted" ? [{ player_id: b, achievement_key: "first_tournament_win" }] : []);
    const rebuilt = snapshot(db);
    scoring.rebuildStandings("g1", { recoverMissing: true });
    expect(snapshot(db)).toEqual(rebuilt);
  });

  it("keeps a regenerated champion bonus in S1 when the same winner is recorded after a legacy reopen in S2", () => {
    const { db, a, b, matches, scoring, seasons } = setup();
    const s1 = seasons.start("g1");
    const tournaments = createTournamentService(db);
    const t = tournaments.create("g1", "Cup", "round_robin", "host");
    tournaments.join(t.id, a);
    tournaments.join(t.id, b);
    tournaments.start(t.id);
    const slot = tournaments.matches(t.id)[0];
    const old = tournaments.reportTournamentMatch(slot.id, a, a);
    matches.approve(old.id, b);
    db.prepare("update matches set status='denied' where id=?").run(old.id);
    db.prepare("update tournament_matches set status='open', match_id=null where id=?").run(slot.id);
    db.prepare("update tournaments set status='active', ended_at=null where id=?").run(t.id);
    seasons.end("g1");
    const s2 = seasons.start("g1");
    const corrected = tournaments.reportTournamentMatch(slot.id, a, a);
    matches.approve(corrected.id, b);

    scoring.rebuildStandings("g1", { recoverMissing: true });

    expect(db.prepare("select season_id, player_id, placement, points from point_awards where kind='placement'").all())
      .toEqual([{ season_id: s1.id, player_id: a, placement: "champion", points: 50 }]);
    expect(db.prepare("select season_id from point_awards where kind='match_win'").all())
      .toEqual([{ season_id: s2.id }]);
    expect(db.prepare("select season_id, player_id, winnings, wins, losses from season_standings order by season_id, player_id").all())
      .toEqual([
        { season_id: s1.id, player_id: a, winnings: 50, wins: 0, losses: 0 },
        { season_id: s2.id, player_id: a, winnings: 5, wins: 1, losses: 0 },
        { season_id: s2.id, player_id: b, winnings: 0, wins: 0, losses: 1 },
      ]);
    const rebuilt = snapshot(db);
    scoring.rebuildStandings("g1", { recoverMissing: true });
    expect(snapshot(db)).toEqual(rebuilt);
  });

  it("includes approved results that have no ledger entry and ignores pending or denied reports", () => {
    const { db, a, b, matches, scoring, seasons } = setup();
    seasons.start("g1");
    const approved = matches.report({ guildId: "g1", reporterId: a, opponentId: b, winnerId: a, source: "casual" });
    db.prepare("update matches set status='approved', resolved_at=current_timestamp where id=?").run(approved.id);
    matches.report({ guildId: "g1", reporterId: a, opponentId: b, winnerId: b, source: "casual" });
    const denied = matches.report({ guildId: "g1", reporterId: a, opponentId: b, winnerId: b, source: "casual" });
    matches.deny(denied.id, b);
    scoring.rebuildStandings("g1", { recoverMissing: true });
    expect(db.prepare("select player_id, elo, career_winnings from player_ratings order by player_id").all())
      .toEqual([{ player_id: a, elo: 1016, career_winnings: 5 }, { player_id: b, elo: 984, career_winnings: 0 }]);
    const rebuilt = snapshot(db);
    scoring.rebuildStandings("g1");
    expect(snapshot(db)).toEqual(rebuilt);
  });

  it("does not score unrecorded approved matches during an ordinary rebuild", () => {
    const { db, a, b, matches, scoring, seasons } = setup();
    seasons.start("g1");
    const missing = matches.report({ guildId: "g1", reporterId: a, opponentId: b, winnerId: a, source: "casual" });
    db.prepare("update matches set status='approved' where id=?").run(missing.id);
    const before = snapshot(db);
    scoring.rebuildStandings("g1");
    expect(snapshot(db)).toEqual(before);
  });

  it.each(["2026-01-03 00:00:00", "2026-01-02 00:00:00"])("interleaves a recovered match before a scored result resolved at %s", (resolvedAt) => {
    const { db, a, b, matches, scoring, seasons } = setup();
    const season = seasons.start("g1");
    db.prepare("update seasons set started_at='2026-01-01' where id=?").run(season.id);
    const missing = matches.report({ guildId: "g1", reporterId: a, opponentId: b, winnerId: a, source: "casual" });
    db.prepare("update matches set status='approved', resolved_at='2026-01-02 00:00:00' where id=?").run(missing.id);
    const scored = matches.recordConfirmedResult({ guildId: "g1", playerOneId: a, playerTwoId: b, winnerId: b, source: "casual" });
    db.prepare("update matches set resolved_at=? where id=?").run(resolvedAt, scored.id);
    db.prepare("update point_awards set created_at=?").run(resolvedAt);

    scoring.rebuildStandings("g1", { recoverMissing: true });

    expect(db.prepare("select player_id, elo, career_winnings from player_ratings order by player_id").all())
      .toEqual([{ player_id: a, elo: 999, career_winnings: 5 }, { player_id: b, elo: 1001, career_winnings: 5 }]);
    expect(db.prepare("select player_id, wins, losses, current_streak, best_streak from season_standings order by player_id").all())
      .toEqual([
        { player_id: a, wins: 1, losses: 1, current_streak: 0, best_streak: 1 },
        { player_id: b, wins: 1, losses: 1, current_streak: 1, best_streak: 1 },
      ]);
    expect(db.prepare("select player_id, achievement_key from player_achievements").all())
      .toEqual([{ player_id: b, achievement_key: "giant_slayer" }]);
    expect(db.prepare("select match_id from point_awards order by id").all())
      .toEqual([{ match_id: missing.id }, { match_id: scored.id }]);
    const rebuilt = snapshot(db);
    scoring.rebuildStandings("g1", { recoverMissing: true });
    expect(snapshot(db)).toEqual(rebuilt);
    scoring.rebuildStandings("g1");
    expect(snapshot(db)).toEqual(rebuilt);
  });

  it("keeps placement seasons after a pending denial and missing final score across two rebuilds", () => {
    const { db, a, b, matches, scoring, seasons } = setup();
    const c = Number(db.prepare("insert into players (guild_id, discord_user_id, display_name) values ('g1', 'c', 'C')").run().lastInsertRowid);
    const tournaments = createTournamentService(db);
    const t = tournaments.create("g1", "Cup", "round_robin", "host");
    for (const p of [a, b, c]) tournaments.join(t.id, p);
    tournaments.start(t.id);
    const slots = tournaments.matches(t.id).filter((slot) => slot.playerTwoId !== null);
    const oldSeason = seasons.start("g1");
    db.prepare("update seasons set started_at='2026-01-01' where id=?").run(oldSeason.id);
    for (const slot of slots.slice(0, 2)) {
      matches.recordConfirmedResult({ guildId: "g1", playerOneId: slot.playerOneId, playerTwoId: slot.playerTwoId!, winnerId: slot.playerOneId, source: "tournament", tournamentMatchId: slot.id });
    }
    db.prepare("update matches set resolved_at='2026-01-02'").run();
    db.prepare("update point_awards set created_at='2026-01-02'").run();
    seasons.end("g1");
    const newSeason = seasons.start("g1");
    db.prepare("update seasons set started_at='2026-02-01' where id=?").run(newSeason.id);
    const final = slots[2];
    const rejected = tournaments.reportTournamentMatch(final.id, final.playerOneId, final.playerOneId);
    const beforeDenial = snapshot(db);
    matches.deny(rejected.id, final.playerTwoId!);
    expect(snapshot(db)).toEqual(beforeDenial);
    const reported = tournaments.reportTournamentMatch(final.id, final.playerOneId, final.playerOneId);
    db.exec(`create trigger reject_final before insert on point_awards when new.kind='match_win' and new.match_id=${reported.id} begin select raise(abort, 'missing final score'); end`);
    vi.spyOn(console, "error").mockImplementation(() => {});
    matches.approve(reported.id, final.playerTwoId!);
    db.exec("drop trigger reject_final");
    db.prepare("update matches set resolved_at='2026-02-02' where id=?").run(reported.id);
    db.prepare("update tournaments set ended_at='2026-02-02' where id=?").run(t.id);
    db.prepare("update point_awards set created_at='2026-02-02' where kind='placement'").run();
    const recorded = snapshot(db);

    scoring.rebuildStandings("g1");
    expect(snapshot(db)).toEqual(recorded);
    scoring.rebuildStandings("g1", { recoverMissing: true });
    expect(db.prepare("select season_id, placement, points from point_awards where kind='placement' order by id").all())
      .toEqual([
        { season_id: newSeason.id, placement: "champion", points: 50 },
        { season_id: newSeason.id, placement: "runnerUp", points: 30 },
      ]);
    const rebuilt = snapshot(db);
    scoring.rebuildStandings("g1", { recoverMissing: true });
    expect(snapshot(db)).toEqual(rebuilt);
  });

  it("recovers missing completed tournament bonuses only when explicitly requested", () => {
    const { db, a, b, matches, scoring } = setup();
    const tournaments = createTournamentService(db);
    const t = tournaments.create("g1", "Cup", "round_robin", "host");
    tournaments.join(t.id, a);
    tournaments.join(t.id, b);
    tournaments.start(t.id);
    db.exec("create trigger reject_placement before insert on point_awards when new.kind='placement' begin select raise(abort, 'missing placement'); end");
    vi.spyOn(console, "error").mockImplementation(() => {});
    const slot = tournaments.matches(t.id)[0];
    matches.recordConfirmedResult({ guildId: "g1", playerOneId: a, playerTwoId: b, winnerId: a, source: "tournament", tournamentMatchId: slot.id });
    db.exec("drop trigger reject_placement");
    const recorded = snapshot(db);
    scoring.rebuildStandings("g1");
    expect(snapshot(db)).toEqual(recorded);

    scoring.rebuildStandings("g1", { recoverMissing: true });

    expect(db.prepare("select elo, career_winnings from player_ratings where player_id=?").get(a))
      .toEqual({ elo: 1016, career_winnings: 55 });
    expect(db.prepare("select player_id, placement, points from point_awards where kind='placement'").all())
      .toEqual([{ player_id: a, placement: "champion", points: 50 }]);
    expect(db.prepare("select player_id, achievement_key from player_achievements").all())
      .toEqual([{ player_id: a, achievement_key: "first_tournament_win" }]);
    const rebuilt = snapshot(db);
    scoring.rebuildStandings("g1", { recoverMissing: true });
    expect(snapshot(db)).toEqual(rebuilt);
  });

  it("preserves explicit bracket placement awards and other guilds", () => {
    const { db, a, b, matches, scoring } = setup();
    const tournamentId = Number(db.prepare(
      "insert into tournaments (guild_id, name, format, status, created_by_user_id) values ('g1', 'Bracket', 'single_elim', 'completed', 'host')",
    ).run().lastInsertRowid);
    db.prepare("insert into tournament_participants (tournament_id, player_id) values (?, ?), (?, ?)")
      .run(tournamentId, a, tournamentId, b);
    scoring.recordTournamentResult(tournamentId, { champion: b, runnerUp: a, top4: [] });
    const ins = db.prepare("insert into players (guild_id, discord_user_id, display_name) values ('g2', ?, ?)");
    const c = Number(ins.run("c", "C").lastInsertRowid);
    const d = Number(ins.run("d", "D").lastInsertRowid);
    matches.recordConfirmedResult({ guildId: "g2", playerOneId: c, playerTwoId: d, winnerId: c, source: "casual" });
    const expected = snapshot(db);
    db.prepare("update player_ratings set career_winnings=9999 where guild_id='g1'").run();
    scoring.rebuildStandings("g1");
    expect(snapshot(db)).toEqual(expected);
  });
});
