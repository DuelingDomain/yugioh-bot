import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { migrate } from "../../src/db/index.js";
import { createDuelService } from "../../src/services/duels.js";
import { readStoredBoard, storedTurnCount } from "../../src/services/stored-duel-snapshots.js";
import { runDuelSnapshotRetention, duelSnapshotRetentionConfig } from "../../src/services/duel-snapshot-retention.js";
import { seedIdentity } from "../helpers/identity.js";
import { storedBoardFixture } from "../helpers/stored-board.js";

const databases: Database.Database[] = [];
const directories: string[] = [];
afterEach(() => { databases.splice(0).forEach(db => db.close()); directories.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true })); vi.unstubAllEnvs(); });
const now = Date.parse("2026-10-11T12:00:00Z");
function fixture(path = ":memory:") {
  const db = new Database(path); databases.push(db); db.pragma("foreign_keys=on"); migrate(db);
  seedIdentity(db, { guildId: "retention-test", playerId: 1, userId: 101 });
  return { db, duels: createDuelService(db) };
}
function row(db: Database.Database, format = "ffa4", status = "completed", kind = "play", ended = "2026-08-01 12:00:00") {
  const id = Number(db.prepare(`insert into duels(guild_id,web_slug,name,organizer_player_id,mode,format,status,kind,ended_at,
    snapshot_public_json,snapshot_seat0_json,snapshot_seat1_json,snapshot_seats_json)
    values('retention-test',?,'Fixture',1,'normal',?,?,?,?,?,?,?,?)`).run(`fixture-${Math.random()}`, format, status, kind, ended,
      JSON.stringify(storedBoardFixture()), JSON.stringify(storedBoardFixture("ffa4", 0)), JSON.stringify(storedBoardFixture("ffa4", 1)),
      JSON.stringify([0, 1, 2, 3].map(seat => storedBoardFixture("ffa4", seat)))).lastInsertRowid);
  db.prepare("insert into duel_seats(duel_id,seat,player_id) values(?,0,1)").run(id);
  return id;
}
const saved = (db: Database.Database, id: number) => db.prepare("select * from duels where id=?").get(id) as any;

