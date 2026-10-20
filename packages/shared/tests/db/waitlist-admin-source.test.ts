import Database from "better-sqlite3";
import { expect, it } from "vitest";
import { migrate } from "../../src/db/schema.js";

it.each([true, false])("upgrades the legacy waitlist source constraint without losing decisions or outbox links (foreign keys %s)", (foreignKeys) => {
  const db = new Database(":memory:");
  try {
    migrate(db);
    // Recreate the exact pre-admin table, including when this test runs against a new schema.
    const { sql } = db.prepare("select sql from sqlite_master where name='discord_waitlist_actions'").get() as { sql: string };
    db.pragma("foreign_keys = off");
    db.exec("drop table discord_waitlist_actions");
    db.exec(sql.replace(", 'admin'", ""));
    db.exec(`insert into discord_waitlist_actions(id,decision,source,created_at,channel_id,message_id)
      values('existing','approve','web',1,'alerts','message');
      insert into discord_outbox(idempotency_key,kind,operation,channel_id,message_id,payload_json,waitlist_action_id,available_at,created_at)
      values('edit','waitlist_decision','edit','alerts','message','{}','existing',1,1);
      insert into cubes(guild_id,name,created_by_user_id) values('g','Historical cube',999999);
      update discord_waitlist_actions set rowid=7,subject_user_id=999999 where id='existing';
      create index waitlist_message_test_idx on discord_waitlist_actions(message_id);`);
    const violations = db.pragma("foreign_key_check");
    const decisions = db.prepare("select * from discord_waitlist_actions").all();
    const outbox = db.prepare("select * from discord_outbox").all();
    db.pragma(`foreign_keys = ${foreignKeys ? "on" : "off"}`);
    migrate(db);
    migrate(db);
    expect(db.prepare("select * from discord_waitlist_actions").all()).toEqual(decisions);
    expect(db.prepare("select * from discord_outbox").all()).toEqual(outbox);
    expect(db.prepare("select name from sqlite_master where name='waitlist_message_test_idx'").get()).toBeDefined();
    db.prepare("insert into discord_waitlist_actions(id,source,created_at) values('admin-entry','admin',2)").run();
    expect(db.pragma("foreign_key_check")).toEqual(violations);
    expect(db.pragma("foreign_keys", { simple: true })).toBe(Number(foreignKeys));
    expect(() => db.prepare("insert into discord_waitlist_actions(id,source,created_at) values('bad','untrusted',2)").run()).toThrow();
  } finally { db.close(); }
});
