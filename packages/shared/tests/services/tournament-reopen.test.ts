import { seedIdentity, seedUser } from "../helpers/identity.js";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { migrate } from "../../src/db/index.js";
import { createTournamentService } from "../../src/services/tournaments.js";
import { createMatchService } from "../../src/services/matches.js";
import { createSeasonService } from "../../src/services/seasons.js";

function insertPlayer(db: Database.Database, guildId: string, discordUserId: string, name: string) {
  return seedIdentity(db, { guildId: guildId, name: name, userId: seedUser(db, discordUserId).userId, discordUserId: seedUser(db, discordUserId).discordUserId ?? discordUserId }).playerId;
}

// Round-robin with 2 players => exactly one match. Report+approve completes the tournament.
function completedRoundRobin() {
  const db = new Database(":memory:");
  migrate(db);
  const tournaments = createTournamentService(db);
  const matches = createMatchService(db);
  const a = insertPlayer(db, "g1", "u-a", "Alice");
  const b = insertPlayer(db, "g1", "u-b", "Bob");
  const t = tournaments.create("g1", "RR", "round_robin", seedUser(db, "u-creator").userId);
  tournaments.join(t.id, a);
  tournaments.join(t.id, b);
  tournaments.start(t.id);
  const tm = db.prepare("select * from tournament_matches where tournament_id = ?").get(t.id) as any;
  const reported = tournaments.reportTournamentMatch(tm.id, a, a); // Alice wins
  matches.approve(reported.id, b); // Bob approves -> tournament_match completed, tournament completed
  return { db, tournaments, t, tm, matchId: reported.id, a, b };
}

