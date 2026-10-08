import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { migrate } from "../../src/db/schema.js";

describe("draft visibility migration", () => {
  it("makes existing drafts private without changing their creator or seats, and is idempotent", () => {
    const db = new Database(":memory:");
    try {
      db.exec(readFileSync(new URL("./fixtures/pre-identity.sql", import.meta.url), "utf8"));
      db.exec(`insert into players(id,guild_id,discord_user_id,display_name) values(1,'g','900000000000000101','Host');
        insert into drafts(id,guild_id,channel_id,name,status,created_by_user_id) values(1,'g','c','Old','pending','900000000000000101');
        insert into draft_players(draft_id,player_id) values(1,1);`);
      migrate(db);
      expect(db.prepare("select visibility, invite_code from drafts").get()).toEqual({ visibility: "private", invite_code: null });
      expect(db.prepare("select d.created_by_user_id = p.user_id as same from drafts d join draft_players dp on dp.draft_id=d.id join players p on p.id=dp.player_id").get()).toEqual({ same: 1 });
      db.prepare("update drafts set visibility='open', invite_code='kept'").run();
      migrate(db);
      migrate(db);
      expect(db.prepare("select visibility, invite_code from drafts").get()).toEqual({ visibility: "open", invite_code: "kept" });
      expect(db.pragma("foreign_key_check")).toEqual([]);
    } finally { db.close(); }
  });

  it("enforces visibility, unique non-null codes and durable user grants with draft deletion cascade", () => {
    const db = new Database(":memory:");
    try {
      db.pragma("foreign_keys=on");
      migrate(db);
      db.exec("insert into users(id,username,display_name) values(1,'host','Host'),(2,'guest','Guest')");
      const insert = db.prepare("insert into drafts(guild_id,name,status,created_by_user_id) values('g',?,'pending',1)");
      insert.run("One"); insert.run("Two");
      expect(db.prepare("select visibility from drafts").all()).toEqual([{ visibility: "private" }, { visibility: "private" }]);
      expect(() => db.exec("update drafts set visibility='public' where id=1")).toThrow(/CHECK/);
      expect(() => db.exec("update drafts set visibility=null where id=1")).toThrow(/NOT NULL/);
      db.exec("update drafts set invite_code='unique' where id=1");
      expect(() => db.exec("update drafts set invite_code='unique' where id=2")).toThrow(/UNIQUE/);
      db.exec("insert into draft_invite_grants(draft_id,user_id) values(1,2)");
      expect(() => db.exec("insert into draft_invite_grants(draft_id,user_id) values(1,2)")).toThrow(/UNIQUE/);
      expect(() => db.exec("insert into draft_invite_grants(draft_id,user_id) values(1,999)")).toThrow(/FOREIGN KEY/);
      migrate(db);
      expect(db.prepare("select user_id, created_at from draft_invite_grants").get()).toEqual({ user_id: 2, created_at: expect.any(String) });
      db.exec("delete from drafts where id=1");
      expect(db.prepare("select * from draft_invite_grants").all()).toEqual([]);
    } finally { db.close(); }
  });
});
