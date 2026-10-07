import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { afterEach, expect, it, vi } from "vitest";
import { migrate } from "../../src/db/schema.js";

const handles: Database.Database[] = [];
const names = ["players", "tournaments", "cubes", "drafts", "seasons", "saved_decks"] as const;
function legacy() {
  const db = new Database(":memory:");
  handles.push(db);
  db.exec(readFileSync(new URL("./fixtures/pre-identity.sql", import.meta.url), "utf8"));
  db.pragma("foreign_keys = on");
  return db;
}
function mixed(db: Database.Database) {
  db.exec(`
    insert into players(id,guild_id,discord_user_id,display_name,created_at) values
      (41,'g','900000000000000101','First','2020-01-01'),
      (42,'other','900000000000000101','Later','2021-01-01'),
      (43,'g','bot_player_dev_1','Bot 1','2020-01-02'),
      (44,'g','tournament_bot_dev_1','Tournament bot','2020-01-03'),
      (45,'g','fake_yugi','Yugi','2020-01-04');
    insert into tournaments(id,guild_id,name,format,status,created_by_user_id,web_slug)
      values(11,'g','Cup','round_robin','completed','900000000000000102','cup');
    insert into cubes(id,guild_id,name,created_by_user_id,config_json)
      values(12,'other','Pool','900000000000000101','{"copyLimit":true}');
    insert into drafts(id,guild_id,channel_id,name,status,created_by_user_id,web_slug,tournament_id,config_json)
      values(13,'g','channel','Draft','completed','900000000000000101','draft',11,'{"themeAssignments":{"41":12}}');
    insert into seasons(id,guild_id,number,status,created_by_user_id) values
      (14,'g',1,'ended',null),(15,'other',1,'ended','system');
    insert into saved_decks(id,guild_id,owner_user_id,name,mode,deck_json,draft_id)
      values(16,'g','900000000000000101','Deck','normal','{"main":[1],"extra":[],"side":[]}',13);
    insert into draft_players(draft_id,player_id) values(13,41);
    insert into tournament_participants(tournament_id,player_id,saved_deck_id,deck_json)
      values(11,41,16,'{"main":[1],"extra":[],"side":[]}');
    insert into duels(id,guild_id,web_slug,name,organizer_player_id,mode,status,snapshot_public_json)
      values(21,'g','duel','Duel',41,'normal','completed','{"seats":[41]}');
    insert into duel_seats(duel_id,seat,player_id) values(21,0,41);
    insert into waitlist_signups(id,email,created_at,source,user_agent)
      values(17,'marketing@example.com','2020-01-05','landing','test-agent');
    update sqlite_sequence set seq=900 where name in ('players','tournaments','cubes','drafts','seasons','saved_decks');
  `);
}
function count(db: Database.Database, table: string) {
  return (db.prepare(`select count(*) as n from ${table}`).get() as { n: number }).n;
}
afterEach(() => { vi.restoreAllMocks(); for (const db of handles.splice(0)) db.close(); });

