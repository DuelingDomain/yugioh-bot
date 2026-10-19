import "dotenv/config";
import { writeSync } from "node:fs";
import { report } from "@yugidraft/shared/observability";
import { awaitObservabilityShutdown } from "@yugidraft/shared/observability/node-bootstrap";
import { writeHeartbeat, removeHeartbeat } from "./runtime/health.js";

const healthPath = process.env.BOT_HEALTH_PATH ?? "/tmp/yugidraft-bot-health.json";
if (process.env.DISCORD_BOT_ENABLED !== "1") {
  await new Promise<void>(resolve => {
    writeHeartbeat(healthPath, "disabled");
    const timer = setInterval(() => writeHeartbeat(healthPath, "disabled"), 30_000);
    const stop = () => { clearInterval(timer); removeHeartbeat(healthPath); resolve(); };
    process.once("SIGTERM", stop); process.once("SIGINT", stop);
    writeSync(1, "[bot] disabled\n");
  });
  await awaitObservabilityShutdown();
} else {
  const { readConfig } = await import("./runtime/config.js");
  const config = readConfig();
  const { startBot } = await import("./runtime/app.js");
  const { features } = await import("./features/index.js");
  // Install signal handlers before login so a deploy can stop a stalled startup.
  let requestedStop = false;
  const startup = new AbortController();
  let bot: Awaited<ReturnType<typeof startBot>> | undefined;
  let shutdown: Promise<void> | undefined;
  const stop = () => {
    requestedStop = true;
    startup.abort();
    if (!bot) return;
    shutdown ??= bot.stop().then(() => awaitObservabilityShutdown());
    void shutdown.catch(error => { report(error, { tags: { operation: "bot.shutdown" } }); process.exitCode = 1; });
  };
  process.once("SIGTERM", stop); process.once("SIGINT", stop);
  try {
    bot = await startBot({ config, modules: features, signal: startup.signal });
    if (requestedStop) stop();
    else writeSync(1, "[bot] ready\n");
  } catch (error) {
    if (!requestedStop) { report(error, { tags: { operation: "bot.start" } }); process.exitCode = 1; }
    await awaitObservabilityShutdown();
  }
}
