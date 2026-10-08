import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { migrate } from "../../src/db/schema.js";

describe("tournament visibility migration", () => {
  it("acquires an immediate write lock before the privacy migration reads or writes schema", () => {
    const statements: string[] = [];
    const db = new Database(":memory:", { verbose: sql => { statements.push(String(sql)); } });
    try {
      migrate(db);
      const grantTable = statements.findIndex(sql => /create table if not exists tournament_invite_grants/i.test(sql));
      expect(grantTable).toBeGreaterThan(0);
      expect(statements.slice(0, grantTable).filter(sql => /^BEGIN\b/i.test(sql)).at(-1)).toBe("BEGIN IMMEDIATE");
    } finally { db.close(); }
  });

  it("cascades a deleted user's grants while preserving the tournament and other users' grants", () => {
    const db = new Database(":memory:");
    try {
      db.pragma("foreign_keys=on"); migrate(db);
      db.exec(`insert into users(id,username,display_name) values(1,'host','Host'),(2,'guest','Guest'),(3,'other','Other');
        insert into tournaments(id,guild_id,name,format,status,created_by_user_id) values(1,'g','Tournament','round_robin','pending',1);
        insert into tournament_invite_grants(tournament_id,user_id) values(1,2),(1,3);
        delete from users where id=2;`);
      expect(db.prepare("select tournament_id,user_id from tournament_invite_grants").all()).toEqual([{ tournament_id: 1, user_id: 3 }]);
      expect(db.prepare("select id from tournaments").get()).toEqual({ id: 1 });
      expect(db.pragma("foreign_key_check")).toEqual([]);
    } finally { db.close(); }
  });
  it("makes existing tournaments private without changing their creator or seats, and is idempotent", () => {
    const db = new Database(":memory:");
    try {
      db.exec(readFileSync(new URL("./fixtures/pre-identity.sql", import.meta.url), "utf8"));
      db.exec(`insert into players(id,guild_id,discord_user_id,display_name) values(1,'g','900000000000000101','Host');
        insert into tournaments(id,guild_id,name,format,status,created_by_user_id) values(1,'g','Old','round_robin','pending','900000000000000101');
        insert into tournament_participants(tournament_id,player_id) values(1,1);`);
      migrate(db);
      expect(db.prepare("select visibility, invite_code from tournaments").get()).toEqual({ visibility: "private", invite_code: null });
      expect(db.prepare("select d.created_by_user_id = p.user_id as same from tournaments d join tournament_participants dp on dp.tournament_id=d.id join players p on p.id=dp.player_id").get()).toEqual({ same: 1 });
      db.prepare("update tournaments set visibility='open', invite_code='kept'").run();
      migrate(db);
      migrate(db);
      expect(db.prepare("select visibility, invite_code from tournaments").get()).toEqual({ visibility: "open", invite_code: "kept" });
      expect(db.pragma("foreign_key_check")).toEqual([]);
    } finally { db.close(); }
  });

  it("enforces visibility, unique non-null codes and durable user grants with tournament deletion cascade", () => {
    const db = new Database(":memory:");
    try {
      db.pragma("foreign_keys=on");
      migrate(db);
      db.exec("insert into users(id,username,display_name) values(1,'host','Host'),(2,'guest','Guest')");
      const insert = db.prepare("insert into tournaments(guild_id,name,format,status,created_by_user_id) values('g',?,'round_robin','pending',1)");
      insert.run("One"); insert.run("Two");
      expect(db.prepare("select visibility from tournaments").all()).toEqual([{ visibility: "private" }, { visibility: "private" }]);
      expect(() => db.exec("update tournaments set visibility='public' where id=1")).toThrow(/CHECK/);
      expect(() => db.exec("update tournaments set visibility=null where id=1")).toThrow(/NOT NULL/);
      db.exec("update tournaments set invite_code='unique' where id=1");
      expect(() => db.exec("update tournaments set invite_code='unique' where id=2")).toThrow(/UNIQUE/);
      db.exec("insert into tournament_invite_grants(tournament_id,user_id) values(1,2)");
      expect(() => db.exec("insert into tournament_invite_grants(tournament_id,user_id) values(1,2)")).toThrow(/UNIQUE/);
      expect(() => db.exec("insert into tournament_invite_grants(tournament_id,user_id) values(1,999)")).toThrow(/FOREIGN KEY/);
      migrate(db);
      expect(db.prepare("select user_id, created_at from tournament_invite_grants").get()).toEqual({ user_id: 2, created_at: expect.any(String) });
      db.exec("delete from tournaments where id=1");
      expect(db.prepare("select * from tournament_invite_grants").all()).toEqual([]);
    } finally { db.close(); }
  });
});
