import { spawn } from "node:child_process";
import { readSignedRequest } from "@yugidraft/shared/internal-auth";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { openDatabase } from "@yugidraft/shared/db";
import { createDraftService, createPlayerService } from "@yugidraft/shared/services";

function startWorker(root: string, extra: NodeJS.ProcessEnv = {}, imports: string[] = []) {
  const health = join(root, "health.json");
  const child = spawn(process.execPath, ["--import", fileURLToPath(new URL("./helpers/genesys-fetch.mjs", import.meta.url)), ...imports.flatMap(path => ["--import", path]), fileURLToPath(new URL("../dist/index.js", import.meta.url))], {
    cwd: root,
    env: {
      PATH: process.env.PATH, DATABASE_PATH: join(root, "test.sqlite"),
      CARD_IMAGE_CACHE_DIR: join(root, "images"), WORKER_HEALTH_PATH: health,
      DOTENV_CONFIG_PATH: join(root, "absent.env"), DISCORD_BOT_ENABLED: "0",
      WS_INTERNAL_URL: "", WS_INTERNAL_SECRET: "", ...extra,
    },
    stdio: "pipe",
  });
  let output = "";
  child.stdout.on("data", bytes => { output += bytes; });
  child.stderr.on("data", bytes => { output += bytes; });
  let stopped = false;
  const exit = new Promise<{code: number | null; error?: Error}>(resolve => {
    child.once("error", error => { stopped = true; resolve({code: null, error}); });
    child.once("close", code => { stopped = true; resolve({code}); });
  });
  return { child, health, exit, stopped: () => stopped, output: () => output };
}

async function until(predicate: () => boolean, milliseconds = 5000) {
  const deadline = Date.now() + milliseconds;
  while (!predicate() && Date.now() < deadline) await delay(20);
  expect(predicate()).toBe(true);
}

it.each(["0", "1"])("flushes heartbeat cleanup errors on the real SIGTERM path (blocked flush %s)", async blocked => {
  const root = mkdtempSync(join(tmpdir(), "worker-cleanup-"));
  const db = openDatabase(join(root, "test.sqlite"));
  db.prepare("insert into card_sets(set_name,synced_at) values('Seed',current_timestamp)").run();
  db.close();
  const output = join(root, "observability.jsonl");
  const worker = startWorker(root, {
    SENTRY_DSN: "configured", WORKER_OBSERVABILITY_OUTPUT: output, WORKER_FLUSH_BLOCK: blocked,
    WORKER_HEALTH_CLEANUP_ERROR: "1",
  }, [fileURLToPath(new URL("./helpers/shutdown-observability.mjs", import.meta.url))]);
  try {
    await until(() => existsSync(worker.health) || worker.stopped());
    expect(existsSync(worker.health), worker.output()).toBe(true);
    const signalledAt = Date.now();
    worker.child.kill("SIGTERM");
    await until(worker.stopped);
    expect(await worker.exit).toEqual({ code: 1 });
    const flushes = readFileSync(output, "utf8").trim().split("\n").map(line => JSON.parse(line));
    expect(flushes).toHaveLength(2);
    expect(flushes[0]).toEqual({ timeout: 2000, errors: [] });
    expect(flushes[1]).toMatchObject({ timeout: 2000, errors: [{ code: "ERR_FS_EISDIR" }] });
    if (blocked === "1") expect(Date.now() - signalledAt).toBeGreaterThanOrEqual(1900);
  } finally {
    if (!worker.stopped()) worker.child.kill("SIGKILL");
    await worker.exit;
    rmSync(root, { recursive: true, force: true });
  }
}, 10000);

it("SIGTERM removes the heartbeat before a clean process exit", async () => {
  const root = mkdtempSync(join(tmpdir(), "worker-process-"));
  const db = openDatabase(join(root, "test.sqlite"));
  db.prepare("insert into card_sets(set_name,synced_at) values('Seed',current_timestamp)").run();
  db.close();
  const worker = startWorker(root);
  try {
    await until(() => existsSync(worker.health) || worker.stopped());
    expect(existsSync(worker.health), worker.output()).toBe(true);
    expect(JSON.parse(readFileSync(worker.health, "utf8")).pid).toBe(worker.child.pid);
    worker.child.kill("SIGTERM");
    await until(worker.stopped);
    expect(await worker.exit).toEqual({code: 0});
    expect(existsSync(worker.health)).toBe(false);
    const check = openDatabase(join(root, "test.sqlite"));
    try { expect(check.pragma("integrity_check")).toEqual([{integrity_check: "ok"}]); }
    finally { check.close(); }
  } finally {
    if (!worker.stopped()) worker.child.kill("SIGKILL");
    await worker.exit;
    rmSync(root, {recursive: true, force: true});
  }
}, 10000);

