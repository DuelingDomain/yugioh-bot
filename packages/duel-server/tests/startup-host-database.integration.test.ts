import { once } from "node:events";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { openDatabase } from "@yugidraft/shared/db";
import { createDuelService } from "@yugidraft/shared/services";
import { createDuelHost, type DuelHost } from "../src/host.js";
import { createHostDataFixture } from "./helpers/host-data-fixture.js";
import { seedIdentity } from "./helpers/identity.js";
import { holdStartupWrite } from "./helpers/startup-writer.js";

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
