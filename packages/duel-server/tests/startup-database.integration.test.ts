import Database from "better-sqlite3";
import { once } from "node:events";
import { rmSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { Worker } from "node:worker_threads";
import { expect, it } from "vitest";
import { openDatabase } from "@yugidraft/shared/db";
import { createDuelService } from "@yugidraft/shared/services";
import { createDuelHost, type DuelHost } from "../src/host.js";
import { retryStartupDatabase } from "../src/startup-database.js";
import { createHostDataFixture } from "./helpers/host-data-fixture.js";
import { seedIdentity } from "./helpers/identity.js";

// A separate thread must release the real file lock while better-sqlite3 blocks
// this thread. The timer starts only when the caller is about to attempt startup.
async function holdStartupWrite(path: string) {
  const worker = new Worker(`
    const { parentPort, workerData } = require('node:worker_threads');
    const Database = require(workerData.sqlite);
    const db = new Database(workerData.path);
    db.exec('begin immediate');
    db.prepare('insert or replace into worker_heartbeat(id, at, pid) values (1, ?, ?)').run(Date.now(), process.pid);
    parentPort.once('message', delay => setTimeout(() => {
      db.exec('commit'); db.close(); parentPort.postMessage('released'); parentPort.close();
    }, delay));
    parentPort.postMessage('locked');
  `, { eval: true, workerData: { path, sqlite: createRequire(import.meta.url).resolve("better-sqlite3") } });
  try { expect((await once(worker, "message"))[0]).toBe("locked"); }
  catch (error) { await worker.terminate(); throw error; }
  return worker;
}

it("starts the duel host and rebases clocks once after a startup writer exceeds the busy timeout", async () => {
  const directory = createHostDataFixture([]);
  const db = openDatabase(join(directory, "bot.sqlite"));
  const playerId = seedIdentity(db, { guildId: "g", name: "Host" }).playerId;
  const duels = createDuelService(db);
  const session = duels.create({ guildId: "g", organizerPlayerId: playerId, name: "Recover", mode: "normal" });
  const clock = { turn: 1, activeSeat: 0, startedAt: 900_000, remainingMs: [180_000, 180_000] };
  db.prepare("update duels set status = 'active', ranked = 1, clock_json = ? where id = ?").run(JSON.stringify(clock), session.id);
  db.prepare("insert into duel_host_heartbeat(id, last_tick_at) values (1, 950000)").run();
  const busyTimeout = db.pragma("busy_timeout", { simple: true }) as number;
  const writer = await holdStartupWrite(db.name);
  let host: DuelHost | undefined;
  try {
    const released = once(writer, "message");
    const started = performance.now();
    // The host's best-effort telemetry prune can use one full busy timeout
    // before clock recovery. Keep the writer locked past both waits.
    writer.postMessage(2 * busyTimeout + 1_250);
    host = createDuelHost({ db, dataDirectory: directory, secret: "startup-lock-test", searchCards: () => [],
      now: () => 1_000_000 + Math.floor(performance.now() - started), pollIntervalMs: 60_000 });
    expect(performance.now() - started).toBeGreaterThan(busyTimeout);
    expect((await released)[0]).toBe("released");
    const resumed = duels.privateState(session.slug, "g").clock!;
    expect(resumed).toEqual({ ...clock, startedAt: expect.any(Number), remainingMs: [130_000, 180_000] });
    // Waiting for startup writers is downtime, never time charged to a player.
    expect(resumed.startedAt).toBeGreaterThanOrEqual(1_000_000 + 2 * busyTimeout + 1_000);
    const heartbeat = db.prepare<[], { last_tick_at: number }>("select last_tick_at from duel_host_heartbeat where id = 1").get()!;
    expect(heartbeat.last_tick_at).toBeGreaterThanOrEqual(resumed.startedAt!);
    expect(db.pragma("busy_timeout", { simple: true })).toBe(busyTimeout);
    expect(db.inTransaction).toBe(false);
  } finally {
    await writer.terminate();
    await host?.close();
    db.close();
    rmSync(directory, { recursive: true, force: true });
  }
}, 20_000);

it("opens and migrates after another startup writer holds the file beyond five seconds", async () => {
  const directory = createHostDataFixture([]);
  const path = join(directory, "bot.sqlite");
  openDatabase(path).close();
  const writer = await holdStartupWrite(path);
  let db: Database.Database | undefined;
  try {
    const released = once(writer, "message");
    writer.postMessage(6_250);
    db = retryStartupDatabase("open and migrate", () => openDatabase(path));
    expect((await released)[0]).toBe("released");
    expect(db.prepare("select count(*) as n from worker_heartbeat").get()).toEqual({ n: 1 });
    expect(db.pragma("foreign_keys", { simple: true })).toBe(1);
    expect(db.pragma("busy_timeout", { simple: true })).toBe(5_000);
    expect(db.inTransaction).toBe(false);
  } finally {
    await writer.terminate();
    db?.close();
    rmSync(directory, { recursive: true, force: true });
  }
}, 15_000);

it("retries clearing a stale script auto-block during contended host startup", async () => {
  const directory = createHostDataFixture([{ code: 89631139, name: "Blue-Eyes White Dragon" }]);
  const db = openDatabase(join(directory, "bot.sqlite"));
  db.prepare(`insert into card_script_auto_blocks
    (code, reason, blocked_at, distinct_duels, error_count, threshold, window_days, bundle_version, script_hash)
    values (89631139, 'script_error', datetime('now'), 3, 3, 3, 7, 'old-bundle', 'old-hash')`).run();
  const writer = await holdStartupWrite(db.name);
  let host: DuelHost | undefined;
  try {
    const released = once(writer, "message");
    writer.postMessage(6_250);
    host = createDuelHost({ db, dataDirectory: directory, secret: "startup-block-test", searchCards: () => [], pollIntervalMs: 60_000 });
    expect((await released)[0]).toBe("released");
    expect(db.prepare("select cleared_at from card_script_auto_blocks where code = 89631139").get())
      .toEqual({ cleared_at: expect.any(String) });
    expect(db.inTransaction).toBe(false);
  } finally {
    await writer.terminate();
    await host?.close(); db.close();
    rmSync(directory, { recursive: true, force: true });
  }
}, 15_000);

it("bounds retries on a persistent real lock and fails immediately on other SQLite errors", () => {
  const directory = createHostDataFixture([]);
  const db = openDatabase(join(directory, "bot.sqlite"));
  const writer = new Database(db.name);
  try {
    db.pragma("busy_timeout = 0");
    writer.exec("begin immediate");
    const started = performance.now();
    expect(() => retryStartupDatabase("heartbeat", () => db.prepare("insert into duel_host_heartbeat values(1, 1)").run(), 100))
      .toThrowError(expect.objectContaining({ code: "SQLITE_BUSY" }));
    expect(performance.now() - started).toBeLessThan(1_000);
    expect(db.inTransaction).toBe(false);
    expect(() => retryStartupDatabase("invalid schema", () => db.prepare("select * from missing_startup_table").get()))
      .toThrowError(expect.objectContaining({ code: "SQLITE_ERROR" }));
  } finally {
    writer.exec("rollback"); writer.close(); db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

it("rolls back a stale WAL snapshot and retries the whole startup transaction", () => {
  const directory = createHostDataFixture([]);
  const db = openDatabase(join(directory, "bot.sqlite"));
  const writer = new Database(db.name);
  let attempts = 0;
  try {
    db.prepare("insert into duel_host_heartbeat values (1, 1)").run();
    retryStartupDatabase("snapshot recovery", () => {
      expect(db.inTransaction).toBe(false);
      db.transaction(() => {
        const row = db.prepare<[], { last_tick_at: number }>("select last_tick_at from duel_host_heartbeat where id = 1").get()!;
        // A real commit after the read makes the first transaction's snapshot
        // unwritable. The retry must read the new value after SQLite rolls back.
        if (attempts++ === 0) writer.prepare("update duel_host_heartbeat set last_tick_at = 2 where id = 1").run();
        db.prepare("update duel_host_heartbeat set last_tick_at = ? where id = 1").run(row.last_tick_at + 1);
      })();
    });
    expect(attempts).toBe(2);
    expect(db.prepare("select last_tick_at from duel_host_heartbeat where id = 1").get()).toEqual({ last_tick_at: 3 });
    expect(db.inTransaction).toBe(false);
  } finally {
    writer.close(); db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
