import Database from "better-sqlite3";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { migrate } from "@yugidraft/shared/db";
import { readVpsHealth } from "@yugidraft/shared/health";
import { expect, it } from "vitest";
import { createVpsHealth } from "../src/vps-health.js";

it("collects host OOM deltas without cross-container files, survives reporter restarts, and drains sampling on stop", async () => {
  const root = mkdtempSync(join(tmpdir(), "worker-vps-"));
  const cgroup = join(root, "cgroup"), proc = join(root, "proc");
  mkdirSync(cgroup); mkdirSync(join(proc, "self"), { recursive: true });
  writeFileSync(join(proc, "self/cgroup"), "0::/\n");
  writeFileSync(join(cgroup, "memory.current"), "512\n"); writeFileSync(join(cgroup, "memory.max"), "max\n");
  writeFileSync(join(cgroup, "memory.events"), "oom_kill 2\n"); writeFileSync(join(cgroup, "cpu.stat"), "usage_usec 120000\n");
  writeFileSync(join(proc, "meminfo"), "MemTotal: 4000000 kB\nMemAvailable: 3000000 kB\nSwapTotal: 0 kB\nSwapFree: 0 kB\n");
  writeFileSync(join(proc, "stat"), "cpu 100 0 0 100\ncpu0 1\ncpu1 1\n"); writeFileSync(join(proc, "loadavg"), "0.2 0.1 0.1\n"); writeFileSync(join(proc, "uptime"), "1000 100\n");
  writeFileSync(join(proc, "vmstat"), "oom_kill 3\n");
  const db = new Database(join(root, "test.sqlite")); migrate(db);
  let at = Math.floor(Date.now() / 60_000) * 60_000;
  const create = () => createVpsHealth({ db, guildId: "guild", cgroupDir: cgroup, procDir: proc, now: () => at });
  const job = create();
  let restarted: ReturnType<typeof create> | undefined;
  try {
    await job.start();
    expect(readVpsHealth(db, "guild", at)).toMatchObject({ status: "OK", current: { services: { worker: { cgroup: { memoryBytes: 512 } } } } });
    expect(Object.keys(readVpsHealth(db, "guild", at).current!.services)).not.toContain("caddy");
    at += 60_000;
    writeFileSync(join(proc, "vmstat"), "oom_kill 4\n");
    await job.tick();
    expect(readVpsHealth(db, "guild", at)).toMatchObject({ status: "Upgrade soon", current: { host: { oomKills: 4 }, oomKillDelta: 1 } });
    await job.stop(); const before = db.prepare("select count(*) n from vps_health_history").get();
    at += 60_000; await job.tick();
    expect(db.prepare("select count(*) n from vps_health_history").get()).toEqual(before);
    writeFileSync(join(proc, "vmstat"), "oom_kill 5\n");
    restarted = create(); await restarted.start();
    expect(readVpsHealth(db, "guild", at)).toMatchObject({ current: { oomKillDelta: 1 }, restarts: { worker: at } });
    rmSync(join(proc, "vmstat")); at += 60_000; await restarted.tick();
    expect(readVpsHealth(db, "guild", at).current).toMatchObject({ host: { oomKills: null }, oomKillDelta: null });
  } finally { await job.stop(); await restarted?.stop(); db.close(); rmSync(root, { recursive: true, force: true }); }
// About 1 s alone; parallel CI suites have pushed it past the 5 s default.
}, 20_000);

it.each(["locked", "missing-table", "missing-db"])("ws serves polling when its health database is %s, without migrating", async (mode) => {
  const root = mkdtempSync(join(tmpdir(), "ws-health-"));
  const path = join(root, "test.sqlite");
  const db = mode === "missing-db" ? undefined : new Database(path);
  if (mode === "locked") { migrate(db!); db!.pragma("journal_mode = WAL"); db!.exec("BEGIN IMMEDIATE"); }
  const schema = db?.pragma("schema_version", { simple: true });
  const server = fileURLToPath(new URL("../../ws/src/server.ts", import.meta.url));
  const child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-e", `
    import { once } from 'node:events';
    const { io } = await import(${JSON.stringify(server)});
    if (!io.httpServer.listening) await once(io.httpServer, 'listening');
    process.send({ port: io.httpServer.address().port });
  `], {
    cwd: fileURLToPath(new URL("../../../", import.meta.url)),
    env: { ...process.env, DATABASE_PATH: path, DOTENV_CONFIG_PATH: "/dev/null", WS_PORT: "0", WS_INTERNAL_SECRET: "", SENTRY_DSN: "", POSTHOG_KEY: "" },
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  let output = "";
  child.stdout!.on("data", chunk => { output += chunk; }); child.stderr!.on("data", chunk => { output += chunk; });
  try {
    const ready = once(child, "message", { signal: AbortSignal.timeout(4000) });
    const earlyExit = once(child, "exit").then(([code]) => { throw new Error(`ws exited ${code}: ${output}`); });
    const [message] = await Promise.race([ready, earlyExit]) as [{ port: number }];
    const response = await fetch(`http://127.0.0.1:${message.port}/socket.io/?EIO=4&transport=polling`, { signal: AbortSignal.timeout(1000) });
    expect(response.status).toBe(200); expect(await response.text()).toContain('"sid"');
    expect(db?.pragma("schema_version", { simple: true })).toBe(schema);
    if (mode === "locked") expect(db!.prepare("select count(*) n from vps_service_health").get()).toEqual({ n: 0 });
    if (mode === "missing-table") expect(db!.prepare("select count(*) n from sqlite_master where type = 'table'").get()).toEqual({ n: 0 });
    if (mode === "missing-db") expect(existsSync(path)).toBe(false);
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, "exit"); process.kill(child.pid!, "SIGTERM"); await exited;
    }
    if (db?.inTransaction) db.exec("ROLLBACK"); db?.close(); rmSync(root, { recursive: true, force: true });
  }
}, 10_000);
