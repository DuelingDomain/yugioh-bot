import { appendFileSync } from "node:fs";
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
