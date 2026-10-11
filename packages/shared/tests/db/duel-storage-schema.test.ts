import Database from "better-sqlite3";
import { expect, it } from "vitest";
import { migrate } from "../../src/db/index.js";
import { seedIdentity } from "../helpers/identity.js";

it("adds nullable storage metadata and reruns without rewriting old boards", () => {
  const db = new Database(":memory:");
  try {
    db.pragma("foreign_keys=on"); db.pragma("busy_timeout=5000"); migrate(db);
    db.exec("drop index duels_snapshot_retention_idx");
    db.exec("alter table duels drop column turn_count");
    db.exec("alter table duels drop column snapshot_compacted_at");
    seedIdentity(db, { guildId: "storage-schema", playerId: 1, userId: 101 });
    const snapshots = ['{"seats":[],"turn":7}', '{"seats":[],"turn":8}', '{"seats":[],"turn":9}', '[{"seats":[]},{"seats":[]}]'];
    db.prepare(`insert into duels(guild_id,web_slug,name,organizer_player_id,mode,status,format,ended_at,
      snapshot_public_json,snapshot_seat0_json,snapshot_seat1_json,snapshot_seats_json)
      values('storage-schema','old-storage','Old',1,'normal','completed','ffa3','2020-01-01',?,?,?,?)`).run(...snapshots);
    migrate(db); migrate(db);
    const row = db.prepare("select snapshot_public_json,snapshot_seat0_json,snapshot_seat1_json,snapshot_seats_json,turn_count,snapshot_compacted_at from duels where web_slug='old-storage'").get() as any;
    expect(Object.values(row).slice(0, 4)).toEqual(snapshots);
    expect(row).toMatchObject({ turn_count: null, snapshot_compacted_at: null });
    expect(db.pragma("busy_timeout", { simple: true })).toBe(5000);
    expect(db.pragma("foreign_key_check")).toEqual([]);
    expect(db.prepare("pragma index_list(replay_fork_requests)").all()).toContainEqual(expect.objectContaining({ name: "replay_fork_requests_duel_idx" }));
  } finally { db.close(); }
});
