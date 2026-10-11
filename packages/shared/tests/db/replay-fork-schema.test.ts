import Database from "better-sqlite3";
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { migrate } from "../../src/db/schema.js";
import { createDuelService } from "../../src/services/duels.js";
import { seedIdentity } from "../helpers/identity.js";

const databases: Database.Database[] = [];
const directories: string[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function database() {
  const db = new Database(":memory:");
  databases.push(db);
  db.pragma("foreign_keys = on");
  migrate(db);
  const owner = seedIdentity(db);
  return { db, owner };
}

describe("replay fork schema", () => {
  it("defaults existing duels to play and keeps the migration idempotent", () => {
    const { db, owner } = database();
    const old = createDuelService(db).create({ guildId: "g", organizerPlayerId: owner.playerId, name: "Old", mode: "normal" });
    db.exec("drop trigger if exists duels_kind_immutable");
    const columns = db.pragma("table_info(duels)") as Array<{ name: string }>;
    if (columns.some(column => column.name === "kind")) db.exec("alter table duels drop column kind");
    migrate(db);
    migrate(db);
    expect(db.prepare("select kind from duels where id = ?").get(old.id)).toEqual({ kind: "play" });
    expect(db.prepare("select seat, player_id from duel_seats where duel_id = ?").all(old.id))
      .toEqual([{ seat: 0, player_id: owner.playerId }]);
    expect(db.pragma("foreign_key_check")).toEqual([]);
  });

  it("migrates a copied pre-change schema with synthetic history without changing existing rows", () => {
    const directory = mkdtempSync(join(tmpdir(), "replay-migration-")); directories.push(directory);
    const originalPath = join(directory, "before.sqlite"), copyPath = join(directory, "copy.sqlite");
    const original = new Database(originalPath); databases.push(original);
    original.pragma("foreign_keys = on");
    original.exec(readFileSync(new URL("../fixtures/replay-pre-kind-schema.sql", import.meta.url), "utf8"));
    original.exec(`
      insert into players(id,guild_id,discord_user_id,display_name) values(11,'g',101,'Synthetic A'),(12,'g',102,'Synthetic B');
      insert into tournaments(id,guild_id,name,format,status,created_by_user_id,web_slug)
        values(1,'g','Synthetic cup','round_robin','completed',101,'old-cup');
      insert into matches(id,guild_id,player_one_id,player_two_id,winner_id,reporter_id,approver_id,status,source,tournament_id)
        values(1,'g',11,12,11,11,12,'confirmed','tournament',1);
      insert into tournament_matches(id,tournament_id,match_id,player_one_id,player_two_id,round_number,status)
        values(1,1,1,11,12,1,'complete');
      insert into duel_series(id,guild_id,player0_id,player1_id,created_by_player_id,mode,settings_json,status,match_id,tournament_match_id)
        values(1,'g',11,12,11,'normal','{}','completed',1,1);
      insert into duels(id,guild_id,web_slug,name,organizer_player_id,mode,status,series_id,game_number,seed_json,bundle_version,
        setup_json,winner_player_id,winner_seat,ended_at,archived_at,snapshot_public_json)
        values(1,'g','old-completed','Synthetic finished',11,'normal','completed',1,1,'["1","2","3","4"]','old-bundle',
          '{"engine":"legacy"}',11,0,'2026-10-01','2026-10-02','{"revision":7}'),
          (2,'g','old-active','Synthetic active',12,'normal','active',null,null,'["5","6","7","8"]','old-bundle',
          null,null,null,null,null,null),
          (3,'g','old-interrupted','Synthetic interrupted',11,'domain','interrupted',null,null,'["9","10","11","12"]','old-bundle',
          '{}',null,null,'2026-10-03',null,null);
      insert into duel_seats(duel_id,seat,player_id,ready,deck_json)
        values(1,0,11,1,'{"main":[1],"extra":[],"side":[]}'),(1,1,12,1,'{"main":[2],"extra":[],"side":[]}'),(2,0,12,1,'{"main":[3]}'),(3,0,11,1,'{"main":[4]}');
      insert into duel_commands(duel_id,seq,seat,command_json,created_at)
        values(1,2,0,'{"promptId":"p1","revision":1,"answer":{"choice":0}}','2026-10-01'),
          (1,8,1,'{"promptId":"p2","revision":2,"answer":{}}','2026-10-01'),
          (3,5,0,'{"promptId":"p3","revision":3,"answer":{}}','2026-10-03');
    `);
    const tables = ["players", "tournaments", "matches", "tournament_matches", "duel_series", "duels", "duel_seats", "duel_commands"];
    const snapshot = (db: Database.Database) => Object.fromEntries(tables.map(table =>
      [table, db.prepare(`select * from ${table} order by rowid`).all()]));
    const before = snapshot(original);
    expect(original.pragma("table_info(duels)")).not.toContainEqual(expect.objectContaining({ name: "kind" }));
    expect(original.pragma("foreign_key_check")).toEqual([]);
    original.close();
    copyFileSync(originalPath, copyPath);
    const copied = new Database(copyPath); databases.push(copied); copied.pragma("foreign_keys = on");
    migrate(copied);
    const once = copied.serialize();
    migrate(copied);
    expect(copied.serialize()).toEqual(once);
    const after = snapshot(copied);
    after.duels = (after.duels as Array<Record<string, unknown>>).map(({ kind, ...row }) => {
      expect(kind).toBe("play");
      const { sandbox: _sandbox, ...beforeRow } = row;
      return beforeRow;
    });
    expect(after).toEqual(before);
    expect(copied.prepare("select count(*) as n from replay_fork_requests").get()).toEqual({ n: 0 });
    expect(copied.pragma("foreign_key_check")).toEqual([]);
    expect(copied.pragma("integrity_check")).toEqual([{ integrity_check: "ok" }]);
    const unchanged = new Database(originalPath, { readonly: true }); databases.push(unchanged);
    expect(snapshot(unchanged)).toEqual(before);
    expect(unchanged.pragma("table_info(duels)")).not.toContainEqual(expect.objectContaining({ name: "kind" }));
  });

  it("accepts only known kinds at insert and never changes a stored kind", () => {
    const { db, owner } = database();
    const insert = db.prepare(`insert into duels(guild_id,web_slug,name,organizer_player_id,mode,status,kind)
      values('g',?,'Fixture',?,'normal','active',?)`);
    expect(() => insert.run("bad", owner.playerId, "unknown")).toThrow(/CHECK/);
    expect(() => insert.run("null", owner.playerId, null)).toThrow(/NOT NULL/);
    insert.run("play", owner.playerId, "play");
    insert.run("fork", owner.playerId, "replay-fork");
    expect(() => db.exec("update duels set kind = 'play' where web_slug = 'fork'")).toThrow(/immutable/);
    expect(() => db.exec("update duels set kind = 'replay-fork' where web_slug = 'play'")).toThrow(/immutable/);
    db.exec("update duels set kind = kind");
  });

  it("stores one request per owner and does not link the source slug by foreign key", () => {
    const { db, owner } = database();
    const duels = createDuelService(db);
    const fork = duels.create({ guildId: "g", organizerPlayerId: owner.playerId, name: "Fixture", mode: "normal" });
    const insert = db.prepare(`insert into replay_fork_requests(owner_user_id,request_id,source_slug,source_version,cursor_digest,fork_duel_id)
      values(?,?,?,?,?,?)`);
    insert.run(owner.userId, "request-1", "deleted-source", "version-1", "a".repeat(64), fork.id);
    expect(() => insert.run(owner.userId, "request-1", "other", "version-2", "b".repeat(64), fork.id)).toThrow(/UNIQUE/);
    expect(db.pragma("foreign_key_list(replay_fork_requests)")).not.toContainEqual(expect.objectContaining({ from: "source_slug" }));
    expect(db.pragma("foreign_key_check")).toEqual([]);
    db.prepare("delete from duels where id = ?").run(fork.id);
    expect(db.prepare("select * from replay_fork_requests").all()).toEqual([]);
  });
});
