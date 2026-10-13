import Database from "better-sqlite3";
import { afterEach, expect, it, vi } from "vitest";
import { migrate } from "../../src/db/schema.js";
import { seedUser } from "../helpers/identity.js";

const handles: Database.Database[] = [];
function legacy(enabled = 1) {
  const db = new Database(":memory:");
  handles.push(db);
  migrate(db);
  // Model an existing post-identity database with the old guild name constraint.
  const { sql } = db.prepare("select sql from sqlite_master where name = 'cubes'").get() as { sql: string };
  db.pragma("foreign_keys = off");
  db.exec(sql.replace(/create table (?:"cubes"|cubes)/i, "create table cubes_old_names")
    .replace(/unique\s*\(guild_id, created_by_user_id, name\)/i, "unique (guild_id, name)"));
  db.exec("drop table cubes; alter table cubes_old_names rename to cubes");
  db.pragma(`foreign_keys = ${enabled}`);
  const first = seedUser(db, "first").userId;
  const second = seedUser(db, "second").userId;
  db.prepare("insert into cubes(id,guild_id,name,created_by_user_id,archetype,banlist,config_json,created_at,updated_at) values (12,'g','Blue-Eyes',?,'Blue-Eyes','tcg','{\"copyLimit\":true}','2020-01-01','2020-01-02')").run(first);
  db.prepare("insert into cubes(id,guild_id,name,created_by_user_id) values (13,'other','Other',?)").run(second);
  db.exec("insert into card_catalog(ygoprodeck_id,name,type,frame_type,image_url,image_url_small,card_sets_json,cached_at) values(1,'Card','Normal Monster','normal','i','i','[]','t')");
  db.exec("insert into cube_cards(cube_id,catalog_card_id,pool,max_copies,source) values(12,1,'main',2,'list')");
  db.prepare("insert into players(id,guild_id,user_id,display_name) values(41,'g',?,'First')").run(first);
  db.prepare("insert into drafts(id,guild_id,name,status,created_by_user_id,config_json) values(51,'g','Draft','pending',?,'{\"mode\":\"theme\",\"allowedCubeIds\":[12]}')").run(first);
  db.exec("insert into draft_players(draft_id,player_id) values(51,41); insert into draft_player_cube(draft_id,player_id,cube_id) values(51,41,12)");
  db.exec("update sqlite_sequence set seq=900 where name='cubes'");
  return { db, first, second };
}
afterEach(() => {
  vi.restoreAllMocks();
  for (const db of handles.splice(0)) db.close();
});

it.each([0, 1])("migrates existing cubes without data loss and restores FK pragma %s", enabled => {
  const { db, first, second } = legacy(enabled);
  db.exec("alter table cubes add column private_note text; update cubes set private_note='keep'; create index custom_cube_note on cubes(private_note)");
  db.exec("create table cube_audit(cube_id integer); create trigger custom_cube_audit after update on cubes begin insert into cube_audit values(new.id); end");
  const tables = ["cubes", "cube_cards", "draft_player_cube", "drafts"];
  const snapshot = () => tables.map(table => db.prepare(`select * from ${table} order by rowid`).all());
  const before = snapshot();
  migrate(db);
  expect(snapshot()).toEqual(before);
  expect(db.pragma("foreign_key_check")).toEqual([]);
  expect(db.pragma("integrity_check", { simple: true })).toBe("ok");
  expect(db.pragma("foreign_keys", { simple: true })).toBe(enabled);
  const result = db.prepare("insert into cubes(guild_id,name,created_by_user_id) values('g','Blue-Eyes',?)").run(second);
  expect(Number(result.lastInsertRowid)).toBeGreaterThan(900);
  expect(() => db.prepare("insert into cubes(guild_id,name,created_by_user_id) values('g','Blue-Eyes',?)").run(first)).toThrow(/unique/i);
  expect(db.prepare("select name from sqlite_master where name='custom_cube_note'").get()).toBeDefined();
  db.exec("update cubes set private_note='changed' where id=12");
  expect(db.prepare("select * from cube_audit").all()).toEqual([{ cube_id: 12 }]);
  const after = snapshot();
  migrate(db);
  expect(snapshot()).toEqual(after);
  expect(db.prepare("select * from cube_audit").all()).toEqual([{ cube_id: 12 }]);
  expect(db.prepare("select name from sqlite_master where name='cubes_owner_names_new'").all()).toEqual([]);
});

it.each([0, 1])("rolls back a rebuild failure and restores FK pragma %s", enabled => {
  const { db, second } = legacy(enabled);
  const before = db.prepare("select * from cubes order by id").all();
  const sequence = db.prepare("select seq from sqlite_sequence where name='cubes'").get();
  const exec = db.exec.bind(db);
  vi.spyOn(db, "exec").mockImplementation(sql => {
    if (/drop table cubes\s*;/i.test(sql)) throw new Error("injected cube rebuild failure");
    return exec(sql);
  });
  expect(() => migrate(db)).toThrow("injected cube rebuild failure");
  expect(db.inTransaction).toBe(false);
  expect(db.pragma("foreign_keys", { simple: true })).toBe(enabled);
  expect(db.prepare("select * from cubes order by id").all()).toEqual(before);
  expect(db.prepare("select seq from sqlite_sequence where name='cubes'").get()).toEqual(sequence);
  expect(db.prepare("select name from sqlite_master where name='cubes_owner_names_new'").all()).toEqual([]);
  expect(() => db.prepare("insert into cubes(guild_id,name,created_by_user_id) values('g','Blue-Eyes',?)").run(second)).toThrow(/unique/i);
});

it("keeps an unknown owner's historical cube and its attachment", () => {
  const { db, second } = legacy();
  db.pragma("foreign_keys=off");
  db.exec("update cubes set created_by_user_id=999999 where id=12");
  db.pragma("foreign_keys=on");
  const violations = db.pragma("foreign_key_check");
  migrate(db);
  expect(db.pragma("foreign_key_check")).toEqual(violations);
  expect(db.prepare("select created_by_user_id from cubes where id=12").get()).toEqual({ created_by_user_id: 999999 });
  expect(db.prepare("select cube_id from draft_player_cube").get()).toEqual({ cube_id: 12 });
  expect(() => db.prepare("insert into cubes(guild_id,name,created_by_user_id) values('g','Blue-Eyes',?)").run(second)).not.toThrow();
});

it("creates owner name uniqueness on a fresh database and can run twice", () => {
  const db = new Database(":memory:");
  handles.push(db);
  migrate(db);
  migrate(db);
  const first = seedUser(db, "first").userId;
  const second = seedUser(db, "second").userId;
  const insert = db.prepare("insert into cubes(guild_id,name,created_by_user_id) values('g','Blue-Eyes',?)");
  insert.run(first);
  expect(() => insert.run(second)).not.toThrow();
  expect(() => insert.run(first)).toThrow(/unique/i);
  expect(db.pragma("foreign_key_check")).toEqual([]);
});