it("creates the target on a fresh DB and migrates twice", () => {
  const db = new Database(":memory:"); handles.push(db);
  migrate(db); migrate(db);
  expect(db.pragma("table_info(players)")).toContainEqual(expect.objectContaining({ name: "user_id", type: "INTEGER", notnull: 1 }));
  expect(db.pragma("table_info(drafts)")).toContainEqual(expect.objectContaining({ name: "channel_id", notnull: 0 }));
  expect(db.pragma("foreign_key_check")).toEqual([]);
});
it("preserves IDs, all five owners, other guilds, decks and snapshots", () => {
  const db = legacy(); mixed(db);
  const before = names.map(name => count(db, name));
  const waitlist = db.prepare("select * from waitlist_signups").all();
  migrate(db);
  expect(names.map(name => count(db, name))).toEqual(before);
  expect(db.prepare("select * from waitlist_signups").all()).toEqual(waitlist);
  const human = db.prepare("select * from users where discord_user_id='900000000000000101'").get() as { id: number; display_name: string; email: null };
  expect(human).toMatchObject({ display_name: "First", email: null });
  expect(db.prepare("select id,user_id from players where id in (41,42) order by id").all()).toEqual([{ id: 41, user_id: human.id }, { id: 42, user_id: human.id }]);
  expect(db.prepare("select created_by_user_id from cubes where id=12").get()).toEqual({ created_by_user_id: human.id });
  expect(db.prepare("select created_by_user_id,config_json from drafts where id=13").get()).toEqual({ created_by_user_id: human.id, config_json: '{"themeAssignments":{"41":12}}' });
  expect(db.prepare("select owner_user_id,deck_json from saved_decks where id=16").get()).toEqual({ owner_user_id: human.id, deck_json: '{"main":[1],"extra":[],"side":[]}' });
  expect(db.prepare("select created_by_user_id from seasons where id=14").get()).toEqual({ created_by_user_id: null });
  expect(db.prepare("select u.discord_user_id from tournaments t join users u on u.id=t.created_by_user_id where t.id=11").get()).toEqual({ discord_user_id: "900000000000000102" });
  expect(db.prepare("select u.discord_user_id from seasons s join users u on u.id=s.created_by_user_id where s.id=15").get()).toEqual({ discord_user_id: null });
  expect(db.prepare("select p.id,u.discord_user_id from players p join users u on u.id=p.user_id where p.id>=43 order by p.id").all()).toEqual([43,44,45].map(id => ({ id, discord_user_id: null })));
  expect(db.prepare("select snapshot_public_json from duels where id=21").get()).toEqual({ snapshot_public_json: '{"seats":[41]}' });
  expect(db.pragma("foreign_key_check")).toEqual([]);
  expect(db.pragma("integrity_check", { simple: true })).toBe("ok");
  expect(db.pragma("foreign_keys", { simple: true })).toBe(1);
  for (const name of names) expect((db.prepare("select seq from sqlite_sequence where name=?").get(name) as { seq: number }).seq).toBeGreaterThanOrEqual(900);
  const snapshot = db.prepare("select * from users order by id").all();
  migrate(db);
  expect(db.prepare("select * from users order by id").all()).toEqual(snapshot);
});
it("rolls back an injected copy/drop failure and restores FK enforcement", () => {
  const db = legacy(); mixed(db);
  const original = db.exec.bind(db);
  vi.spyOn(db, "exec").mockImplementation(sql => {
    if (/drop table players\s*;/i.test(sql)) throw new Error("injected drop failure");
    return original(sql);
  });
  expect(() => migrate(db)).toThrow("injected drop failure");
  expect(db.inTransaction).toBe(false);
  expect(db.pragma("foreign_keys", { simple: true })).toBe(1);
  expect(db.pragma("table_info(players)")).not.toContainEqual(expect.objectContaining({ name: "user_id" }));
  expect(count(db, "players")).toBe(5);
  expect(db.prepare("select name from sqlite_master where name like '%_identity_new'").all()).toEqual([]);
});
it("rejects partial shape before historical backfill writes", () => {
  const db = legacy(); mixed(db);
  db.exec("alter table players add column user_id integer not null default 1");
  expect(() => migrate(db)).toThrow(/partial identity schema/i);
  expect(db.prepare("select deck_saved_at from draft_players").get()).toEqual({ deck_saved_at: null });
});
it.each(["alpha_invites", "access_events", "app_users"])("refuses nonempty S1 %s before mutation", table => {
  const db = legacy();
  db.exec(`create table ${table}(id integer); insert into ${table} values(1)`);
  expect(() => migrate(db)).toThrow(/S1.*not empty/i);
  expect(count(db, table)).toBe(1);
  expect(db.prepare("select name from sqlite_master where name='users'").get()).toBeUndefined();
});
it("drops only empty S1 tables", () => {
  const db = legacy();
  db.exec("create table alpha_invites(id); create table access_events(id); create table app_users(id)");
  migrate(db);
  expect(db.prepare("select name from sqlite_master where name in ('alpha_invites','access_events','app_users')").all()).toEqual([]);
});

