import { fixtureUserId, fixtureDiscordId, seedFixtureUsers } from "../../fixtures/identity";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { migrate } from "../../../../shared/src/db/schema";
import { loadTournamentRounds } from "@/components/dashboard/tournament-rounds";

describe("loadTournamentRounds", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    migrate(db);
    seedFixtureUsers(db, FIXTURE_KEYS);
    db.prepare(
      `insert into players (id, guild_id, user_id, discord_user_id, display_name) values (1, 'g1', ${fixtureUserId("u1")}, '${fixtureDiscordId("u1")}', 'Yugi'), (2, 'g1', ${fixtureUserId("u2")}, '${fixtureDiscordId("u2")}', 'Kaiba'), (3, 'g1', ${fixtureUserId("u3")}, '${fixtureDiscordId("u3")}', 'Joey')`,
    ).run();
    const t = db.prepare(`insert into tournaments (guild_id, name, format, status, created_by_user_id, web_slug) values ('g1', ?, ?, ?, ${fixtureUserId("u1")}, ?)`);
    t.run("Cup A", "round_robin", "active", "cup-a");
    t.run("Cup B", "single_elim", "pending", null);
    const tp = db.prepare("insert into tournament_participants (tournament_id, player_id) values (?, ?)");
    for (const p of [1, 2, 3]) tp.run(1, p);
    tp.run(2, 1);
    db.prepare("insert into matches (id, guild_id, player_one_id, player_two_id, winner_id, reporter_id, status, source) values (1, 'g1', 1, 2, 1, 1, 'approved', 'tournament')").run();
    const tm = db.prepare("insert into tournament_matches (tournament_id, match_id, player_one_id, player_two_id, round_number, status, metadata_json) values (?, ?, ?, ?, ?, ?, ?)");
    tm.run(1, 1, 1, 2, 1, "completed", "{}");
    tm.run(1, null, 3, null, 1, "completed", '{"bye":true}');
    tm.run(1, null, 1, 3, 2, "open", "{}");
  });

  afterEach(() => db.close());

  const list = [
    { id: 1, format: "round_robin", status: "active", webSlug: "cup-a" },
    { id: 2, format: "single_elim", status: "pending" },
  ];

  it("returns nothing for an empty list without touching the database", () => {
    expect(loadTournamentRounds(db, "g1", []).size).toBe(0);
  });

  it("reads each tournament's players and pairings, oldest round first, with names filled in", () => {
    const result = loadTournamentRounds(db, "g1", list);
    const a = result.get(1)!;
    expect(a.webSlug).toBe("cup-a");
    expect(a.participants.map((p) => p.displayName)).toEqual(["Yugi", "Kaiba", "Joey"]);
    expect(a.matches.map((m) => [m.roundNumber, m.playerOneName, m.playerTwoName, m.status])).toEqual([
      [1, "Yugi", "Kaiba", "completed"],
      [1, "Joey", null, "completed"],
      [2, "Yugi", "Joey", "open"],
    ]);
    expect(a.matches[0]).toMatchObject({ winnerId: 1, reporterId: 1 });
    expect(a.matches[1].metadata).toEqual({ bye: true });
    expect(a.matches.every((m) => m.series === null)).toBe(true);
    expect(a.liveCount).toBe(0);
  });

  it("keeps tournaments apart and returns an entry for one with no pairings yet", () => {
    const b = loadTournamentRounds(db, "g1", list).get(2)!;
    expect(b.participants.map((p) => p.playerId)).toEqual([1]);
    expect(b.matches).toEqual([]);
    expect(b.webSlug).toBeNull();
    expect(b.format).toBe("single_elim");
  });

  it("answers with one query per table however many tournaments it is given", () => {
    const prepared: string[] = [];
    const spy = new Proxy(db, {
      get(target, prop, receiver) {
        if (prop === "prepare") return (sql: string) => { prepared.push(sql); return target.prepare(sql); };
        const value = Reflect.get(target, prop, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    loadTournamentRounds(spy, "g1", list);
    expect(prepared.filter((sql) => sql.includes("tp.tournament_id in"))).toHaveLength(1);
    expect(prepared.filter((sql) => sql.includes("tm.tournament_id in"))).toHaveLength(1);
    expect(prepared.filter((sql) => sql.includes("tournament_match_id in"))).toHaveLength(1);
  });

  it("skips an unreadable series instead of failing the page", () => {
    db.prepare(
      `insert into duel_series (id, guild_id, player0_id, player1_id, status, tournament_match_id, mode, settings_json, created_by_player_id)
       values (1, 'g1', 1, 3, 'active', 3, 'tcg', 'not json', 1)`,
    ).run();
    expect(() => loadTournamentRounds(db, "g1", list)).not.toThrow();
  });
});

const FIXTURE_KEYS = ["u1", "u2", "u3"] as const;
