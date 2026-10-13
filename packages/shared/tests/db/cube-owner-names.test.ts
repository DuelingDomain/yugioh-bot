import Database from "better-sqlite3";
import { afterEach, expect, it, vi } from "vitest";
import { migrateCubeOwnerNames } from "../../src/db/cube-owner-names.js";
import { migrate } from "../../src/db/schema.js";

const handles: Database.Database[] = [];
function legacy(enabled = 1, statements?: string[]) {
  const db = new Database(":memory:", { verbose: sql => { statements?.push(String(sql)); } });
  handles.push(db);
  migrate(db);
  // Model an existing Discord database with the old guild name constraint.
  const { sql } = db.prepare("select sql from sqlite_master where name = 'cubes'").get() as { sql: string };
  db.pragma("foreign_keys = off");
  db.exec(sql.replace(/create table (?:"cubes"|cubes)/i, "create table cubes_old_names")
    .replace(/unique\s*\(guild_id, created_by_user_id, name\)/i, "unique (guild_id, name)"));
  db.exec("drop table cubes; alter table cubes_old_names rename to cubes");
  db.pragma(`foreign_keys = ${enabled}`);
  const first = "first";
  const second = "second";
  db.prepare("insert into cubes(id,guild_id,name,created_by_user_id,archetype,banlist,config_json,created_at,updated_at) values (12,'g','Blue-Eyes',?,'Blue-Eyes','tcg','{\"copyLimit\":true}','2020-01-01','2020-01-02')").run(first);
  db.prepare("insert into cubes(id,guild_id,name,created_by_user_id) values (13,'other','Other',?)").run(second);
  db.exec("insert into card_catalog(ygoprodeck_id,name,type,frame_type,image_url,image_url_small,card_sets_json,cached_at) values(1,'Card','Normal Monster','normal','i','i','[]','t')");
  db.exec("insert into cube_cards(cube_id,catalog_card_id,pool,max_copies,source) values(12,1,'main',2,'list')");
  db.prepare("insert into players(id,guild_id,discord_user_id,display_name) values(41,'g',?,'First')").run(first);
  db.prepare("insert into drafts(id,guild_id,channel_id,name,status,created_by_user_id,config_json) values(51,'g','test-channel','Draft','pending',?,'{\"mode\":\"theme\",\"allowedCubeIds\":[12]}')").run(first);
  db.exec("insert into draft_players(draft_id,player_id) values(51,41); insert into draft_player_cube(draft_id,player_id,cube_id) values(51,41,12)");
  db.exec("update sqlite_sequence set seq=900 where name='cubes'");
  return { db, first, second };
}
afterEach(() => {
  vi.restoreAllMocks();
  for (const db of handles.splice(0)) db.close();
});

it("limits rebuild validation to the cube tables", () => {
  const statements: string[] = [];
  const { db } = legacy(1, statements);
  statements.length = 0;
  migrateCubeOwnerNames(db);
  const checks = statements.filter(sql => /^pragma\s+(?:foreign_key_check|integrity_check|quick_check)\b/i.test(sql));
  expect(checks).toHaveLength(6);
  for (const table of ["cubes", "cube_cards", "draft_player_cube"]) {
    expect(checks.filter(sql => sql.toLowerCase() === `pragma foreign_key_check(${table})`)).toHaveLength(2);
  }
});

it.each(["cube_cards", "draft_player_cube"])("rolls back new foreign-key damage in %s", table => {
  const { db } = legacy();
  const snapshot = () => ["cubes", "cube_cards", "draft_player_cube", "sqlite_sequence"]
    .map(name => db.prepare(`select * from ${name} order by rowid`).all());
  const before = snapshot();
  const exec = db.exec.bind(db);
  vi.spyOn(db, "exec").mockImplementation(sql => {
    const result = exec(sql);
    if (/drop table cubes\s*;/i.test(sql)) {
      exec(`update ${table} set cube_id=999999`);
    }
    return result;
  });
  expect(() => migrateCubeOwnerNames(db)).toThrow("Cube name migration changed foreign keys");
  expect(db.inTransaction).toBe(false);
  expect(db.pragma("foreign_keys", { simple: true })).toBe(1);
  expect(snapshot()).toEqual(before);
  expect(db.prepare("select name from sqlite_master where name='cubes_owner_names_new'").all()).toEqual([]);
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
  expect(db.prepare("select created_by_user_id from cubes where id=12").get()).toEqual({ created_by_user_id: "999999" });
  expect(db.prepare("select cube_id from draft_player_cube").get()).toEqual({ cube_id: 12 });
  expect(() => db.prepare("insert into cubes(guild_id,name,created_by_user_id) values('g','Blue-Eyes',?)").run(second)).not.toThrow();
});

it("creates owner name uniqueness on a fresh database and can run twice", () => {
  const db = new Database(":memory:");
  handles.push(db);
  migrate(db);
  migrate(db);
  const first = "first";
  const second = "second";
  const insert = db.prepare("insert into cubes(guild_id,name,created_by_user_id) values('g','Blue-Eyes',?)");
  insert.run(first);
  expect(() => insert.run(second)).not.toThrow();
  expect(() => insert.run(first)).toThrow(/unique/i);
  expect(db.pragma("foreign_key_check")).toEqual([]);
});

it("keeps NULL owners and repairs duplicate legacy names without losing attachments", () => {
  const { db } = legacy();
  const { sql } = db.prepare("select sql from sqlite_master where name='cubes'").get() as { sql: string };
  db.pragma("foreign_keys=off");
  db.exec(sql.replace(/create table (?:"cubes"|cubes)/i, "create table cubes_nullable")
    .replace("created_by_user_id text not null", "created_by_user_id text")
    .replace(/,\s*unique\s*\(guild_id, name\)/i, ""));
  db.exec("insert into cubes_nullable select * from cubes; drop table cubes; alter table cubes_nullable rename to cubes");
  db.exec(`insert into cubes(id,guild_id,name,created_by_user_id) values
    (14,'g','Blue-Eyes','first'),(15,'g','Blue-Eyes (cube 14)','first'),
    (16,'g','Ownerless',null),(17,'g','Ownerless',null)`);
  db.pragma("foreign_keys=on");
  const rows = db.prepare("select * from cubes order by id").all() as Array<Record<string, unknown>>;
  migrate(db);
  const after = db.prepare("select * from cubes order by id").all() as Array<Record<string, unknown>>;
  expect(after).toHaveLength(rows.length);
  for (let index = 0; index < rows.length; index++) {
    const { name: beforeName, ...before } = rows[index];
    const { name: afterName, ...kept } = after[index];
    expect(kept).toEqual(before);
    if (before.id !== 14) expect(afterName).toBe(beforeName);
  }
  expect(after.find(row => row.id === 14)?.name).toBe("Blue-Eyes (cube 14) 2");
  expect(db.prepare("select cube_id from draft_player_cube").get()).toEqual({ cube_id: 12 });
  expect(db.prepare("select count(*) n from cube_cards").get()).toEqual({ n: 1 });
  expect(db.pragma("foreign_key_check")).toEqual([]);
  expect(db.pragma("foreign_keys", { simple: true })).toBe(1);
  migrate(db);
  expect(db.prepare("select * from cubes order by id").all()).toEqual(after);
});
