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
  let save: Database.Statement | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  const tick = (at = Date.now()) => {
    let timeout: number | undefined;
    try {
      const report: ServiceReport = { at, instance, cgroup: sample(at), ...(input.capacity ? { capacity: input.capacity() } : {}) };
      // SQLite calls are synchronous. Never wait behind a writer on the duel/ws
      // thread, including during statement preparation. Restore gameplay's timeout.
      timeout = input.db.pragma("busy_timeout", { simple: true }) as number;
      input.db.pragma("busy_timeout = 0");
      save ??= input.db.prepare("insert into vps_service_health(service, at, json) values (?, ?, ?) on conflict(service) do update set at = excluded.at, json = excluded.json");
      save.run(input.service, at, JSON.stringify(report));
    } catch { /* SQLITE_BUSY, a missing table, etc.: skip this optional report. */ }
    finally {
      if (timeout !== undefined) {
        try { input.db.pragma(`busy_timeout = ${timeout}`); } catch { /* Closed database. */ }
      }
    }
  };
  return {
    tick,
    start() { if (timer) return; tick(); timer = setInterval(tick, 60_000); timer.unref(); },
    stop() { clearInterval(timer); timer = undefined; },
  };
}
