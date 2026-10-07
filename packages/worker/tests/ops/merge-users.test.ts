import { afterEach, expect, it } from "vitest";
import { mergeUsers } from "../../src/ops/merge-users.js";
import { fixture } from "./fixtures.js";
let f: ReturnType<typeof fixture>;
afterEach(() => f?.close());
function setup() { f = fixture(); f.user(1, { clerk: "source_clerk", discord: "123" }); f.user(2); f.player(11, 1); }
function draft(id: number) { f.db.prepare("insert into drafts(id,guild_id,name,status,created_by_user_id,config_json) values(?,'guild',?,'complete',1,?)").run(id, `Draft ${id}`, '{"themeAssignments":{"11":"theme"}}'); }
it("reports identities, history and affected rows without writing during dry-run", () => {
  setup(); draft(1); const before = f.checksum();
  const report = mergeUsers({ db: f.db, apply: false }, 1, 2);
  expect(f.checksum()).toBe(before);
  expect(report.source).toMatchObject({ id: 1, hasClerk: true, hasDiscord: true });
  expect(report.sourceHistory).toEqual({ "drafts.created_by_user_id": 1 });
  expect(report.affectedRows).toContainEqual({ table: "drafts", column: "created_by_user_id", rowIds: [1] });
});
it("moves only-source players and ownership, transfers identities and leaves FKs valid", () => {
  setup(); draft(1);
  mergeUsers({ db: f.db, apply: true }, 1, 2);
  expect(f.db.prepare("select user_id,discord_user_id from players where id=11").get()).toEqual({ user_id: 2, discord_user_id: "123" });
  expect(f.db.prepare("select clerk_user_id,discord_user_id from users where id=2").get()).toEqual({ clerk_user_id: "source_clerk", discord_user_id: "123" });
  expect(f.db.prepare("select created_by_user_id from drafts").get()).toEqual({ created_by_user_id: 2 });
  expect(f.db.prepare("select id from users where id=1").get()).toBeUndefined();
  expect(f.db.pragma("foreign_key_check")).toEqual([]);
  expect(f.db.pragma("foreign_keys", { simple: true })).toBe(1);
});
it("repoints composite draft parent and child FKs in a same-guild player merge", () => {
  setup(); f.player(22, 2); draft(1);
  f.db.exec("insert into draft_players(draft_id,player_id) values(1,11); insert into card_catalog(ygoprodeck_id,name,type,frame_type,image_url,image_url_small,card_sets_json,cached_at) values(1,'Card','Monster','normal','','','[]','now'); insert into draft_cards(id,draft_id,wave_number,catalog_card_id,picked_by_player_id) values(1,1,1,1,11); insert into draft_picks(draft_id,player_id,draft_card_id,wave_number,pick_step,picked_at) values(1,11,1,1,1,'now'); insert into draft_passes(draft_id,player_id,wave_number,pick_step,passed_at) values(1,11,1,2,'now');");
  const report = mergeUsers({ db: f.db, apply: true }, 1, 2);
  for (const [table, column] of [["draft_players", "player_id"], ["draft_cards", "picked_by_player_id"], ["draft_picks", "player_id"], ["draft_passes", "player_id"]]) {
    expect(f.db.prepare(`select ${column} as player from ${table}`).get()).toEqual({ player: 22 });
  }
  expect(f.db.prepare("select id from players where id=11").get()).toBeUndefined();
  expect(report.manualReview).toContainEqual({ table: "drafts", rowId: 1, path: "config_json.themeAssignments.11", sourcePlayerId: 11 });
  expect(f.db.prepare("select config_json from drafts").get()).toEqual({ config_json: '{"themeAssignments":{"11":"theme"}}' });
  expect(f.db.pragma("foreign_key_check")).toEqual([]);
});
it.each(["draft_players", "player_ratings", "season_standings", "player_achievements", "tournament_participants", "duel_seats"])("aborts without dropping colliding %s rows and names them", table => {
  setup(); f.player(22, 2); draft(1);
  if (table === "draft_players") f.db.exec("insert into draft_players(draft_id,player_id) values(1,11),(1,22)");
  if (table === "player_ratings") f.db.exec("insert into player_ratings(guild_id,player_id) values('guild',11),('guild',22)");
  if (table === "season_standings") f.db.exec("insert into seasons(id,guild_id,number,status) values(1,'guild',1,'active'); insert into season_standings(guild_id,season_id,player_id) values('guild',1,11),('guild',1,22)");
  if (table === "player_achievements") f.db.exec("insert into player_achievements(guild_id,player_id,achievement_key) values('guild',11,'win'),('guild',22,'win')");
  if (table === "tournament_participants") f.db.exec("insert into tournaments(id,guild_id,name,format,status,created_by_user_id) values(1,'guild','Cup','swiss','pending',1); insert into tournament_participants(tournament_id,player_id) values(1,11),(1,22)");
  if (table === "duel_seats") f.db.exec("insert into duels(id,guild_id,web_slug,name,mode,status,organizer_player_id) values(1,'guild','slug','Duel','1v1','waiting',11); insert into duel_seats(duel_id,seat,player_id) values(1,0,11),(1,1,22)");
  const before = f.checksum();
  try { mergeUsers({ db: f.db, apply: true }, 1, 2); throw new Error("Expected collision"); }
  catch (error) { expect(error).toMatchObject({ report: { conflicts: expect.arrayContaining([expect.objectContaining({ table, rowIds: [1, 2] })]) } }); }
  expect(f.checksum()).toBe(before);
  expect(f.db.pragma("foreign_keys", { simple: true })).toBe(1);
});
it.each(["clerk_user_id", "discord_user_id"])("refuses both identities with %s before writes", column => {
  setup(); f.db.prepare(`update users set ${column}=? where id=2`).run("456"); const before = f.checksum();
  expect(() => mergeUsers({ db: f.db, apply: true }, 1, 2)).toThrow(/both/i);
  expect(f.checksum()).toBe(before);
});
it("reports the exact player rows when compatibility Discord IDs would collide", () => {
  setup(); f.user(3); f.player(33, 3);
  f.db.exec("update players set discord_user_id='123' where id=33");
  const before = f.checksum();
  try { mergeUsers({ db: f.db, apply: true }, 1, 2); throw new Error("Expected collision"); }
  catch (error) { expect(error).toMatchObject({ report: { conflicts: expect.arrayContaining([expect.objectContaining({ table: "players", rowIds: [11, 33] })]) } }); }
  expect(f.checksum()).toBe(before);
});
it("aborts a saved-deck ownership collision on its partial unique index", () => {
  setup(); draft(1);
  f.db.exec("insert into saved_decks(guild_id,owner_user_id,name,mode,deck_json,draft_id) values('guild',1,'Source','1v1','{}',1),('guild',2,'Target','1v1','{}',1)");
  const before = f.checksum();
  try { mergeUsers({ db: f.db, apply: true }, 1, 2); throw new Error("Expected collision"); }
  catch (error) { expect(error).toMatchObject({ report: { conflicts: [{ table: "saved_decks", index: "saved_decks_owner_draft_idx", rowIds: [1, 2] }] } }); }
  expect(f.checksum()).toBe(before);
});
it("preserves tournament metadata winner IDs and reports them for manual review", () => {
  setup(); f.player(22, 2);
  f.db.exec("insert into tournaments(id,guild_id,name,format,status,created_by_user_id) values(1,'guild','Cup','swiss','pending',1); insert into tournament_matches(id,tournament_id,player_one_id,round_number,status,metadata_json) values(1,1,11,1,'complete','{\"winnerId\":11}')");
  const report = mergeUsers({ db: f.db, apply: true }, 1, 2);
  expect(report.manualReview).toContainEqual({ table: "tournament_matches", rowId: 1, path: "metadata_json.winnerId", sourcePlayerId: 11 });
  expect(f.db.prepare("select player_one_id,metadata_json from tournament_matches").get()).toEqual({ player_one_id: 22, metadata_json: '{"winnerId":11}' });
});
it("moves each guild's player correctly and repoints every match actor column", () => {
  setup(); f.player(12, 1, "other-guild"); f.player(22, 2);
  f.db.exec("insert into matches(id,guild_id,player_one_id,player_two_id,winner_id,reporter_id,approver_id,status,source) values(1,'guild',11,22,11,11,11,'confirmed','manual')");
  mergeUsers({ db: f.db, apply: true }, 1, 2);
  expect(f.db.prepare("select player_one_id,player_two_id,winner_id,reporter_id,approver_id from matches").get()).toEqual({ player_one_id: 22, player_two_id: 22, winner_id: 22, reporter_id: 22, approver_id: 22 });
  expect(f.db.prepare("select id,user_id from players order by id").all()).toEqual([{ id: 12, user_id: 2 }, { id: 22, user_id: 2 }]);
  expect(f.db.pragma("foreign_key_check")).toEqual([]);
});
it("rolls back earlier ownership writes if a later constraint aborts the merge", () => {
  setup(); draft(1);
  f.db.exec("create trigger refuse_merge before delete on users when old.id=1 begin select raise(abort,'private@example.test'); end");
  const before = f.checksum();
  expect(() => mergeUsers({ db: f.db, apply: true }, 1, 2)).toThrow(/rolled back/i);
  expect(f.checksum()).toBe(before);
  expect(f.db.pragma("defer_foreign_keys", { simple: true })).toBe(0);
  expect(f.db.pragma("foreign_key_check")).toEqual([]);
});
it("rejects a deferred FK violation before commit and reports the violating row", () => {
  setup();
  f.db.exec("create trigger introduce_fk_violation before delete on users when old.id=1 begin insert into player_ratings(guild_id,player_id) values('guild',9999); end");
  const before = f.checksum();
  try { mergeUsers({ db: f.db, apply: true }, 1, 2); throw new Error("Expected FK failure"); }
  catch (error) { expect(error).toMatchObject({ report: { foreignKeyViolations: [{ table: "player_ratings", rowid: 1, parent: "players", fkid: 0 }] } }); }
  expect(f.checksum()).toBe(before);
  expect(f.db.pragma("foreign_keys", { simple: true })).toBe(1);
  expect(f.db.pragma("foreign_key_check")).toEqual([]);
});
