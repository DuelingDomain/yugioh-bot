import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { createCgroupSampler } from "./sampler.js";
import type { Capacity, ServiceId, ServiceReport } from "./types.js";

/** Each process can observe only its own cgroup. SQLite is already shared by these services. */
export function createServiceReporter(input: {
  db: Database.Database; service: ServiceId; capacity?: () => Capacity;
  procDir?: string; cgroupDir?: string;
}) {
  const sample = createCgroupSampler(input.procDir, input.cgroupDir);
  const instance = randomUUID();
  const save = input.db.prepare("insert into vps_service_health(service, at, json) values (?, ?, ?) on conflict(service) do update set at = excluded.at, json = excluded.json");
  let timer: ReturnType<typeof setInterval> | undefined;
  const tick = (at = Date.now()) => {
    const report: ServiceReport = { at, instance, cgroup: sample(at), ...(input.capacity ? { capacity: input.capacity() } : {}) };
    save.run(input.service, at, JSON.stringify(report));
  };
  const safeTick = () => {
    // Diagnostics must never interrupt gameplay or fail service startup on contention.
    try { tick(); } catch { /* A missing report becomes n/a after three minutes. */ }
  };
  return {
    tick,
    start() { if (timer) return; safeTick(); timer = setInterval(safeTick, 60_000); timer.unref(); },
    stop() { clearInterval(timer); timer = undefined; },
  };
}