it("compresses one bounded batch and resumes idempotently without dropping events or logs", async () => {
  const { db } = fixture();
  const ids = Array.from({ length: 3 }, () => row(db));
  const before = ids.map(id => readStoredBoard(saved(db, id), null));
  const first = await runDuelSnapshotRetention(db, { now, batchSize: 2, maxBatches: 1 });
  expect(first.compacted).toBe(2);
  expect(saved(db, ids[2]!).snapshot_compacted_at).toBeNull();
  expect(saved(db, ids[0]!)).toMatchObject({ snapshot_seat0_json: null, snapshot_seat1_json: null, turn_count: 40 });
  expect(Buffer.isBuffer(saved(db, ids[0]!).snapshot_public_json)).toBe(true);
  const second = await runDuelSnapshotRetention(db, { now, batchSize: 2, maxBatches: 1 });
  expect(second.compacted).toBe(1);
  const stable = ids.map(id => saved(db, id));
  expect((await runDuelSnapshotRetention(db, { now })).compacted).toBe(0);
  expect(ids.map(id => saved(db, id))).toEqual(stable);
  expect(ids.map(id => readStoredBoard(saved(db, id), null))).toEqual(before);
});
it("keeps 1v1 columns, incomplete seat lists, malformed bytes, recent and active rows", async () => {
  const { db } = fixture();
  const one = row(db, "1v1"), incomplete = row(db), malformed = row(db);
  db.prepare("update duels set snapshot_seats_json=null where id=?").run(one);
  db.prepare("update duels set snapshot_seats_json='[null,null]' where id=?").run(incomplete);
  db.prepare("update duels set snapshot_public_json='broken',snapshot_seats_json='broken' where id=?").run(malformed);
  const recent = row(db, "ffa4", "completed", "play", "2026-10-10 12:00:00"), active = row(db, "ffa4", "active");
  await runDuelSnapshotRetention(db, { now });
  expect(readStoredBoard(saved(db, one), 0)).not.toBeNull();
  expect(saved(db, incomplete).snapshot_seat0_json).not.toBeNull();
  expect(saved(db, malformed).snapshot_public_json).toBe("broken");
  expect(saved(db, malformed).snapshot_compacted_at).not.toBeNull();
  for (const id of [recent, active]) expect(saved(db, id).snapshot_compacted_at).toBeNull();
});
it("backfills numeric turns from plain, compressed, seat-list and clock values", async () => {
  const { gzipSync } = await import("node:zlib");
  const { db, duels } = fixture();
  for (const [column, value, count] of [
    ["snapshot_public_json", '{"turn":7}', 7], ["snapshot_seat0_json", gzipSync('{"turn":8}'), 8],
    ["snapshot_seats_json", '[null,null,{"seats":[],"turn":9}]', 9], ["clock_json", '{"turn":10}', 10],
  ] as const) {
    const id = row(db);
    db.prepare("update duels set snapshot_public_json=null,snapshot_seat0_json=null,snapshot_seat1_json=null,snapshot_seats_json=null where id=?").run(id);
    db.prepare(`update duels set ${column}=? where id=?`).run(value, id);
    expect(storedTurnCount(saved(db, id))).toBe(count);
    await runDuelSnapshotRetention(db, { now });
    expect(saved(db, id).turn_count).toBe(count);
    expect(duels.listHistory("retention-test", 1, { scope: "all" }).duels.find(d => d.id === id)?.turnCount).toBe(count);
  }
});
it.each(["0", "false"])("honors the environment kill switch (%s) before any writes", async disabled => {
  const { db } = fixture(); const id = row(db, "ffa4", "cancelled", "replay-fork"); const before = saved(db, id);
  vi.stubEnv("DUEL_SNAPSHOT_RETENTION_ENABLED", disabled);
  expect(await runDuelSnapshotRetention(db, { now })).toMatchObject({ compacted: 0, deletedForks: 0 });
  expect(saved(db, id)).toEqual(before);
});
it("stops between preparation and write if the kill switch changes", async () => {
  const { db } = fixture(); const id = row(db);
  await runDuelSnapshotRetention(db, { now, pause: async () => { vi.stubEnv("DUEL_SNAPSHOT_RETENTION_ENABLED", "0"); } });
  expect(saved(db, id).snapshot_compacted_at).toBeNull();
});
it("skips a concurrent restart instead of restoring old frozen boards", async () => {
  const { db } = fixture(); const id = row(db);
  await runDuelSnapshotRetention(db, { now, pause: async () => { db.prepare("update duels set status='active',ended_at=null,snapshot_public_json=null where id=?").run(id); } });
  expect(saved(db, id)).toMatchObject({ status: "active", snapshot_public_json: null, snapshot_compacted_at: null });
});
it("does not wait for a held write lock and restores the normal timeout", async () => {
  const dir = mkdtempSync(join(tmpdir(), "retention-lock-")); directories.push(dir);
  const { db } = fixture(join(dir, "test.sqlite")); db.pragma("journal_mode=WAL"); db.pragma("busy_timeout=5000"); const id = row(db);
  const lock = new Database(join(dir, "test.sqlite")); databases.push(lock); lock.exec("begin immediate");
  const before = performance.now();
  await runDuelSnapshotRetention(db, { now });
  expect(performance.now() - before).toBeLessThan(1000);
  expect(db.pragma("busy_timeout", { simple: true })).toBe(5000);
  lock.exec("rollback");
  expect(saved(db, id).snapshot_compacted_at).toBeNull();
  expect((await runDuelSnapshotRetention(db, { now })).compacted).toBe(1);
});
it("deletes only expired cancelled forks and cascades their own commands, seats and retry rows", async () => {
  const { db } = fixture(); const source = row(db), expired = row(db, "ffa4", "cancelled", "replay-fork");
  const recent = row(db, "ffa4", "cancelled", "replay-fork", "2026-10-05 12:00:00"), completed = row(db, "ffa4", "completed", "replay-fork"), active = row(db, "ffa4", "active", "replay-fork");
  const cancelledPlay = row(db, "ffa4", "cancelled");
  for (const id of [source, expired]) db.prepare("insert into duel_commands(duel_id,seq,seat,command_json) values(?,1,0,'{}')").run(id);
  db.prepare("insert into replay_fork_requests(owner_user_id,request_id,source_slug,source_version,cursor_digest,fork_duel_id) values(101,'retry','source','v','cursor',?)").run(expired);
  expect((await runDuelSnapshotRetention(db, { now, maxBatches: 1 })).deletedForks).toBe(1);
  expect(saved(db, expired)).toBeUndefined();
  expect(db.prepare("select * from duel_commands where duel_id=?").all(expired)).toEqual([]);
  expect(db.prepare("select * from duel_seats where duel_id=?").all(expired)).toEqual([]);
  expect(db.prepare("select * from replay_fork_requests").all()).toEqual([]);
  for (const id of [source, recent, completed, active, cancelledPlay]) expect(saved(db, id)).toBeDefined();
  expect(db.prepare("select * from duel_commands where duel_id=?").all(source)).toHaveLength(1);
  expect(db.pragma("foreign_key_check")).toEqual([]);
});
it("refuses fork deletion without foreign keys", async () => {
  const { db } = fixture(); const id = row(db, "ffa4", "cancelled", "replay-fork"); db.pragma("foreign_keys=off");
  await runDuelSnapshotRetention(db, { now });
  expect(saved(db, id)).toBeDefined();
});
it("uses bounded defaults and rejects invalid environment values", () => {
  vi.stubEnv("DUEL_SNAPSHOT_RETENTION_DAYS", "bad"); vi.stubEnv("DUEL_SNAPSHOT_RETENTION_INTERVAL_MS", "-1");
  expect(duelSnapshotRetentionConfig()).toMatchObject({ enabled: true, days: 30, intervalMs: 6 * 60 * 60 * 1000 });
  vi.stubEnv("DUEL_SNAPSHOT_RETENTION_DAYS", "45"); vi.stubEnv("DUEL_SNAPSHOT_RETENTION_INTERVAL_MS", "86400000");
  expect(duelSnapshotRetentionConfig()).toMatchObject({ days: 45, intervalMs: 86400000 });
});

