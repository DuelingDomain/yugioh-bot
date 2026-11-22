import Database from "better-sqlite3";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { rmSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { openDatabase } from "@yugidraft/shared/db";
import { retryStartupDatabase } from "../src/startup-database.js";
import { createHostDataFixture } from "./helpers/host-data-fixture.js";
import { holdStartupWrite } from "./helpers/startup-writer.js";

it("starts with EFFECT_SEARCH=0 and an old bridge graph after recovering from a database lock", async () => {
  const directory = createHostDataFixture([]);
  const path = join(directory, "bot.sqlite");
  const writer = openDatabase(path);
  writer.prepare("INSERT INTO bridge_graph(id,graph_json,source_version) VALUES(1,?,?)")
    .run(JSON.stringify({ groups: {} }), "old-without-engine-ranking");
  const reservation = createServer();
  reservation.listen(0, "127.0.0.1");
  await once(reservation, "listening");
  const port = (reservation.address() as { port: number }).port;
  await new Promise<void>((resolve, reject) => reservation.close(error => error ? reject(error) : resolve()));
  writer.exec("begin immediate");
  const child = spawn(process.execPath, ["--import", "tsx", "src/server.ts"], {
    cwd: new URL("../", import.meta.url),
    env: { ...process.env, DATABASE_PATH: path, DUEL_DATA_DIR: directory,
      DUEL_INTERNAL_HOST: "127.0.0.1", DUEL_INTERNAL_PORT: String(port), DUEL_1V1_ENGINE: "pinned",
      DUEL_INTERNAL_SECRET: "readiness-test", EFFECT_SEARCH: "0", DECK_SUGGESTIONS: "0",
      WS_INTERNAL_URL: "", WS_INTERNAL_SECRET: "", SENTRY_DSN: "" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const exited = once(child, "exit");
  let output = "";
  child.stdout.on("data", chunk => { output += chunk; });
  child.stderr.on("data", chunk => { output += chunk; });
  const url = `http://127.0.0.1:${port}/healthz`;
  try {
    await vi.waitFor(() => expect(output).toContain("startup database busy; retrying"), { timeout: 10_000 });
    await expect(fetch(url, { signal: AbortSignal.timeout(1000) })).rejects.toThrow();
    writer.exec("commit");
    await expect.poll(async () => {
      if (child.exitCode !== null) throw new Error(output);
      try { return (await fetch(url, { signal: AbortSignal.timeout(1000) })).status; }
      catch { return 0; }
    }, { timeout: 10_000 }).toBe(200);
    const response = await fetch(url);
    expect(await response.text()).toBe("ok\n");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(writer.prepare("SELECT json_type(graph_json,'$.engine_ranking') AS ranking FROM bridge_graph WHERE id=1").get())
      .toEqual({ ranking: null });
    // Readiness does not bypass authentication on the gameplay endpoint.
    expect((await fetch(`http://127.0.0.1:${port}/internal/duel`, { method: "POST", body: "{}" })).status).toBe(401);
  } finally {
    const deadline = setTimeout(() => child.kill("SIGKILL"), 7000);
    try {
      if (child.exitCode === null) child.kill("SIGTERM");
      await exited;
    } finally {
      clearTimeout(deadline);
      if (writer.inTransaction) writer.exec("rollback");
      writer.close();
      rmSync(directory, { recursive: true, force: true });
    }
  }
  expect(child.exitCode, output).toBe(0);
}, 25_000);

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

it("bounds retries on a persistent real lock and fails immediately on other SQLite errors", () => {
  const directory = createHostDataFixture([]);
  const db = openDatabase(join(directory, "bot.sqlite"));
  const writer = new Database(db.name);
  try {
    db.transaction(() => {
      expect(() => retryStartupDatabase("nested startup", () => db.prepare("select 1").get(), { db }))
        .toThrow("Startup database retries must run outside a transaction");
    })();
    db.pragma("busy_timeout = 0");
    writer.exec("begin immediate");
    const started = performance.now();
    expect(() => retryStartupDatabase("heartbeat", () => db.prepare("insert into duel_host_heartbeat values(1, 1)").run(), { db, timeoutMs: 100 }))
      .toThrowError(expect.objectContaining({ code: "SQLITE_BUSY" }));
    expect(performance.now() - started).toBeLessThan(1_000);
    expect(db.inTransaction).toBe(false);
    expect(() => retryStartupDatabase("invalid schema", () => db.prepare("select * from missing_startup_table").get(), { db }))
      .toThrowError(expect.objectContaining({ code: "SQLITE_ERROR" }));
  } finally {
    if (writer.inTransaction) writer.exec("rollback");
    writer.close(); db.close();
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
    }, { db });
    expect(attempts).toBe(2);
    expect(db.prepare("select last_tick_at from duel_host_heartbeat where id = 1").get()).toEqual({ last_tick_at: 3 });
    expect(db.inTransaction).toBe(false);
  } finally {
    writer.close(); db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