describe("reopenTournamentMatch", () => {
  it("removes the old ratings and winnings before a replacement is reported", () => {
    const { db, tournaments, tm } = completedRoundRobin();
    tournaments.reopenTournamentMatch(tm.id, seedUser(db, "u-creator").userId);

    expect(db.prepare("select * from player_ratings").all()).toEqual([]);
    expect(db.prepare("select * from season_standings").all()).toEqual([]);
    expect(db.prepare("select * from point_awards").all()).toEqual([]);
    expect(db.prepare("select * from player_achievements").all()).toEqual([]);
    db.close();
  });

  it("scores a corrected result as the only result, including the champion bonus", () => {
    const { db, tournaments, tm, a, b } = completedRoundRobin();
    tournaments.reopenTournamentMatch(tm.id, seedUser(db, "u-creator").userId);
    const corrected = tournaments.reportTournamentMatch(tm.id, a, b);
    createMatchService(db).approve(corrected.id, b);

    expect(db.prepare("select player_id, elo, career_winnings from player_ratings order by player_id").all())
      .toEqual([
        { player_id: a, elo: 984, career_winnings: 0 },
        { player_id: b, elo: 1016, career_winnings: 55 },
      ]);
    expect(db.prepare("select player_id, winnings, wins, losses, current_streak, best_streak from season_standings order by player_id").all())
      .toEqual([
        { player_id: a, winnings: 0, wins: 0, losses: 1, current_streak: 0, best_streak: 0 },
        { player_id: b, winnings: 55, wins: 1, losses: 0, current_streak: 1, best_streak: 1 },
      ]);
    expect(db.prepare("select player_id from point_awards where kind='placement'").all()).toEqual([{ player_id: b }]);
    db.close();
  });

  it("replays later confirmed results instead of subtracting the overturned Elo delta", () => {
    const { db, tournaments, tm, a, b } = completedRoundRobin();
    const matches = createMatchService(db);
    matches.recordConfirmedResult({ guildId: "g1", playerOneId: a, playerTwoId: b, winnerId: a, source: "casual" });
    matches.recordConfirmedResult({ guildId: "g1", playerOneId: a, playerTwoId: b, winnerId: b, source: "casual" });

    tournaments.reopenTournamentMatch(tm.id, seedUser(db, "u-creator").userId);

    expect(db.prepare("select player_id, elo, career_winnings from player_ratings order by player_id").all())
      .toEqual([
        { player_id: a, elo: 999, career_winnings: 5 },
        { player_id: b, elo: 1001, career_winnings: 5 },
      ]);
    expect(db.prepare("select player_id, wins, losses, current_streak, best_streak from season_standings order by player_id").all())
      .toEqual([
        { player_id: a, wins: 1, losses: 1, current_streak: 0, best_streak: 1 },
        { player_id: b, wins: 1, losses: 1, current_streak: 1, best_streak: 1 },
      ]);
    db.close();
  });

  it("does not recover an unrelated approved match whose scoring never succeeded", () => {
    const { db, tournaments, tm, a, b } = completedRoundRobin();
    const matches = createMatchService(db);
    const missing = matches.report({ guildId: "g1", reporterId: a, opponentId: b, winnerId: b, source: "casual" });
    db.prepare("update matches set status='approved' where id=?").run(missing.id);
    tournaments.reopenTournamentMatch(tm.id, seedUser(db, "u-creator").userId);
    expect(db.prepare("select * from player_ratings").all()).toEqual([]);
    expect(db.prepare("select * from point_awards").all()).toEqual([]);
    db.close();
  });

  it("reopens an older season's result and scores its replacement in the active season", () => {
    const { db, tournaments, tm, a, b } = completedRoundRobin();
    const seasons = createSeasonService(db);
    const oldSeason = seasons.getActive("g1")!;
    seasons.end("g1");
    const activeSeason = seasons.start("g1");
    const matches = createMatchService(db);
    matches.recordConfirmedResult({ guildId: "g1", playerOneId: a, playerTwoId: b, winnerId: a, source: "casual" });
    tournaments.reopenTournamentMatch(tm.id, seedUser(db, "u-creator").userId);
    expect(db.prepare("select * from season_standings where season_id=?").all(oldSeason.id)).toEqual([]);
    expect(seasons.getActive("g1")?.id).toBe(activeSeason.id);

    const corrected = tournaments.reportTournamentMatch(tm.id, a, b);
    matches.approve(corrected.id, b);
    expect(db.prepare("select player_id, elo, career_winnings from player_ratings order by player_id").all())
      .toEqual([{ player_id: a, elo: 999, career_winnings: 5 }, { player_id: b, elo: 1001, career_winnings: 55 }]);
    expect(db.prepare("select distinct season_id from point_awards").all()).toEqual([{ season_id: activeSeason.id }]);
    db.close();
  });

  it("recalculates later win points from the corrected opponent ratings", () => {
    const { db, tournaments, tm, a, b } = completedRoundRobin();
    const matches = createMatchService(db);
    for (let i = 0; i < 3; i++) {
      matches.recordConfirmedResult({ guildId: "g1", playerOneId: a, playerTwoId: b, winnerId: a, source: "casual" });
    }
    tournaments.reopenTournamentMatch(tm.id, seedUser(db, "u-creator").userId);
    expect(db.prepare("select player_id, elo, career_winnings from player_ratings order by player_id").all())
      .toEqual([{ player_id: a, elo: 1044, career_winnings: 15 }, { player_id: b, elo: 956, career_winnings: 0 }]);
    expect(db.prepare("select points, opponent_elo from point_awards order by id").all())
      .toEqual([{ points: 5, opponent_elo: 1000 }, { points: 5, opponent_elo: 984 }, { points: 5, opponent_elo: 969 }]);
    db.close();
  });

  it("rolls back the reopen if rebuilding ratings fails", () => {
    const { db, tournaments, tm, t, matchId, a, b } = completedRoundRobin();
    const matches = createMatchService(db);
    matches.recordConfirmedResult({ guildId: "g1", playerOneId: a, playerTwoId: b, winnerId: a, source: "casual" });
    const before = db.prepare("select * from player_ratings order by player_id").all();
    db.exec("create trigger reject_rebuild before insert on player_ratings begin select raise(abort, 'test rebuild failure'); end");
    expect(() => tournaments.reopenTournamentMatch(tm.id, seedUser(db, "u-creator").userId)).toThrow("test rebuild failure");
    expect(db.prepare("select status from matches where id=?").get(matchId)).toEqual({ status: "approved" });
    expect(db.prepare("select status, match_id from tournament_matches where id=?").get(tm.id))
      .toEqual({ status: "completed", match_id: matchId });
    expect(db.prepare("select status from tournaments where id=?").get(t.id)).toEqual({ status: "completed" });
    expect(db.prepare("select * from player_ratings order by player_id").all()).toEqual(before);
    db.close();
  });

  it("reopens a completed round-robin match and reactivates the tournament", () => {
    const { db, tournaments, t, tm } = completedRoundRobin();
    expect((db.prepare("select status from tournaments where id = ?").get(t.id) as any).status).toBe("completed");

    tournaments.reopenTournamentMatch(tm.id, seedUser(db, "u-creator").userId);

    const tmAfter = db.prepare("select * from tournament_matches where id = ?").get(tm.id) as any;
    expect(tmAfter.status).toBe("open");
    expect(tmAfter.match_id).toBeNull();
    const tour = db.prepare("select * from tournaments where id = ?").get(t.id) as any;
    expect(tour.status).toBe("active");
    expect(tour.ended_at).toBeNull();
    const m = db.prepare("select status from matches where id = ?").get((tm as any).id ? tmAfter.match_id ?? 0 : 0);
    // the prior matches row is now denied so it drops out of standings
    const denied = db.prepare("select status from matches where tournament_id = ? order by id desc limit 1").get(t.id) as any;
    expect(denied.status).toBe("denied");
  });

  it("rejects a non-creator", () => {
    const { db, tournaments, tm } = completedRoundRobin();
    expect(() => tournaments.reopenTournamentMatch(tm.id, seedUser(db, "u-not-creator").userId)).toThrow(/organizer/i);
  });

  it("rejects single-elimination tournaments", () => {
    const db = new Database(":memory:");
    migrate(db);
    const tournaments = createTournamentService(db);
    const matches = createMatchService(db);
    const a = insertPlayer(db, "g1", "u-a", "A");
    const b = insertPlayer(db, "g1", "u-b", "B");
    const t = tournaments.create("g1", "SE", "single_elim", seedUser(db, "u-creator").userId);
    tournaments.join(t.id, a);
    tournaments.join(t.id, b);
    tournaments.start(t.id);
    const tm = db.prepare("select * from tournament_matches where tournament_id = ?").get(t.id) as any;
    const reported = tournaments.reportTournamentMatch(tm.id, a, a);
    matches.approve(reported.id, b);
    expect(() => tournaments.reopenTournamentMatch(tm.id, seedUser(db, "u-creator").userId)).toThrow(/round-robin/i);
  });

  it("rejects a match that is not completed", () => {
    const db = new Database(":memory:");
    migrate(db);
    const tournaments = createTournamentService(db);
    const a = insertPlayer(db, "g1", "u-a", "A");
    const b = insertPlayer(db, "g1", "u-b", "B");
    const t = tournaments.create("g1", "RR", "round_robin", seedUser(db, "u-creator").userId);
    tournaments.join(t.id, a);
    tournaments.join(t.id, b);
    tournaments.start(t.id);
    const tm = db.prepare("select * from tournament_matches where tournament_id = ?").get(t.id) as any;
    expect(() => tournaments.reopenTournamentMatch(tm.id, seedUser(db, "u-creator").userId)).toThrow(/not completed/i);
  });
});
