import { appendFileSync, mkdirSync, rmSync } from "node:fs";
import { bootstrapObservability } from "@yugidraft/shared/observability/node-bootstrap";

const pending = [];
bootstrapObservability(() => ({
  report(error) { pending.push({ code: error.code, message: error.message }); },
  log() {},
  async flush(timeout) {
    appendFileSync(process.env.WORKER_OBSERVABILITY_OUTPUT, JSON.stringify({ timeout, errors: pending.splice(0) }) + "\n");
    if (process.env.WORKER_FLUSH_BLOCK === "1") await new Promise(() => {});
  },
}));

if (process.env.WORKER_HEALTH_CLEANUP_ERROR === "1") {
  // Register after the bootstrap flush and before worker cleanup so heartbeat ticks
  // cannot observe the filesystem fault before SIGTERM starts shutdown.
  process.once("SIGTERM", () => {
    rmSync(process.env.WORKER_HEALTH_PATH);
    mkdirSync(process.env.WORKER_HEALTH_PATH);
  });
}
