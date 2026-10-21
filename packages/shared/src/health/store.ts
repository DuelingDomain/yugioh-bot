import type Database from "better-sqlite3";
import { SERVICE_IDS, type HealthSample, type HostMetrics, type ServiceReport, type VpsHealth } from "./types.js";

export const HEALTH_INTERVAL_MS = 60_000;
export const HEALTH_STALE_MS = 3 * HEALTH_INTERVAL_MS;
const DAY = 24 * 60 * HEALTH_INTERVAL_MS;
function fresh(at: number, now: number) { return Number.isFinite(at) && at <= now + 5_000 && now - at <= HEALTH_STALE_MS; }

export function collectVpsHealth(db: Database.Database, host: HostMetrics, guildId: string | undefined, at = Date.now()): void {
  const services = Object.fromEntries(SERVICE_IDS.map(id => [id, null])) as HealthSample["services"];
  const rows = db.prepare("select service, at, json from vps_service_health").all() as { service: string; at: number; json: string }[];
  for (const row of rows) {
    if (!SERVICE_IDS.includes(row.service as typeof SERVICE_IDS[number]) || !fresh(row.at, at)) continue;
    try { services[row.service as typeof SERVICE_IDS[number]] = JSON.parse(row.json) as ServiceReport; } catch { /* unavailable */ }
  }
  const count = (sql: string) => (db.prepare(sql).get(guildId) as { n: number }).n;
  const activity = guildId ? { guildId,
    liveDuels: count("select count(*) n from duels where guild_id = ? and kind = 'play' and status = 'active'"),
    liveDrafts: count("select count(*) n from drafts where guild_id = ? and status = 'active'"),
  } : null;
  const bucket = Math.floor(at / HEALTH_INTERVAL_MS) * HEALTH_INTERVAL_MS;
  db.transaction(() => {
    // Persist the baseline so a worker/container restart cannot erase a host OOM.
    // Repeated writes to one minute retain its delta instead of counting it twice.
    const row = db.prepare("select at, json from vps_health_history where at <= ? and at > ? order by at desc limit 1").get(bucket, bucket - DAY) as { at: number; json: string } | undefined;
    let previous: HealthSample | undefined;
    try { if (row) previous = JSON.parse(row.json) as HealthSample; } catch { /* rebase */ }
    // Never erase an event already observed in this bucket if proc disappears
    // or the host counter resets before a replacement collection.
    const retainedDelta = row?.at === bucket ? previous?.oomKillDelta ?? null : null;
    let oomKillDelta: number | null = retainedDelta;
    if (host.oomKills != null && previous?.host.oomKills != null && host.oomKills >= previous.host.oomKills
      && !(host.uptimeSeconds != null && previous.host.uptimeSeconds != null && host.uptimeSeconds < previous.host.uptimeSeconds)) {
      oomKillDelta = host.oomKills - previous.host.oomKills + (retainedDelta ?? 0);
    }
    const sample: HealthSample = { at, host, oomKillDelta, services, activity };
    db.prepare("insert or replace into vps_health_history(at, json) values (?, ?)").run(bucket, JSON.stringify(sample));
    db.prepare("delete from vps_health_history where at <= ?").run(bucket - DAY);
  })();
}

function saturated(sample: HealthSample): boolean {
  const c = sample.services.duel?.capacity;
  return c?.engineWorkers !== undefined && c.maxWorkers !== undefined && c.maxWorkers > 0 && c.engineWorkers >= Math.ceil(c.maxWorkers * 2 / 3);
}
function continuous(samples: HealthSample[], now: number, predicate: (s: HealthSample) => boolean, minutes = 15): boolean {
  let end = now;
  for (let i = samples.length - 1; i >= 0; i--) {
    const s = samples[i];
    if (end - s.at > 90_000 || !predicate(s)) return false;
    if (now - s.at >= minutes * HEALTH_INTERVAL_MS) return true;
    end = s.at;
  }
  return false;
}

