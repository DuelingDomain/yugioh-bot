import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { migrate } from "../../src/db/index.js";
import { createDuelService } from "../../src/services/duels.js";
import { readStoredBoard, storedTurnCount } from "../../src/services/stored-duel-snapshots.js";
import { runDuelSnapshotRetention, duelSnapshotRetentionConfig } from "../../src/services/duel-snapshot-retention.js";
import { seedIdentity } from "../helpers/identity.js";
import { storedBoardFixture } from "../helpers/stored-board.js";

const databases: Database.Database[] = [];
const directories: string[] = [];
afterEach(() => { databases.splice(0).forEach(db => db.close()); directories.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true })); vi.unstubAllEnvs(); vi.useRealTimers(); });
beforeEach(() => {
  vi.stubEnv("DUEL_SNAPSHOT_RETENTION_ENABLED", "1");
  vi.stubEnv("DUEL_TURN_BACKFILL_ENABLED", "1");
});
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

it("does not backfill a later row that restarts before its snapshot is fetched", async () => {
  const { db, duels } = fixture();
  vi.stubEnv("DUEL_SNAPSHOT_RETENTION_ENABLED", "0");
  row(db);
  const restarted = row(db, "ffa4", "interrupted");
  let changed = false;
  await runDuelSnapshotRetention(db, { now, pause: async milliseconds => {
    if (milliseconds !== 0 || changed) return;
    changed = true;
    db.prepare(`update duels set status='active',ended_at=null,turn_count=null,snapshot_compacted_at=null,
      snapshot_public_json=null,snapshot_seat0_json=null,snapshot_seat1_json=null,snapshot_seats_json=null,
      clock_json='{"turn":2}' where id=?`).run(restarted);
  } });
  expect(saved(db, restarted)).toMatchObject({ status: "active", turn_count: null, snapshot_compacted_at: null });
  duels.cancel(saved(db, restarted).web_slug, "retention-test", 1, 9);
  expect(saved(db, restarted).turn_count).toBe(9);
});

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
  const { db } = fixture(); const id = row(db, "ffa4", "cancelled", "replay-fork"); db.prepare("update duels set turn_count=40 where id=?").run(id); const before = saved(db, id);
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
  const stats = await runDuelSnapshotRetention(db, { now });
  expect(stats.busy).toBe(true);
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

