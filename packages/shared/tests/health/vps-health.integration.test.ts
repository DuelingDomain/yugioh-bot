import Database from "better-sqlite3";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { migrate } from "../../src/db/schema.js";
import { createHostSampler, createServiceReporter, collectVpsHealth, readVpsHealth } from "../../src/health/index.js";

const roots: string[] = [];
const databases: Database.Database[] = [];
afterEach(() => { for (const db of databases.splice(0)) db.close(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "vps-health-")); roots.push(root);
  const proc = join(root, "proc"), cgroup = join(root, "cgroup");
  mkdirSync(join(proc, "self"), { recursive: true }); mkdirSync(cgroup);
  const db = new Database(join(root, "metrics.sqlite")); databases.push(db); migrate(db);
  writeFileSync(join(proc, "self/cgroup"), "0::/\n");
  const files = (ram = 50, load = 1, tick = 100) => {
    writeFileSync(join(proc, "meminfo"), `MemTotal: 4000000 kB\nMemAvailable: ${4000000 * (1 - ram / 100)} kB\nSwapTotal: 0 kB\nSwapFree: 0 kB\n`);
    writeFileSync(join(proc, "stat"), `cpu ${tick} 0 0 ${tick} 0 0 0 0 100 0\ncpu0 1\ncpu1 1\n`);
    writeFileSync(join(proc, "loadavg"), `${load} 0.8 0.5 1/99 1\n`);
    writeFileSync(join(proc, "uptime"), "3600.00 100.00\n");
    writeFileSync(join(cgroup, "memory.current"), "104857600\n");
    writeFileSync(join(cgroup, "memory.max"), "402653184\n");
    writeFileSync(join(cgroup, "memory.events"), "oom 0\noom_kill 0\n");
    writeFileSync(join(cgroup, "cpu.stat"), `usage_usec ${tick * 1000}\n`);
  };
  files(); return { root, db, proc, cgroup, files };
}
const minute = 60_000;
const start = 1_800_000_000_000;
it("integrates own cgroups, service capacity, host deltas and SQLite history across restarts", async () => {
  const f = fixture();
  const report = createServiceReporter({ db: f.db, service: "duel", procDir: f.proc, cgroupDir: f.cgroup, capacity: () => ({ engineWorkers: 1, maxWorkers: 1, queuedRebuilds: 1 }) });
  const sample = createHostSampler(f.proc);
  await report.tick(start);
  collectVpsHealth(f.db, sample(), "guild", start);
  f.files(50, 1, 200); await report.tick(start + minute);
  collectVpsHealth(f.db, sample(), "guild", start + minute);
  const health = readVpsHealth(f.db, "guild", start + minute);
  expect(health.current?.host).toMatchObject({ cpuPercent: 50, vcpuCount: 2, load: [1, 0.8, 0.5], uptimeSeconds: 3600, swap: { totalBytes: 0 } });
  expect(health.current?.services.duel).toMatchObject({ cgroup: { memoryBytes: 104857600, memoryLimitBytes: 402653184, oomKills: 0, cpuPercent: expect.any(Number) }, capacity: { engineWorkers: 1, maxWorkers: 1, queuedRebuilds: 1 } });
  expect(health.history).toHaveLength(2);
  expect(health.status).toBe("High");
  const reopened = new Database(f.db.name); databases.push(reopened);
  expect(readVpsHealth(reopened, "guild", start + minute).history).toHaveLength(2);
  collectVpsHealth(f.db, sample(), "guild", start + 25 * 60 * minute);
  expect(readVpsHealth(f.db, "guild", start + 25 * 60 * minute).history).toHaveLength(1);
});
it("only escalates continuous 15-minute pressure, detects OOM and never carries pressure across missing samples", async () => {
  const f = fixture(); const host = createHostSampler(f.proc);
  for (let i = 0; i < 15; i++) { f.files(85, 3); collectVpsHealth(f.db, host(), "guild", start + i * minute); }
  expect(readVpsHealth(f.db, "guild", start + 14 * minute).status).toBe("High");
  collectVpsHealth(f.db, host(), "guild", start + 15 * minute);
  expect(readVpsHealth(f.db, "guild", start + 15 * minute)).toMatchObject({ status: "Upgrade soon", reasons: expect.arrayContaining([expect.stringMatching(/RAM.*15/), expect.stringMatching(/load.*15/)]) });
  collectVpsHealth(f.db, host(), "guild", start + 20 * minute);
  expect(readVpsHealth(f.db, "guild", start + 20 * minute).status).toBe("High");
  const reporter = createServiceReporter({ db: f.db, service: "ws", procDir: f.proc, cgroupDir: f.cgroup });
  writeFileSync(join(f.cgroup, "memory.events"), "oom_kill 1\n"); await reporter.tick(start + 21 * minute);
  f.files(20, 0.2); // Reporter has already captured the kill, even if the cgroup is then reset.
  collectVpsHealth(f.db, host(), "guild", start + 21 * minute);
  expect(readVpsHealth(f.db, "guild", start + 21 * minute)).toMatchObject({ status: "Upgrade soon", reasons: expect.arrayContaining([expect.stringMatching(/OOM/)]) });
});
it("marks frequent engine pressure at 8/12 in 15 distinct minutes of the last hour", async () => {
  const f = fixture(); const host = createHostSampler(f.proc);
  const reporter = createServiceReporter({ db: f.db, service: "duel", procDir: f.proc, cgroupDir: f.cgroup, capacity: () => ({ engineWorkers: 8, maxWorkers: 12, queuedRebuilds: 0 }) });
  for (let i = 0; i < 15; i++) { await reporter.tick(start + 2 * i * minute); collectVpsHealth(f.db, host(), "guild", start + 2 * i * minute); }
  expect(readVpsHealth(f.db, "guild", start + 28 * minute)).toMatchObject({ status: "Upgrade soon", reasons: expect.arrayContaining([expect.stringMatching(/workers.*15/)]) });
});
it("degrades to n/a without proc/cgroup files, handles unlimited memory, and masks stale reports", async () => {
  const f = fixture(); const sampler = createHostSampler(join(f.root, "missing"));
  const reporter = createServiceReporter({ db: f.db, service: "web", procDir: f.proc, cgroupDir: join(f.root, "missing") });
  await reporter.tick(start); collectVpsHealth(f.db, sampler(), "guild", start);
  expect(readVpsHealth(f.db, "guild", start)).toMatchObject({ status: null, current: { host: { memory: null }, services: { web: { cgroup: null } } } });
  writeFileSync(join(f.cgroup, "memory.max"), "max\n");
  const healthy = createServiceReporter({ db: f.db, service: "web", procDir: f.proc, cgroupDir: f.cgroup });
  await healthy.tick(start);
  collectVpsHealth(f.db, createHostSampler(f.proc)(), "guild", start + minute);
  expect(readVpsHealth(f.db, "guild", start + minute).current?.services.web?.cgroup?.memoryLimitBytes).toBeNull();
  collectVpsHealth(f.db, createHostSampler(f.proc)(), "guild", start + 5 * minute);
  expect(readVpsHealth(f.db, "guild", start + 5 * minute).current?.services.web).toBeNull();
  expect(readVpsHealth(f.db, "guild", start + 9 * minute).status).toBeNull();
  expect(readVpsHealth(f.db, "other-guild", start + 5 * minute).current?.activity).toBeNull();
});
it("resolves a native systemd service cgroup rather than attributing the host root to the service", async () => {
  const f = fixture(); mkdirSync(join(f.cgroup, "system.slice/web.service"), { recursive: true });
  writeFileSync(join(f.proc, "self/cgroup"), "0::/system.slice/web.service\n");
  writeFileSync(join(f.cgroup, "system.slice/web.service/memory.current"), "42\n");
  const reporter = createServiceReporter({ db: f.db, service: "web", procDir: f.proc, cgroupDir: f.cgroup });
  await reporter.tick(start); collectVpsHealth(f.db, createHostSampler(f.proc)(), "guild", start);
  expect(readVpsHealth(f.db, "guild", start).current?.services.web?.cgroup?.memoryBytes).toBe(42);
});
it("does not infer current pressure from an expired service report in a fresh worker sample", async () => {
  const f = fixture(); const host = createHostSampler(f.proc);
  const reporter = createServiceReporter({ db: f.db, service: "duel", procDir: f.proc, cgroupDir: f.cgroup, capacity: () => ({ engineWorkers: 8, maxWorkers: 12, queuedRebuilds: 1 }) });
  reporter.tick(start); collectVpsHealth(f.db, host(), "guild", start + 3 * minute);
  expect(readVpsHealth(f.db, "guild", start + 4 * minute)).toMatchObject({ status: "OK", current: { services: { duel: null } } });
  writeFileSync(join(f.cgroup, "memory.events"), "oom_kill 1\n"); reporter.tick(start + 5 * minute);
  collectVpsHealth(f.db, createHostSampler(join(f.root, "missing"))(), "guild", start + 5 * minute);
  expect(readVpsHealth(f.db, "guild", start + 5 * minute)).toMatchObject({ status: null, reasons: expect.arrayContaining([expect.stringMatching(/OOM/)]) });
});
it("does not label a shared native login scope as each service's own resource usage", async () => {
  const f = fixture(); mkdirSync(join(f.cgroup, "user.slice/user-1000.slice/user@1000.service/app.slice/terminal.scope"), { recursive: true });
  writeFileSync(join(f.proc, "self/cgroup"), "0::/user.slice/user-1000.slice/user@1000.service/app.slice/terminal.scope\n");
  writeFileSync(join(f.cgroup, "user.slice/user-1000.slice/user@1000.service/app.slice/terminal.scope/memory.current"), "42\n");
  const reporter = createServiceReporter({ db: f.db, service: "web", procDir: f.proc, cgroupDir: f.cgroup });
  reporter.tick(start); collectVpsHealth(f.db, createHostSampler(f.proc)(), "guild", start);
  expect(readVpsHealth(f.db, "guild", start).current?.services.web?.cgroup).toBeNull();
});
