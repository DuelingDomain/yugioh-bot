import { seedIdentity, seedUser } from "../helpers/identity.js";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrate } from "../../src/db/index.js";
import { repairRatings, formatRepairReport, runRepairRatingsCli } from "../../src/maintenance/repair-ratings.js";
import { createMatchService } from "../../src/services/matches.js";
import { createScoringService } from "../../src/services/scoring.js";
import { createSeasonService } from "../../src/services/seasons.js";

const databases: Database.Database[] = [];
afterEach(() => { for (const db of databases.splice(0)) db.close(); });

function fixture() {
  const db = new Database(":memory:");
  databases.push(db);
  migrate(db);
  const a = seedIdentity(db, { guildId: "g1", name: "Alice", userId: seedUser(db, "a").userId, discordUserId: seedUser(db, "a").discordUserId ?? "a" }).playerId;
  const b = seedIdentity(db, { guildId: "g1", name: "Bob", userId: seedUser(db, "b").userId, discordUserId: seedUser(db, "b").discordUserId ?? "b" }).playerId;
  const matches = createMatchService(db);
  const old = matches.recordConfirmedResult({ guildId: "g1", playerOneId: a, playerTwoId: b, winnerId: a, source: "casual" });
  db.prepare("update matches set status='denied' where id=?").run(old.id);
  matches.recordConfirmedResult({ guildId: "g1", playerOneId: a, playerTwoId: b, winnerId: b, source: "casual" });
  createSeasonService(db).end("g1");
  return { db, a, b, old };
}