it("defaults compression off but backfills recent turns without changing board storage", async () => {
  vi.stubEnv("DUEL_SNAPSHOT_RETENTION_ENABLED", undefined);
  expect(duelSnapshotRetentionConfig().enabled).toBe(false);
  const { db } = fixture(); const id = row(db, "ffa4", "completed", "play", "2026-10-10 12:00:00");
  db.prepare("update duels set snapshot_public_json=? where id=?").run('{"turn":8}', id);
  const before = saved(db, id);
  const stats = await runDuelSnapshotRetention(db, { now, pause: async () => {} });
  expect(stats).toMatchObject({ backfilled: 1, compacted: 0, deletedForks: 0 });
  expect(saved(db, id)).toEqual({ ...before, turn_count: 8 });
  expect(db.prepare("select typeof(snapshot_public_json) as storage from duels where id=?").get(id)).toEqual({ storage: "text" });
});
it("advances the turn-only cursor past rows with no turn in the same pass", async () => {
  vi.stubEnv("DUEL_SNAPSHOT_RETENTION_ENABLED", "0");
  const { db } = fixture(); const missing = row(db), next = row(db);
  db.prepare("update duels set snapshot_public_json=null,snapshot_seat0_json=null,snapshot_seat1_json=null,snapshot_seats_json=null where id=?").run(missing);
  const stats = await runDuelSnapshotRetention(db, { now, batchSize: 1, maxBatches: 2, pause: async () => {} });
  expect(stats.backfilled).toBe(1); expect(saved(db, missing).turn_count).toBeNull(); expect(saved(db, next).turn_count).toBe(40);
});
it("retains the turn cursor across passes and resets it only after an empty select", async () => {
  vi.stubEnv("DUEL_SNAPSHOT_RETENTION_ENABLED", "0");
  const { db } = fixture(); const unreadable = row(db), next = row(db);
  db.prepare("update duels set snapshot_public_json='broken',snapshot_seat0_json=null,snapshot_seat1_json=null,snapshot_seats_json=null where id=?").run(unreadable);
  const options = { now, batchSize: 1, maxBatches: 1, pause: async () => {} };
  const first = await runDuelSnapshotRetention(db, options);
  expect(first).toMatchObject({ backfilled: 0, turnCursor: unreadable, turnBackfillDone: false, backlogDone: false });
  const second = await runDuelSnapshotRetention(db, { ...options, turnCursor: first.turnCursor });
  expect(second).toMatchObject({ backfilled: 1, turnCursor: next, turnBackfillDone: false });
  expect(saved(db, next).turn_count).toBe(40);
  const third = await runDuelSnapshotRetention(db, { ...options, turnCursor: second.turnCursor });
  expect(third).toMatchObject({ turnCursor: 0, turnBackfillDone: true, backlogDone: true });
});
it("skips turn rows that have neither snapshots nor a clock", async () => {
  vi.stubEnv("DUEL_SNAPSHOT_RETENTION_ENABLED", "0");
  const { db } = fixture(); const empty = row(db), next = row(db);
  db.prepare("update duels set snapshot_public_json=null,snapshot_seat0_json=null,snapshot_seat1_json=null,snapshot_seats_json=null where id=?").run(empty);
  const stats = await runDuelSnapshotRetention(db, { now, batchSize: 1, maxBatches: 1, pause: async () => {} });
  expect(stats.backfilled).toBe(1); expect(saved(db, empty).turn_count).toBeNull(); expect(saved(db, next).turn_count).toBe(40);
});
it.each(["0", "false"])("disables turn backfill independently (%s) while allowing compaction", async disabled => {
  vi.stubEnv("DUEL_TURN_BACKFILL_ENABLED", disabled);
  const { db } = fixture(); const recent = row(db, "ffa4", "completed", "play", "2026-10-10 12:00:00"), old = row(db);
  expect(duelSnapshotRetentionConfig()).toMatchObject({ turnBackfillEnabled: false });
  const stats = await runDuelSnapshotRetention(db, { now, pause: async () => {} });
  expect(stats).toMatchObject({ backfilled: 0, compacted: 1, turnBackfillDone: true, backlogDone: true });
  expect(saved(db, recent).turn_count).toBeNull(); expect(saved(db, old).snapshot_compacted_at).not.toBeNull();
});
it("defaults backfill on and honors its switch between read and write", async () => {
  vi.stubEnv("DUEL_TURN_BACKFILL_ENABLED", undefined); vi.stubEnv("DUEL_SNAPSHOT_RETENTION_ENABLED", "0");
  expect(duelSnapshotRetentionConfig()).toMatchObject({ turnBackfillEnabled: true });
  const { db } = fixture(); const id = row(db); const before = saved(db, id);
  const stats = await runDuelSnapshotRetention(db, { now, pause: async () => { vi.stubEnv("DUEL_TURN_BACKFILL_ENABLED", "0"); } });
  expect(stats.backfilled).toBe(0); expect(saved(db, id)).toEqual(before);
});
it.each([3, 5])("keeps an unconsumed turn row for the next batch at the byte cap (row=%s MiB)", async mib => {
  vi.stubEnv("DUEL_SNAPSHOT_RETENTION_ENABLED", "0");
  const { db } = fixture(); const ids = Array.from({ length: 3 }, () => row(db, "1v1"));
  const raw = JSON.stringify({ turn: 8, payload: "x".repeat(mib * 1024 * 1024) });
  for (const id of ids) db.prepare("update duels set snapshot_public_json=?,snapshot_seat0_json=null,snapshot_seat1_json=null,snapshot_seats_json=null where id=?").run(raw, id);
  const prepare = db.prepare.bind(db); const reads: number[] = [];
  const spy = vi.spyOn(db, "prepare").mockImplementation(((sql: string) => {
    const statement = prepare(sql);
    if (/select id,format,status,kind,ended_at,clock_json/.test(sql)) {
      const get = statement.get.bind(statement);
      vi.spyOn(statement, "get").mockImplementation((...args: unknown[]) => { reads.push(args[0] as number); return get(...args); });
      vi.spyOn(statement, "all").mockImplementation(() => { throw new Error("Full-row bulk read"); });
    }
    return statement;
  }) as typeof db.prepare);
  try {
    const stats = await runDuelSnapshotRetention(db, { now, maxBatches: 2, pause: async () => {} });
    expect(stats.backfilled).toBe(2);
    expect(ids.map(id => saved(db, id).turn_count)).toEqual([8, 8, null]);
    expect(reads).toEqual(mib === 3 ? [ids[0], ids[1], ids[1], ids[2]] : [ids[0], ids[1]]);
  } finally { spy.mockRestore(); }
});
it("defers a busy turn write without consuming the row and restores the timeout", async () => {
  vi.stubEnv("DUEL_SNAPSHOT_RETENTION_ENABLED", "0");
  const dir = mkdtempSync(join(tmpdir(), "retention-turn-lock-")); directories.push(dir);
  const { db } = fixture(join(dir, "test.sqlite")); db.pragma("journal_mode=WAL"); db.pragma("busy_timeout=5000");
  const id = row(db); const beforeRow = saved(db, id);
  const lock = new Database(join(dir, "test.sqlite")); databases.push(lock); lock.exec("begin immediate");
  const before = performance.now(); const options = { now, batchSize: 1, maxBatches: 1, pause: async () => {} };
  const stats = await runDuelSnapshotRetention(db, options);
  expect(stats).toMatchObject({ busy: true, backfilled: 0, turnCursor: 0, backlogDone: false });
  expect(performance.now() - before).toBeLessThan(1000); expect(db.pragma("busy_timeout", { simple: true })).toBe(5000);
  expect(saved(db, id)).toEqual(beforeRow); lock.exec("rollback");
  expect((await runDuelSnapshotRetention(db, { ...options, turnCursor: stats.turnCursor })).backfilled).toBe(1);
});
it("does not write a stale turn after a fork restarts during the backfill pause", async () => {
  vi.stubEnv("DUEL_SNAPSHOT_RETENTION_ENABLED", "0");
  const { db } = fixture(); const id = row(db, "ffa4", "cancelled", "replay-fork");
  await runDuelSnapshotRetention(db, { now, pause: async () => {
    db.prepare("update duels set status='active',ended_at=null,turn_count=null where id=?").run(id);
  } });
  expect(saved(db, id)).toMatchObject({ status: "active", ended_at: null, turn_count: null, snapshot_compacted_at: null });
});
it("includes turn backfill in backlog completion even when compaction has no work", async () => {
  const { db } = fixture(); row(db, "ffa4", "completed", "play", "2026-10-10 12:00:00");
  row(db, "ffa4", "completed", "play", "2026-10-10 12:00:00");
  const stats = await runDuelSnapshotRetention(db, { now, batchSize: 1, maxBatches: 1, pause: async () => {} });
  expect(stats).toMatchObject({ backfilled: 1, compacted: 0, turnBackfillDone: false, backlogDone: false });
});
it("logs only the phase, name and code from a backfill error", async () => {
  vi.stubEnv("DUEL_SNAPSHOT_RETENTION_ENABLED", "0");
  const { db } = fixture(); row(db);
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  try {
    const error = Object.assign(new TypeError("Synthetic private payload"), { code: "SYNTHETIC_FAILURE" });
    await runDuelSnapshotRetention(db, { now, pause: async () => { throw error; } });
    expect(warn).toHaveBeenCalledWith("[duel] storage maintenance error", {
      phase: "turn-backfill", code: "SYNTHETIC_FAILURE", name: "TypeError",
    });
    expect(JSON.stringify(warn.mock.calls)).not.toContain(error.message);
  } finally { warn.mockRestore(); }
});
it.each([false, true])("isolates a failed backfill row read (busy=%s)", async busy => {
  vi.stubEnv("DUEL_SNAPSHOT_RETENTION_ENABLED", "0");
  const { db } = fixture(); const bad = row(db), good = row(db);
  const error = Object.assign(new Error("Synthetic read failure"), { code: busy ? "SQLITE_BUSY" : "SYNTHETIC_FAILURE" });
  const prepare = db.prepare.bind(db);
  const spy = vi.spyOn(db, "prepare").mockImplementation(((sql: string) => {
    const statement = prepare(sql);
    if (/select id,format,status,kind,ended_at,clock_json/.test(sql)) {
      const get = statement.get.bind(statement);
      vi.spyOn(statement, "get").mockImplementation((...args: unknown[]) => {
        if (args[0] === bad) throw error;
        return get(...args);
      });
    }
    return statement;
  }) as typeof db.prepare);
  const onError = vi.fn();
  try {
    const stats = await runDuelSnapshotRetention(db, { now, maxBatches: 1, onError, pause: async () => {} });
    expect(stats).toMatchObject({ busy, backfilled: busy ? 0 : 1, turnCursor: busy ? 0 : good });
    expect(saved(db, bad).turn_count).toBeNull();
    expect(saved(db, good).turn_count).toBe(busy ? null : 40);
    if (busy) expect(onError).not.toHaveBeenCalled();
    else expect(onError).toHaveBeenCalledExactlyOnceWith("turn-backfill", error);
  } finally { spy.mockRestore(); }
});
it("waits one hour after a turn scan wraps while allowing retention to continue", async () => {
  vi.stubEnv("DUEL_SNAPSHOT_RETENTION_ENABLED", "0");
  const { db } = fixture(); const unreadable = row(db, "1v1", "completed", "play", "2026-10-10 12:00:00");
  db.prepare("update duels set snapshot_public_json='broken',snapshot_seat0_json=null,snapshot_seat1_json=null,snapshot_seats_json=null where id=?").run(unreadable);
  vi.useFakeTimers(); vi.setSystemTime(now);
  const first = await runDuelSnapshotRetention(db, { pause: async () => { vi.setSystemTime(Date.now() + 1000); } });
  const resumeAt = now + 2000 + 60 * 60 * 1000;
  expect(first).toMatchObject({ turnCursor: 0, turnBackfillDone: true, turnBackfillResumeAt: resumeAt });
  db.prepare("update duels set snapshot_public_json=? where id=?").run('{"turn":8}', unreadable);
  const recent = row(db, "1v1", "completed", "play", "2026-10-10 12:00:00");
  const old = row(db); db.prepare("update duels set turn_count=40 where id=?").run(old);
  vi.stubEnv("DUEL_SNAPSHOT_RETENTION_ENABLED", "1");
  const spy = vi.spyOn(db, "prepare");
  try {
    const delayed = await runDuelSnapshotRetention(db, { now: resumeAt - 1, turnBackfillResumeAt: first.turnBackfillResumeAt, pause: async () => {} });
    expect(delayed).toMatchObject({ backfilled: 0, compacted: 1, turnCursor: 0, turnBackfillDone: true, turnBackfillResumeAt: resumeAt });
    expect(spy.mock.calls.filter(([sql]) => /select id from duels where turn_count/.test(sql))).toEqual([]);
  } finally { spy.mockRestore(); }
  expect(saved(db, unreadable).turn_count).toBeNull(); expect(saved(db, recent).turn_count).toBeNull();
  const resumed = await runDuelSnapshotRetention(db, { now: resumeAt, turnBackfillResumeAt: first.turnBackfillResumeAt, pause: async () => {} });
  expect(resumed).toMatchObject({ backfilled: 2, turnBackfillResumeAt: resumeAt + 60 * 60 * 1000 });
  expect(saved(db, unreadable).turn_count).toBe(8); expect(saved(db, recent).turn_count).toBe(40);
});
it.each([3, 5])("bounds full-row reads at the 4 MiB cap (row=%s MiB)", async mib => {
  const { db } = fixture(); const ids = Array.from({ length: 3 }, () => row(db, "1v1"));
  const raw = JSON.stringify({ turn: 8, payload: "x".repeat(mib * 1024 * 1024) });
  for (const id of ids) db.prepare("update duels set turn_count=8,snapshot_public_json=?,snapshot_seat0_json=null,snapshot_seat1_json=null,snapshot_seats_json=null where id=?").run(raw, id);
  const prepare = db.prepare.bind(db); let reads = 0;
  const spy = vi.spyOn(db, "prepare").mockImplementation(((sql: string) => {
    const statement = prepare(sql);
    if (/select id,format,status,kind,ended_at,clock_json/.test(sql)) {
      const get = statement.get.bind(statement);
      vi.spyOn(statement, "get").mockImplementation((...args: any[]) => { reads++; return get(...args); });
      vi.spyOn(statement, "all").mockImplementation(() => { throw new Error("Full-row bulk read"); });
    }
    return statement;
  }) as typeof db.prepare);
  try {
    const stats = await runDuelSnapshotRetention(db, { now, maxBatches: 1, pause: async () => {} });
    expect(stats.compacted).toBe(1); expect(reads).toBe(mib === 3 ? 2 : 1);
    expect(ids.filter(id => saved(db, id).snapshot_compacted_at !== null)).toEqual([ids[0]]);
  } finally { spy.mockRestore(); }
});
it("defers a fork delete on a writer lock and reports busy", async () => {
  const dir = mkdtempSync(join(tmpdir(), "retention-fork-lock-")); directories.push(dir);
  const { db } = fixture(join(dir, "test.sqlite")); db.pragma("journal_mode=WAL"); db.pragma("busy_timeout=5000");
  const id = row(db, "ffa4", "cancelled", "replay-fork"); db.prepare("update duels set turn_count=40 where id=?").run(id);
  const lock = new Database(join(dir, "test.sqlite")); databases.push(lock); lock.exec("begin immediate");
  const before = performance.now();
  const stats = await runDuelSnapshotRetention(db, { now, pause: async () => {} });
  expect(stats.busy).toBe(true); expect(stats.deletedForks).toBe(0); expect(performance.now() - before).toBeLessThan(1000);
  expect(db.pragma("busy_timeout", { simple: true })).toBe(5000); lock.exec("rollback"); expect(saved(db, id)).toBeDefined();
});
it("honors the kill switch between fork deletes", async () => {
  const { db } = fixture(); const ids = Array.from({ length: 2 }, () => row(db, "ffa4", "cancelled", "replay-fork"));
  const stats = await runDuelSnapshotRetention(db, { now, pause: async ms => { if (ms === 100 && !saved(db, ids[0]!)) vi.stubEnv("DUEL_SNAPSHOT_RETENTION_ENABLED", "0"); } });
  expect(stats.deletedForks).toBe(1); expect(ids.filter(id => saved(db, id))).toEqual([ids[1]]);
});
it("continues fork deletion and compaction after one non-busy fork error", async () => {
  const { db } = fixture(); const bad = row(db, "ffa4", "cancelled", "replay-fork"), good = row(db, "ffa4", "cancelled", "replay-fork"), play = row(db);
  db.exec(`create trigger reject_one_fork before delete on duels when old.id=${bad} begin select raise(abort,'Synthetic failure'); end`);
  const onError = vi.fn();
  const stats = await runDuelSnapshotRetention(db, { now, onError, pause: async () => {} });
  expect(onError).toHaveBeenCalled(); expect(stats.deletedForks).toBe(1); expect(saved(db, good)).toBeUndefined();
  expect(saved(db, bad)).toBeDefined(); expect(saved(db, play).snapshot_compacted_at).not.toBeNull();
});
it("continues compaction past a failing row", async () => {
  const { db } = fixture(); const bad = row(db), good = row(db);
  db.exec(`create trigger reject_one_compaction before update of snapshot_compacted_at on duels when old.id=${bad} begin select raise(abort,'Synthetic failure'); end`);
  const onError = vi.fn();
  const stats = await runDuelSnapshotRetention(db, { now, onError, batchSize: 1, maxBatches: 2, pause: async () => {} });
  expect(onError).toHaveBeenCalled(); expect(stats.compacted).toBe(1); expect(saved(db, good).snapshot_compacted_at).not.toBeNull();
});