it("rechecks cancelled status before deleting a fork selected before restart", async () => {
  const { db } = fixture(); const id = row(db, "ffa4", "cancelled", "replay-fork");
  await runDuelSnapshotRetention(db, { now, pause: async () => { db.prepare("update duels set status='active',ended_at=null where id=?").run(id); } });
  expect(saved(db, id)).toMatchObject({ status: "active", snapshot_compacted_at: null });
});
it("keeps incorrectly series-linked forks and bounds fork deletes per sweep", async () => {
  const { db } = fixture();
  const series = Number(db.prepare("insert into duel_series(guild_id,player0_id,player1_id,mode,settings_json,created_by_player_id) values('retention-test',1,1,'normal','{}',1)").run().lastInsertRowid);
  const linked = row(db, "ffa4", "cancelled", "replay-fork");
  db.prepare("update duels set series_id=? where id=?").run(series, linked);
  const forks = Array.from({ length: 3 }, () => row(db, "ffa4", "cancelled", "replay-fork"));
  expect((await runDuelSnapshotRetention(db, { now, batchSize: 2, maxBatches: 1 })).deletedForks).toBe(2);
  expect(saved(db, linked)).toBeDefined();
  expect(forks.filter(id => saved(db, id))).toHaveLength(1);
  expect((await runDuelSnapshotRetention(db, { now, batchSize: 2, maxBatches: 1 })).deletedForks).toBe(1);
});

it("preserves malformed nested seat data, stamps the row, and continues past it", async () => {
  const { db } = fixture(); const malformed = row(db), next = row(db);
  const raw = JSON.stringify(Array.from({ length: 4 }, () => ({ seats: [null], turn: 12 })));
  db.prepare("update duels set snapshot_seats_json=? where id=?").run(raw, malformed);
  const result = await runDuelSnapshotRetention(db, { now, batchSize: 1, maxBatches: 2 });
  expect(result.compacted).toBe(2);
  expect(saved(db, malformed).snapshot_compacted_at).not.toBeNull();
  expect(saved(db, malformed).snapshot_seat0_json).not.toBeNull();
  expect(saved(db, next).snapshot_compacted_at).not.toBeNull();
  const { decodeStoredSnapshot } = await import("../../src/services/stored-duel-snapshots.js");
  expect(decodeStoredSnapshot(saved(db, malformed).snapshot_seats_json)).toEqual(JSON.parse(raw));
});

it("rechecks foreign keys after yielding before a fork delete", async () => {
  const { db } = fixture(); const id = row(db, "ffa4", "cancelled", "replay-fork");
  await runDuelSnapshotRetention(db, { now, pause: async () => { db.pragma("foreign_keys=off"); } });
  expect(saved(db, id)).toBeDefined();
  expect(db.prepare("select * from duel_seats where duel_id=?").all(id)).toHaveLength(1);
});
