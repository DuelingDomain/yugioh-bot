import { createServiceReporter } from "@yugidraft/shared/health";
import { getDb } from "./db";
const key = Symbol.for("yugidraft.web.vps-health");
const state = globalThis as typeof globalThis & { [key]?: ReturnType<typeof createServiceReporter> };
export function startWebHealth() {
  if (state[key]) return;
  try {
    const reporter = createServiceReporter({ db: getDb(), service: "web" });
    state[key] = reporter;
    reporter.start();
  } catch { /* Health reporting must not prevent the web server from starting. */ }
}