it("backfills terminal sandbox turns with retention off and preserves recovery state", async () => {
  const { db } = fixture();
  vi.stubEnv("DUEL_SNAPSHOT_RETENTION_ENABLED", "0");
  const terminal = row(db, "ffa4", "interrupted"), active = row(db, "ffa4", "active");
  db.prepare("update duels set sandbox=1, setup_json=?, seed_json=?, bundle_version='sandbox-test' where id in (?,?)")
    .run(JSON.stringify({ sandbox: { board: {}, run: { bots: { 1: "manual" } } } }), '["1","2","3","4"]', terminal, active);
  const before = saved(db, terminal), activeBefore = saved(db, active);
  const stats = await runDuelSnapshotRetention(db, { now });
  expect(stats).toMatchObject({ backfilled: 1, compacted: 0, deletedForks: 0 });
  expect(saved(db, terminal)).toEqual({ ...before, turn_count: 40 });
  expect(saved(db, active)).toEqual(activeBefore);
});

it.each(["1v1", "ffa3", "ffa4", "tag"] as const)("compacts terminal %s sandbox boards without changing recovery data or deleting the sandbox", async format => {
  const { db } = fixture();
  const terminal = row(db, format, "cancelled"), active = row(db, format, "active");
  const setup = JSON.stringify({ sandbox: { board: {}, run: { bots: { 1: "manual" } } } });
  for (const id of [terminal, active]) {
    db.prepare("update duels set sandbox=1, setup_json=?, seed_json=?, bundle_version='sandbox-test', snapshot_public_json=?, snapshot_seat0_json=?, snapshot_seat1_json=?, snapshot_seats_json=? where id=?")
      .run(setup, '["1","2","3","4"]', JSON.stringify(storedBoardFixture(format)),
        JSON.stringify(storedBoardFixture(format, 0)), JSON.stringify(storedBoardFixture(format, 1)),
        format === "1v1" ? null : JSON.stringify(Array.from({ length: format === "ffa3" ? 3 : 4 }, (_, seat) => storedBoardFixture(format, seat))), id);
    db.prepare("insert into duel_commands(duel_id,seq,seat,command_json) values(?,1,0,'{}')").run(id);
  }
  const before = saved(db, terminal), activeBefore = saved(db, active);
  const commands = db.prepare("select * from duel_commands order by duel_id,seq").all();
  const views = Array.from({ length: format === "ffa3" ? 3 : format === "1v1" ? 2 : 4 }, (_, seat) => readStoredBoard(before, seat));
  const stats = await runDuelSnapshotRetention(db, { now });
  expect(stats).toMatchObject({ compacted: 1, deletedForks: 0 });
  const after = saved(db, terminal);
  expect(after).toMatchObject({ sandbox: 1, kind: "play", status: "cancelled", setup_json: before.setup_json,
    seed_json: before.seed_json, bundle_version: before.bundle_version, archived_at: before.archived_at });
  expect(Buffer.isBuffer(after.snapshot_public_json)).toBe(true);
  expect(views.map((_, seat) => readStoredBoard(after, seat))).toEqual(views);
  expect(db.prepare("select * from duel_commands order by duel_id,seq").all()).toEqual(commands);
  expect(saved(db, active)).toEqual(activeBefore);
});

