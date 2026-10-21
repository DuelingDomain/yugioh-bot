import { readFile } from "node:fs/promises";
import type Database from "better-sqlite3";
import { collectVpsHealth, createHostSampler, createServiceReporter, HEALTH_STALE_MS, type ServiceReport } from "@yugidraft/shared/health";
import { createLoop } from "./loop.js";

export function createVpsHealth(input: {
  db: Database.Database; guildId?: string; procDir?: string; cgroupDir?: string;
  caddyPath?: string; now?: () => number;
}) {
  const host = createHostSampler(input.procDir);
  const own = createServiceReporter({ ...input, service: "worker" });
  let previousCaddy: ServiceReport | null = null;
  return createLoop(async () => {
    const at = input.now?.() ?? Date.now();
    own.tick(at);
    try {
      // Caddy can write only this private volume. It has no database or host mounts.
      const raw = await readFile(input.caddyPath ?? "/run/vps-health/caddy.json", "utf8");
      if (raw.length > 2048) throw new Error("oversize report");
      const value = JSON.parse(raw) as ServiceReport;
      if (!Number.isFinite(value.at) || value.at > at + 5000 || at - value.at > HEALTH_STALE_MS || typeof value.instance !== "string" || value.instance.length > 100) throw new Error("stale report");
      const cgroup = value.cgroup;
      if (cgroup) for (const n of [cgroup.memoryBytes, cgroup.memoryLimitBytes, cgroup.oomKills, cgroup.cpuUsageUsec]) {
        if (n !== null && (!Number.isFinite(n) || n < 0)) throw new Error("invalid metric");
      }
      const report: ServiceReport = { at: value.at, instance: value.instance, cgroup: cgroup ? {
        memoryBytes: cgroup.memoryBytes, memoryLimitBytes: cgroup.memoryLimitBytes, oomKills: cgroup.oomKills,
        cpuUsageUsec: cgroup.cpuUsageUsec, cpuPercent: null,
      } : null };
      const prior = previousCaddy?.cgroup?.cpuUsageUsec;
      if (report.cgroup && prior != null && cgroup?.cpuUsageUsec != null && previousCaddy?.instance === value.instance && value.at > previousCaddy.at && cgroup.cpuUsageUsec >= prior) {
        report.cgroup.cpuPercent = (cgroup.cpuUsageUsec - prior) / ((value.at - previousCaddy.at) * 10);
      } else if (report.cgroup && previousCaddy?.at === value.at) report.cgroup.cpuPercent = previousCaddy.cgroup?.cpuPercent ?? null;
      previousCaddy = report;
      input.db.prepare("insert into vps_service_health(service, at, json) values ('caddy', ?, ?) on conflict(service) do update set at = excluded.at, json = excluded.json").run(report.at, JSON.stringify(report));
    } catch { /* Native development or a missing/stale caddy report is n/a. */ }
    collectVpsHealth(input.db, host(), input.guildId, at);
  }, 60_000);
}