describe("repairRatings maintenance function", () => {
  it("defaults to a dry run using current source with a per-player diff", () => {
    const { db, a, b } = fixture();
    const before = db.serialize();
    const report = repairRatings(db);
    expect(report.applied).toBe(false);
    expect(report.changes.filter((c) => c.kind === "player")).toEqual([
      { kind: "player", guildId: "g1", playerId: a, displayName: "Alice", current: { elo: 999, wins: 1, losses: 1, winnings: 5 }, rebuilt: { elo: 984, wins: 0, losses: 1, winnings: 0 } },
      { kind: "player", guildId: "g1", playerId: b, displayName: "Bob", current: { elo: 1001, wins: 1, losses: 1, winnings: 5 }, rebuilt: { elo: 1016, wins: 1, losses: 0, winnings: 5 } },
    ]);
    expect(db.serialize()).toEqual(before);
  });

  it("applies only when requested and a subsequent dry run has no changes", () => {
    const { db, a, b } = fixture();
    const report = repairRatings(db, { apply: true });
    expect(report.applied).toBe(true);
    expect(db.prepare("select player_id, elo, career_winnings from player_ratings order by player_id").all())
      .toEqual([{ player_id: a, elo: 984, career_winnings: 0 }, { player_id: b, elo: 1016, career_winnings: 5 }]);
    expect(db.prepare("select status from seasons").all()).toEqual([{ status: "ended" }]);
    expect(db.prepare("select count(*) as n from point_awards").get()).toEqual({ n: 1 });
    expect(repairRatings(db).changes).toEqual([]);
  });

  it("reports per-season transfers even when lifetime figures are identical", () => {
    const { db, a, b } = fixture();
    repairRatings(db, { apply: true });
    const seasons = createSeasonService(db);
    const s2 = seasons.start("g1");
    const tournamentId = Number(db.prepare("insert into tournaments (guild_id, name, format, status, created_by_user_id) values ('g1', 'Bracket', 'single_elim', 'completed', ?)").run(seedUser(db, "host").userId).lastInsertRowid);
    db.prepare("insert into tournament_participants (tournament_id, player_id) values (?, ?), (?, ?)").run(tournamentId, a, tournamentId, b);
    createScoringService(db).recordTournamentResult(tournamentId, { champion: a, top4: [] });
    const s1 = db.prepare("select id from seasons where status='ended'").get() as { id: number };
    db.prepare("update season_standings set winnings=winnings+50 where season_id=? and player_id=?").run(s1.id, a);
    db.prepare("update season_standings set winnings=0 where season_id=? and player_id=?").run(s2.id, a);
    const before = db.serialize();

    const report = repairRatings(db);

    expect(report.summary.playersChanged).toBe(0);
    expect(report.summary.seasonsChanged).toBe(2);
    expect(report.changes.filter((c) => c.kind === "season")).toEqual([
      { kind: "season", guildId: "g1", playerId: a, displayName: "Alice", seasonId: s1.id, seasonNumber: 1,
        current: { winnings: 50, wins: 0, losses: 1, currentStreak: 0, bestStreak: 0 },
        rebuilt: { winnings: 0, wins: 0, losses: 1, currentStreak: 0, bestStreak: 0 } },
      { kind: "season", guildId: "g1", playerId: a, displayName: "Alice", seasonId: s2.id, seasonNumber: 2,
        current: { winnings: 0, wins: 0, losses: 0, currentStreak: 0, bestStreak: 0 },
        rebuilt: { winnings: 50, wins: 0, losses: 0, currentStreak: 0, bestStreak: 0 } },
    ]);
    expect(db.serialize()).toEqual(before);
    const lines = formatRepairReport(report).split("\n");
    expect(lines[0]).toContain("DRY RUN");
    expect(lines[0]).toContain("2 season standings");
    expect(lines.slice(1).map((line) => JSON.parse(line))).toEqual(report.changes);
  });

  it("reports award and achievement additions and removals", () => {
    const { db, a, b, old } = fixture();
    db.prepare("insert into player_achievements (guild_id, player_id, achievement_key) values ('g1', ?, 'first_tournament_win')").run(a);
    const report = repairRatings(db);
    // The surviving match's opponent Elo is also corrected, so its old award
    // is removed and its replacement is added alongside the overturned award.
    expect(report.summary).toEqual({ playersChanged: 2, seasonsChanged: 2, awardsAdded: 1, awardsRemoved: 2, achievementsAdded: 0, achievementsRemoved: 2 });
    expect(report.changes.filter((c) => c.kind === "award_removed")).toEqual([
      expect.objectContaining({ guildId: "g1", playerId: a, seasonId: 1, award: expect.objectContaining({ matchId: old.id, kind: "match_win", points: 5 }) }),
      expect.objectContaining({ guildId: "g1", playerId: b, seasonId: 1, award: expect.objectContaining({ kind: "match_win", opponentElo: 1016 }) }),
    ]);
    expect(report.changes.filter((c) => c.kind === "achievement_removed")).toEqual([
      expect.objectContaining({ playerId: a, achievementKey: "first_tournament_win" }),
      expect.objectContaining({ playerId: b, achievementKey: "giant_slayer" }),
    ]);

    repairRatings(db, { apply: true });
    const tournamentId = Number(db.prepare("insert into tournaments (guild_id, name, format, status, created_by_user_id) values ('g1', 'Cup', 'round_robin', 'completed', ?)").run(seedUser(db, "host").userId).lastInsertRowid);
    db.prepare("insert into tournament_participants (tournament_id, player_id) values (?, ?), (?, ?)").run(tournamentId, a, tournamentId, b);
    const matchId = Number(db.prepare(
      "insert into matches (guild_id, player_one_id, player_two_id, winner_id, reporter_id, status, source, tournament_id) values ('g1', ?, ?, ?, ?, 'approved', 'tournament', ?)",
    ).run(a, b, a, a, tournamentId).lastInsertRowid);
    db.prepare("insert into tournament_matches (tournament_id, match_id, player_one_id, player_two_id, round_number, status) values (?, ?, ?, ?, 1, 'completed')").run(tournamentId, matchId, a, b);
    const recovered = repairRatings(db);
    expect(recovered.summary.awardsAdded).toBe(2);
    expect(recovered.changes.filter((c) => c.kind === "achievement_added")).toContainEqual(
      expect.objectContaining({ playerId: a, achievementKey: "first_tournament_win" }),
    );
    expect(recovered.changes.filter((c) => c.kind === "award_added")).toEqual([
      expect.objectContaining({ playerId: a, award: expect.objectContaining({ kind: "placement", placement: "champion", points: 50 }) }),
      expect.objectContaining({ playerId: a, award: expect.objectContaining({ kind: "match_win", matchId }) }),
    ]);
  });

  it("rolls back the entire apply when a rebuild write fails", () => {
    const { db } = fixture();
    db.exec("create trigger reject_repair before insert on season_standings begin select raise(abort, 'test repair failure'); end");
    const before = db.serialize();
    expect(() => repairRatings(db, { apply: true })).toThrow("test repair failure");
    expect(db.serialize()).toEqual(before);
  });

  it("requires an explicit existing database and rejects unknown CLI options through source", () => {
    const missing = join(tmpdir(), `yugioh-repair-missing-${randomUUID()}.sqlite`);
    expect(() => runRepairRatingsCli([])).toThrow("--db");
    expect(() => runRepairRatingsCli(["--db", missing, "--apply"])).toThrow();
    expect(() => runRepairRatingsCli(["--db", missing, "--aply"])).toThrow("--aply");
  });
});
