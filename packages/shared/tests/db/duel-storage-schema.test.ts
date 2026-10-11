import Database from "better-sqlite3";
import { expect, it } from "vitest";
import { migrate } from "../../src/db/index.js";
import { seedIdentity } from "../helpers/identity.js";

it("adds nullable storage metadata and reruns without rewriting old boards", () => {
  const db = new Database(":memory:");
  try {
    db.pragma("foreign_keys=on"); db.pragma("busy_timeout=5000"); migrate(db);
    db.exec("drop index duels_snapshot_retention_idx");
    db.exec("drop index duels_cancelled_fork_retention_idx");
    db.exec("drop index replay_fork_requests_duel_idx");
    db.exec("alter table duels drop column turn_count");
    db.exec("alter table duels drop column snapshot_compacted_at");
    seedIdentity(db, { guildId: "storage-schema", playerId: 1, userId: 101 });
    const snapshots = ['{"seats":[],"turn":7}', '{"seats":[],"turn":8}', '{"seats":[],"turn":9}', '[{"seats":[]},{"seats":[]}]'];
    const insert = db.prepare(`insert into duels(guild_id,web_slug,name,organizer_player_id,mode,status,format,started_at,ended_at,
      snapshot_public_json,snapshot_seat0_json,snapshot_seat1_json,snapshot_seats_json)
      values('storage-schema',?,'Old',1,'normal','completed','ffa3','2019-12-31','2020-01-01',?,?,?,?)`);
    for (let index = 0; index < 107; index++) insert.run(`old-storage-${index}`, ...snapshots);
    const before = db.prepare("select * from duels order by id").all();
    const historyIndex = db.prepare("select sql from sqlite_schema where name='duels_play_history_idx'").get();
    migrate(db);
    const once = db.serialize();
    migrate(db);
    expect(db.serialize()).toEqual(once);
    const after = db.prepare("select * from duels order by id").all() as Array<Record<string, unknown>>;
    expect(after).toHaveLength(107);
    expect(after.map(({ turn_count, snapshot_compacted_at, ...old }) => {
      expect(turn_count).toBeNull(); expect(snapshot_compacted_at).toBeNull(); return old;
    })).toEqual(before);
    expect(db.prepare("select sql from sqlite_schema where name='duels_play_history_idx'").get()).toEqual(historyIndex);
    const row = db.prepare("select snapshot_public_json,snapshot_seat0_json,snapshot_seat1_json,snapshot_seats_json,turn_count,snapshot_compacted_at from duels where web_slug='old-storage-0'").get() as any;
    expect(Object.values(row).slice(0, 4)).toEqual(snapshots);
    expect(row).toMatchObject({ turn_count: null, snapshot_compacted_at: null });
    expect(db.pragma("busy_timeout", { simple: true })).toBe(5000);
    expect(db.pragma("foreign_key_check")).toEqual([]);
    expect(db.prepare("pragma index_list(replay_fork_requests)").all()).toContainEqual(expect.objectContaining({ name: "replay_fork_requests_duel_idx" }));
  } finally { db.close(); }
});

it("requires every foreign key to duels to cascade and keeps retention selects indexed", () => {
  const db = new Database(":memory:");
  try {
    db.pragma("foreign_keys=on"); migrate(db);
    const tables = db.prepare("select name from sqlite_schema where type='table'").all() as { name: string }[];
    let references = 0;
    for (const { name } of tables) {
      const keys = db.prepare(`pragma foreign_key_list("${name.replaceAll('"', '""')}")`).all() as { table: string; on_delete: string }[];
      for (const key of keys.filter(key => key.table === "duels")) { references++; expect(key.on_delete, name).toBe("CASCADE"); }
    }
    expect(references).toBeGreaterThanOrEqual(4);
    const plan = (sql: string) => db.prepare(`explain query plan ${sql}`).all("2026-01-01", 50);
    expect(plan("select id,web_slug from duels where kind='replay-fork' and status='cancelled' and series_id is null and julianday(ended_at)<julianday(?) order by julianday(ended_at),id limit ?"))
      .toContainEqual(expect.objectContaining({ detail: expect.stringContaining("duels_cancelled_fork_retention_idx") }));
    expect(plan("select id from duels where snapshot_compacted_at is null and status in ('completed','interrupted','cancelled') and julianday(ended_at)<julianday(?) order by julianday(ended_at),id limit ?"))
      .toContainEqual(expect.objectContaining({ detail: expect.stringContaining("duels_snapshot_retention_idx") }));
  } finally { db.close(); }
});
