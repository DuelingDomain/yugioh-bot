import type Database from "better-sqlite3";
import { collectVpsHealth, createHostSampler, createServiceReporter } from "@yugidraft/shared/health";
import { createLoop } from "./loop.js";

export function createVpsHealth(input: {
  db: Database.Database; guildId?: string; procDir?: string; cgroupDir?: string;
  now?: () => number;
}) {
  const host = createHostSampler(input.procDir);
  const own = createServiceReporter({ ...input, service: "worker" });
  return createLoop(async () => {
    const at = input.now?.() ?? Date.now();
    own.tick(at);
    collectVpsHealth(input.db, host(), input.guildId, at);
  }, 60_000);
}
