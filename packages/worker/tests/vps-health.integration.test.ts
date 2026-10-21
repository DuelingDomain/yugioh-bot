import Database from "better-sqlite3";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { migrate } from "@yugidraft/shared/db";
import { readVpsHealth } from "@yugidraft/shared/health";
import { expect, it } from "vitest";
import { createVpsHealth } from "../src/vps-health.js";

it("collects Caddy's real shell report through a private file, expires old metrics, and drains sampling on stop", async () => {
  const root = mkdtempSync(join(tmpdir(), "worker-vps-"));
  const cgroup = join(root, "cgroup"), proc = join(root, "proc"), output = join(root, "reports");
  mkdirSync(cgroup); mkdirSync(join(proc, "self"), { recursive: true });
  writeFileSync(join(proc, "self/cgroup"), "0::/\n");
  writeFileSync(join(cgroup, "memory.current"), "512\n"); writeFileSync(join(cgroup, "memory.max"), "max\n");
  writeFileSync(join(cgroup, "memory.events"), "oom_kill 2\n"); writeFileSync(join(cgroup, "cpu.stat"), "usage_usec 120000\n");
  writeFileSync(join(proc, "meminfo"), "MemTotal: 4000000 kB\nMemAvailable: 3000000 kB\nSwapTotal: 0 kB\nSwapFree: 0 kB\n");
  writeFileSync(join(proc, "stat"), "cpu 100 0 0 100\ncpu0 1\ncpu1 1\n"); writeFileSync(join(proc, "loadavg"), "0.2 0.1 0.1\n"); writeFileSync(join(proc, "uptime"), "1000 100\n");
  const db = new Database(join(root, "test.sqlite")); migrate(db);
  let at = Date.now();
  const job = createVpsHealth({ db, guildId: "guild", cgroupDir: cgroup, procDir: proc, caddyPath: join(output, "caddy.json"), now: () => at });
  try {
    const script = fileURLToPath(new URL("../../../scripts/deployment/caddy-vps-health.sh", import.meta.url));
    const report = () => spawnSync("sh", [script, "--sample-once"], { env: { PATH: process.env.PATH, VPS_HEALTH_OUTPUT_DIR: output, VPS_HEALTH_CGROUP_DIR: cgroup, VPS_HEALTH_PROC_DIR: proc }, encoding: "utf8" });
    expect(report().status).toBe(0);
    const caddy = JSON.parse(readFileSync(join(output, "caddy.json"), "utf8"));
    expect(caddy.cgroup).toMatchObject({ memoryBytes: 512, memoryLimitBytes: null, oomKills: 2, cpuUsageUsec: 120000 });
    await job.start();
    expect(readVpsHealth(db, "guild", at)).toMatchObject({ status: "Upgrade soon", current: { services: { caddy: { cgroup: { oomKills: 2 } }, worker: { cgroup: { memoryBytes: 512 } } } } });
    at += 60_000;
    caddy.at += 60_000; caddy.cgroup.cpuUsageUsec += 30_000_000; writeFileSync(join(output, "caddy.json"), JSON.stringify(caddy));
    await job.tick();
    expect(readVpsHealth(db, "guild", at).current?.services.caddy?.cgroup?.cpuPercent).toBe(50);
    at += 4 * 60_000; await job.tick();
    expect(readVpsHealth(db, "guild", at).current?.services.caddy).toBeNull();
    await job.stop(); const before = db.prepare("select count(*) n from vps_health_history").get();
    at += 60_000; await job.tick();
    expect(db.prepare("select count(*) n from vps_health_history").get()).toEqual(before);
    rmSync(join(cgroup, "memory.current")); rmSync(join(cgroup, "memory.max")); rmSync(join(cgroup, "memory.events")); rmSync(join(cgroup, "cpu.stat"));
    expect(report().status).toBe(0);
    expect(JSON.parse(readFileSync(join(output, "caddy.json"), "utf8")).cgroup).toEqual({ memoryBytes: null, memoryLimitBytes: null, oomKills: null, cpuUsageUsec: null, cpuPercent: null });
  } finally { await job.stop(); db.close(); rmSync(root, { recursive: true, force: true }); }
});
