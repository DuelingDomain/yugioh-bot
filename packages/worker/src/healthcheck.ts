import { readFileSync } from "node:fs";

try {
  const value = JSON.parse(readFileSync(process.env.WORKER_HEALTH_PATH ?? "/tmp/yugidraft-worker-health.json", "utf8"));
  if (!Number.isInteger(value.pid) || value.pid <= 0 || !Number.isFinite(value.at)
      || Date.now() - value.at > 120_000) throw new Error("stale heartbeat");
  process.kill(value.pid, 0);
} catch {
  process.exitCode = 1;
}