/** Bounded to 1,440 indexed rows; no network or filesystem walks on an admin poll. */
export function readVpsHealth(db: Database.Database, guildId: string | undefined, now = Date.now()): VpsHealth {
  const rows = db.prepare("select json from vps_health_history where at > ? order by at").all(now - DAY) as { json: string }[];
  const samples: HealthSample[] = [];
  for (const row of rows) { try { samples.push(JSON.parse(row.json) as HealthSample); } catch { /* skip corrupt sample */ } }
  const restarts: VpsHealth["restarts"] = {};
  const instances: Partial<Record<typeof SERVICE_IDS[number], string>> = {};
  for (const sample of samples) for (const id of SERVICE_IDS) {
    const report = sample.services[id];
    if (!report) continue;
    if (instances[id] !== undefined && instances[id] !== report.instance) restarts[id] = report.at;
    if (report.restartedAt != null && report.restartedAt > now - DAY && report.restartedAt <= now + 5000) restarts[id] = report.restartedAt;
    instances[id] = report.instance;
  }
  // Keep history intact while masking stale current service readings before evaluating pressure.
  const current: HealthSample | null = samples.length ? structuredClone(samples.at(-1)!) : null;
  const stale = !current || !fresh(current.at, now);
  const reasons: string[] = [], incomplete: string[] = [];
  if (current) {
    for (const id of SERVICE_IDS) {
      const report = current.services[id];
      if (stale || !report || !fresh(report.at, now)) { current.services[id] = null; incomplete.push(`${id}: no fresh report.`); }
      else if (!report.cgroup || (report.cgroup.memoryBytes === null && report.cgroup.cpuUsageUsec === null)) incomplete.push(`${id}: cgroup v2 metrics unavailable.`);
    }
    if (current.activity?.guildId !== guildId) current.activity = null;
  }

  const ramHigh = (s: HealthSample) => (s.host.memory?.usedPercent ?? 0) > 80;
  const loadHigh = (s: HealthSample) => s.host.load !== null && s.host.vcpuCount !== null && s.host.load[0] > s.host.vcpuCount;
  let status: VpsHealth["status"] = current && !stale && current.host.memory && current.host.load && current.host.vcpuCount ? "OK" : null;
  let upgrade = false;
  if (current && !stale) {
    const queueHigh = continuous(samples, current.at, s => {
      const report = s.services.duel;
      return !!report && fresh(report.at, s.at) && (report.capacity?.queuedRebuilds ?? 0) >= 4;
    }, 5) && (current.services.duel?.capacity?.queuedRebuilds ?? 0) >= 4;
    const pressure = ramHigh(current) || loadHigh(current) || (current.host.cpuPercent ?? 0) > 85 || saturated(current) || queueHigh;
    if (pressure && status) { status = "High"; reasons.push("Current resource pressure; watch the history."); }
    if (continuous(samples, current.at, ramHigh)) { upgrade = true; reasons.push("RAM above 80% for 15 minutes."); }
    if (continuous(samples, current.at, loadHigh)) { upgrade = true; reasons.push("Host load above vCPU count for 15 minutes."); }
    if (new Set(samples.filter(s => s.at > now - 60 * HEALTH_INTERVAL_MS && saturated(s)).map(s => Math.floor(s.services.duel!.at / HEALTH_INTERVAL_MS))).size >= 15) { upgrade = true; reasons.push("Engine workers at two-thirds capacity in at least 15 minutes of the last hour."); }
  }
  const oom = samples.some(s => (s.oomKillDelta ?? 0) > 0);
  if (oom) { upgrade = true; reasons.push("Host OOM kill observed in the last 24 hours; inspect service memory limits."); }
  if (upgrade && !stale && status !== null) status = "Upgrade soon";
  if (stale) incomplete.push("Worker sampling is missing or over 3 minutes old.");
  if (!current?.host.memory || !current.host.load || !current.host.vcpuCount) incomplete.push("Host proc metrics are unavailable.");
  return { current, stale, status, reasons, restarts, incomplete, history: samples.map(s => ({ at: s.at, cpuPercent: s.host.cpuPercent, ramPercent: s.host.memory?.usedPercent ?? null, load1: s.host.load?.[0] ?? null, engineWorkers: s.services.duel?.capacity?.engineWorkers ?? null })) };
}
