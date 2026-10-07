import Database from "better-sqlite3";
import { afterEach, beforeEach, expect, it } from "vitest";
import { migrate } from "../../src/db/schema.js";
import { hasHistory, userHistory } from "../../src/services/user-history.js";

let db: Database.Database;
// Literal fixtures keep every unrelated reference on user/player 2. Only the
// column under test is changed to 1, including nullable winner/approver columns.
const fixtures: Record<string, Record<string, string | number | null>> = {
  tournaments: { guild_id: "g", name: "test", format: "round_robin", status: "pending", created_by_user_id: 2 },
  cubes: { guild_id: "g", name: "test", created_by_user_id: 2 },
  drafts: { guild_id: "g", name: "test", status: "pending", created_by_user_id: 2 },
  seasons: { guild_id: "g", number: 2, status: "ended", created_by_user_id: 2 },
  saved_decks: { guild_id: "g", name: "test", mode: "normal", deck_json: "{}", owner_user_id: 2 },
  tournament_participants: { tournament_id: 1, player_id: 2 },
  draft_player_cube: { draft_id: 1, cube_id: 1, player_id: 2 },
  draft_players: { draft_id: 1, player_id: 2 },
  matches: { guild_id: "g", player_one_id: 2, player_two_id: 2, winner_id: 2, reporter_id: 2, approver_id: 2, status: "confirmed", source: "casual" },
  tournament_matches: { tournament_id: 1, player_one_id: 2, player_two_id: 2, round_number: 1, status: "pending" },
  player_ratings: { guild_id: "g", player_id: 2 },
  point_awards: { guild_id: "g", season_id: 1, player_id: 2, kind: "match_win", points: 1 },
  season_standings: { guild_id: "g", season_id: 1, player_id: 2 },
  player_achievements: { guild_id: "g", player_id: 2, achievement_key: "first" },
  duels: { guild_id: "g", web_slug: "test", name: "test", organizer_player_id: 2, winner_player_id: 2, mode: "normal", status: "completed" },
  duel_seats: { duel_id: 1, seat: 0, player_id: 2 },
  duel_invite_grants: { duel_id: 1, player_id: 2 },
  duel_series: { guild_id: "g", player0_id: 2, player1_id: 2, winner_player_id: 2, created_by_player_id: 2, mode: "normal", settings_json: "{}" },
  bug_reports: { guild_id: "g", player_id: 2, created_at: "2026-10-06", path: "/drafts", description: "test", context_json: "{}" },
  draft_cards: { draft_id: 1, wave_number: 1, catalog_card_id: 1, picked_by_player_id: 2 },
  draft_picks: { draft_id: 1, player_id: 2, draft_card_id: 1, wave_number: 1, pick_step: 1, picked_at: "2026-10-06" },
  draft_passes: { draft_id: 1, player_id: 2, wave_number: 1, pick_step: 1, passed_at: "2026-10-06" },
};
const references = [
  "tournaments.created_by_user_id", "cubes.created_by_user_id", "drafts.created_by_user_id", "seasons.created_by_user_id", "saved_decks.owner_user_id",
  "tournament_participants.player_id", "draft_player_cube.player_id", "draft_players.player_id",
  "matches.player_one_id", "matches.player_two_id", "matches.winner_id", "matches.reporter_id", "matches.approver_id",
  "tournament_matches.player_one_id", "tournament_matches.player_two_id",
  "player_ratings.player_id", "point_awards.player_id", "season_standings.player_id", "player_achievements.player_id",
  "duels.organizer_player_id", "duels.winner_player_id", "duel_seats.player_id", "duel_invite_grants.player_id",
  "duel_series.player0_id", "duel_series.player1_id", "duel_series.winner_player_id", "duel_series.created_by_player_id",
  "bug_reports.player_id", "draft_cards.picked_by_player_id", "draft_picks.player_id", "draft_passes.player_id",
];
function insert(table: string, row: Record<string, string | number | null>) {
  db.prepare(`insert into ${table} (${Object.keys(row).join(",")}) values (${Object.keys(row).map(() => "?").join(",")})`).run(...Object.values(row));
}
beforeEach(() => {
  db = new Database(":memory:"); migrate(db); db.pragma("foreign_keys=on");
  db.exec("insert into users(id,username,display_name) values(1,'target','Target'),(2,'other','Other'); insert into players(id,guild_id,user_id,display_name) values(1,'g',1,'Target'),(2,'g',2,'Other')");
  insert("tournaments", { ...fixtures.tournaments, name: "dependency" });
  insert("cubes", { ...fixtures.cubes, name: "dependency" });
  insert("drafts", { ...fixtures.drafts, name: "dependency" });
  insert("seasons", { ...fixtures.seasons, number: 1 });
  insert("duels", { ...fixtures.duels, web_slug: "dependency" });
  db.exec("insert into card_catalog(ygoprodeck_id,name,type,frame_type,image_url,image_url_small,card_sets_json,cached_at) values(1,'Card','Effect Monster','effect','','','[]','2026-10-06')");
});
afterEach(() => db.close());

it("treats a fresh user with empty players as empty and excludes unrelated activity", () => {
  expect(userHistory(db, 1)).toEqual({});
  expect(hasHistory(db, 1)).toBe(false);
  expect(hasHistory(db, 2)).toBe(true);
});
it.each(references)("counts %s with foreign keys enabled", reference => {
  const [table, column] = reference.split(".");
  if (["draft_cards", "draft_picks", "draft_passes"].includes(table)) {
    insert("draft_players", { draft_id: 1, player_id: 1 });
    if (table === "draft_picks") insert("draft_players", { draft_id: 1, player_id: 2 });
    if (table === "draft_picks") insert("draft_cards", fixtures.draft_cards);
  }
  insert(table, { ...fixtures[table], [column]: 1 });
  expect(userHistory(db, 1)[reference]).toBe(1);
  expect(hasHistory(db, 1)).toBe(true);
  expect(db.pragma("foreign_key_check")).toEqual([]);
});
it("counts a creator who never played", () => {
  db.exec("delete from players where user_id=1");
  insert("saved_decks", { ...fixtures.saved_decks, owner_user_id: 1 });
  expect(userHistory(db, 1)).toEqual({ "saved_decks.owner_user_id": 1 });
});
it("aggregates all of the user's players across communities", () => {
  db.exec("insert into players(id,guild_id,user_id,display_name) values(3,'other',1,'Target')");
  insert("player_ratings", { guild_id: "g", player_id: 1 });
  insert("player_ratings", { guild_id: "other", player_id: 3 });
  expect(userHistory(db, 1)).toEqual({ "player_ratings.player_id": 2 });
});
it("tolerates an absent listed column in a later schema", () => {
  db.exec("alter table matches drop column approver_id");
  insert("player_ratings", { guild_id: "g", player_id: 1 });
  expect(userHistory(db, 1)).toEqual({ "player_ratings.player_id": 1 });
});
it("fails explicitly when a listed table is missing", () => {
  db.exec("drop table bug_reports");
  expect(() => userHistory(db, 1)).toThrow(/bug_reports/);
});