it("deletes a finished deck-editor test duel after one day, with its rows, and keeps real duels and live test duels", async () => {
  const { db } = fixture();
  vi.stubEnv("DUEL_SNAPSHOT_RETENTION_ENABLED", "0");
  const mark = (id: number) => db.prepare(`update duels set setup_json='{"testDuel":true}' where id=?`).run(id);
  const oldTest = row(db, "1v1", "completed", "play", "2026-10-09 12:00:00");
  const recentTest = row(db, "1v1", "completed", "play", "2026-10-11 11:00:00");
  const activeTest = row(db, "1v1", "active", "play", "2026-10-01 12:00:00");
  const oldReal = row(db, "1v1", "completed", "play", "2026-10-09 12:00:00");
  for (const id of [oldTest, recentTest, activeTest]) mark(id);
  db.prepare("insert into duel_commands(duel_id,seq,seat,command_json) values(?,1,0,'{}')").run(oldTest);
  const stats = await runDuelSnapshotRetention(db, { now });
  expect(stats.deletedTestDuels).toBe(1);
  expect(saved(db, oldTest)).toBeUndefined();
  expect(db.prepare("select * from duel_commands where duel_id=?").all(oldTest)).toEqual([]);
  expect(db.prepare("select * from duel_seats where duel_id=?").all(oldTest)).toEqual([]);
  for (const id of [recentTest, activeTest, oldReal]) expect(saved(db, id)).toBeDefined();
});
