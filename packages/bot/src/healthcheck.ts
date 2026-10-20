import { isHealthy } from "./runtime/health.js";
if (!isHealthy(process.env.BOT_HEALTH_PATH ?? "/tmp/yugidraft-bot-health.json")) process.exitCode = 1;