it("uses numeric owners during repeated deck backfill", () => {
  const db = legacy(); mixed(db); migrate(db);
  db.exec("update draft_players set deck_saved_at=null where draft_id=13");
  migrate(db);
  expect((db.prepare("select deck_saved_at from draft_players where draft_id=13").get() as { deck_saved_at: string | null }).deck_saved_at).not.toBeNull();
});
it("never recreates a folded imported user on rerun", () => {
  const db = legacy(); mixed(db); migrate(db);
  const original = db.prepare("select id from users where discord_user_id='900000000000000102'").get() as { id: number };
  const survivor = db.prepare("select id from users where discord_user_id='900000000000000101'").get() as { id: number };
  db.prepare("update tournaments set created_by_user_id=? where created_by_user_id=?").run(survivor.id, original.id);
  db.prepare("delete from users where id=?").run(original.id);
  migrate(db);
  expect(db.prepare("select id from users where id=?").get(original.id)).toBeUndefined();
});
it("aborts on a source FK violation", () => {
  const db = legacy(); db.pragma("foreign_keys=off");
  db.exec("insert into draft_players(draft_id,player_id) values(999,999)");
  db.pragma("foreign_keys=on");
  expect(() => migrate(db)).toThrow(/foreign keys/i);
});
it.each(["alter table players add column private_note text", "create index custom_players_name on players(display_name)", "create trigger custom_players after insert on players begin select 1; end"])("refuses schema loss: %s", sql => {
  const db = legacy(); db.exec(sql);
  expect(() => migrate(db)).toThrow(/preserve explicitly/i);
});
it.each(["clerk:fake","unrecognized_actor","bot_player_dev_bad"])("aborts unknown actor key %s without allocating users",key=>{
  const db=legacy();
  db.prepare("insert into players(guild_id,discord_user_id,display_name) values('g',?,'Unknown')").run(key);
  expect(()=>migrate(db)).toThrow(/Unknown synthetic identity/);
  expect(db.prepare("select name from sqlite_master where name='users'").get()).toBeUndefined();
});
it("allocates seed-only owners and uses the deterministic fallback username",()=>{
  const db=legacy();
  db.exec("insert into players(guild_id,discord_user_id,display_name) values('g','900000000000000109','!!!'); insert into cubes(guild_id,name,created_by_user_id) values('g','Seed pool','seed')");
  migrate(db);
  const human=db.prepare("select id,username from users where discord_user_id='900000000000000109'").get() as {id:number;username:string};
  expect(human.username).toBe(`duelist_${human.id}`);
  expect(db.prepare("select u.discord_user_id from cubes c join users u on u.id=c.created_by_user_id").get()).toEqual({discord_user_id:null});
});
it("allocates above deleted-row sequence high-water", () => {
  const db = legacy(); mixed(db); migrate(db);
  const uid = (db.prepare("select user_id from players where id=41").get() as { user_id: number }).user_id;
  expect(Number(db.prepare("insert into players(guild_id,user_id,display_name) values('new',?,'New')").run(uid).lastInsertRowid)).toBeGreaterThan(900);
});
it.each([0,1])("restores original FK pragma %s on success", enabled => {
  const db = legacy(); db.pragma(`foreign_keys=${enabled}`); migrate(db);
  expect(db.pragma("foreign_keys", { simple: true })).toBe(enabled);
});

it("rejects an identity marker without players before creating historical tables", () => {
  const db = new Database(":memory:"); handles.push(db);
  db.exec("create table users(id integer primary key)");
  expect(() => migrate(db)).toThrow(/partial identity schema/i);
  expect(db.prepare("select name from sqlite_master where type='table'").all()).toEqual([{ name: "users" }]);
});

it("rejects a stranded replacement table before historical writes", () => {
  const db = legacy(); mixed(db);
  db.exec("create table players_identity_new(id integer)");
  expect(() => migrate(db)).toThrow(/partial identity schema/i);
  expect(db.prepare("select deck_saved_at from draft_players").get()).toEqual({ deck_saved_at: null });
});

it.each([0, 1])("restores original FK pragma %s and source rows on copy failure", enabled => {
  const db = legacy(); mixed(db); db.pragma(`foreign_keys=${enabled}`);
  // Historical migrations add lobby columns before the identity transaction.
  const columns = names.map(table => (db.pragma(`table_info(${table})`) as Array<{ name: string }>)
    .map(column => column.name).join(", "));
  const sourceRows = () => names.map((table, index) => db.prepare(`select ${columns[index]} from ${table} order by id`).all());
  const before = sourceRows();
  const sequence = db.prepare("select * from sqlite_sequence order by name").all();
  const original = db.exec.bind(db);
  vi.spyOn(db, "exec").mockImplementation(sql => {
    if (/insert into players_identity_new/i.test(sql)) throw new Error("injected copy failure");
    return original(sql);
  });
  expect(() => migrate(db)).toThrow("injected copy failure");
  expect(db.inTransaction).toBe(false);
  expect(db.pragma("foreign_keys", { simple: true })).toBe(enabled);
  expect(sourceRows()).toEqual(before);
  expect(db.prepare("select * from sqlite_sequence order by name").all()).toEqual(sequence);
  expect(db.prepare("select name from sqlite_master where name='users' or name like '%_identity_new'").all()).toEqual([]);
});