it("SIGTERM waits for an in-flight signed broadcast and starts no new tick", async () => {
  const root = mkdtempSync(join(tmpdir(), "worker-drain-"));
  const db = openDatabase(join(root, "test.sqlite"));
  db.prepare("insert into card_sets(set_name,synced_at) values('Seed',current_timestamp)").run();
  const players = createPlayerService(db), drafts = createDraftService(db);
  const a = players.findOrCreateByDiscord("g", "900000000000000101", "Alice");
  const b = players.findOrCreateByDiscord("g", "900000000000000102", "Bob");
  const insert = db.prepare(`insert into card_catalog(ygoprodeck_id,name,type,frame_type,image_url,image_url_small,card_sets_json,cached_at)
    values(?,?,'Normal Monster','normal','https://img/full','https://img/small','[{"set_name":"Metal Raiders"}]',current_timestamp)`);
  for (let id = 1; id <= 80; id++) insert.run(id, `Card ${id}`);
  const draft = drafts.create("g", "channel", "Process drain", {}, a.userId, a.id);
  drafts.join(draft.id, b.id);
  drafts.start(draft.id);
  db.prepare("update drafts set pick_deadline_at=? where id=?").run(new Date(Date.now() - 60000).toISOString(), draft.id);

  const received: Array<{path: string; body: string; signature: string}> = [];
  let pending: ServerResponse | undefined;
  const secret = "process-drain-secret";
  const server = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    received.push({path: req.url!, body, signature: String(req.headers["x-internal-signature"])});
    pending = res; // Hold the real worker HTTP effect until after SIGTERM.
  });
  let worker: ReturnType<typeof startWorker> | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("No test server port");
    worker = startWorker(root, {WS_INTERNAL_URL: `http://127.0.0.1:${address.port}`, WS_INTERNAL_SECRET: secret});
    await until(() => pending !== undefined || worker!.stopped());
    expect(pending, worker.output()).toBeDefined();
    expect(received).toHaveLength(1);
    expect(received[0].path).toBe("/internal/draft/resync");
    expect(await readSignedRequest(new Request(`http://127.0.0.1:${address.port}${received[0].path}`, {
      method: "POST", body: received[0].body, headers: { "x-internal-signature": received[0].signature },
    }), { secret, purpose: "ws-broadcast" })).toEqual({
      ok: true, body: { slug: draft.webSlug, packRound: 1, pickStep: 2 },
    });
    expect(drafts.findById(draft.id).currentPickStep).toBe(2);
    // A broken stop that leaves intervals running would now expire this again.
    db.prepare("update drafts set pick_deadline_at=? where id=?").run(new Date(Date.now() - 60000).toISOString(), draft.id);
    worker.child.kill("SIGTERM");
    await delay(150);
    expect(worker.stopped()).toBe(false);
    pending!.end("ok");
    await until(worker.stopped);
    expect(await worker.exit).toEqual({code: 0});
    expect(received).toHaveLength(1);
    expect(drafts.findById(draft.id).currentPickStep).toBe(2);
    expect(existsSync(worker.health)).toBe(false);
    expect(db.pragma("foreign_key_check")).toEqual([]);
    expect(db.pragma("integrity_check")).toEqual([{integrity_check: "ok"}]);
  } finally {
    pending?.end("ok");
    if (worker) {
      if (!worker.stopped()) worker.child.kill("SIGKILL");
      await worker.exit;
    }
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    db.close();
    rmSync(root, {recursive: true, force: true});
  }
}, 10000);


it("publishes verified Genesys points at worker startup with the Discord bot disabled", async () => {
  const root = mkdtempSync(join(tmpdir(), "worker-genesys-"));
  const db = openDatabase(join(root, "test.sqlite"));
  db.prepare("insert into card_sets(set_name,synced_at) values('Seed',current_timestamp)").run();
  const worker = startWorker(root);
  try {
    await until(() => !!db.prepare("select revision from genesys_points_meta").get() || worker.stopped());
    expect(db.prepare("select effective_date, source_url from genesys_points_meta").get(), worker.output()).toEqual({
      effective_date: "2026-10-05", source_url: "https://db.ygoprodeck.com/api/v7/cardinfo.php?format=genesys&misc=yes",
    });
    expect(db.prepare("select count(*) as n from card_catalog where genesys_points > 0").get()).toEqual({ n: 750 });
    worker.child.kill("SIGTERM");
    await until(worker.stopped);
    expect(await worker.exit).toEqual({ code: 0 });
  } finally {
    if (!worker.stopped()) worker.child.kill("SIGKILL");
    await worker.exit;
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
}, 10000);
