import { report } from "@yugidraft/shared/observability";
import { awaitObservabilityShutdown } from "@yugidraft/shared/observability/node-bootstrap";
import cron from "node-cron";
import { config } from "dotenv";
import { isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { writeFileSync, rmSync } from "node:fs";
import { openDatabase } from "@yugidraft/shared/db";
import { clearOldPresence } from "@yugidraft/shared/presence";
import {
  createDraftService,
  createMatchService,
  createTournamentService,
  createCardCatalogService,
  createGenesysPointsSync,
  createImageCacheCleanup,
} from "@yugidraft/shared/services";
import { effectsFromEnv } from "./effects.js";
import { drainProductEvents } from "./analytics-drain.js";
import { createLoop } from "./loop.js";
import { createDraftTimer } from "./draft-timer.js";
import { createTournamentTimer } from "./tournament-timer.js";
import { createSetSync } from "./set-sync.js";
import { createImageCleanup } from "./image-cleanup.js";

const startedAt = new Date();
config({ path: process.env.DOTENV_CONFIG_PATH ?? fileURLToPath(new URL("../../../.env", import.meta.url)) });
const databasePath = process.env.DATABASE_PATH;
const imageCacheDir = process.env.CARD_IMAGE_CACHE_DIR;
if (!databasePath || !isAbsolute(databasePath)) throw new Error("Worker DATABASE_PATH must be absolute");
if (!imageCacheDir || !isAbsolute(imageCacheDir)) throw new Error("Worker CARD_IMAGE_CACHE_DIR must be absolute");
const maximumBytes = Number(process.env.CARD_IMAGE_CACHE_MAX_BYTES ?? 16106127360);
if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 0) throw new Error("Invalid CARD_IMAGE_CACHE_MAX_BYTES");

const db = openDatabase(databasePath);
const effects = effectsFromEnv(process.env);
const healthPath = process.env.WORKER_HEALTH_PATH ?? "/tmp/yugidraft-worker-health.json";
const writeHealth = () => writeFileSync(healthPath, JSON.stringify({ pid: process.pid, at: Date.now() }), { mode: 0o600 });
const beat = db.prepare("insert into worker_heartbeat(id, at, pid) values (1, ?, ?) on conflict(id) do update set at = excluded.at, pid = excluded.pid");
const draftTimer = createDraftTimer({ db, drafts: createDraftService(db), effects, startedAt });
const tournamentTimer = createTournamentTimer({ db, matches: createMatchService(db), tournaments: createTournamentService(db), effects });
const jobs = [
  // Presence keeps only the latest value and is dropped after 24 hours without an update.
  createLoop(async () => clearOldPresence(db), 10 * 60_000),
  createLoop(() => drainProductEvents(db, {
    key: process.env.POSTHOG_KEY ?? "",
    host: process.env.POSTHOG_HOST,
    personalApiKey: process.env.POSTHOG_PERSONAL_API_KEY ?? "",
    projectId: process.env.POSTHOG_PROJECT_ID ?? "",
  }), 10_000),
  createLoop(async () => { await draftTimer.tick(); writeHealth(); }, 1000),
  // The admin console reads this row to show worker health; it warns when the row is older than 3 minutes.
  createLoop(async () => { beat.run(Date.now(), process.pid); }, 30_000),
  createLoop(() => tournamentTimer.tick(), 60_000),
  createSetSync({
    db,
    cards: createCardCatalogService(db),
    expression: process.env.SETS_SYNC_CRON ?? "0 6 * * *",
    timezone: process.env.SETS_SYNC_TIMEZONE ?? "UTC",
  }),
  createGenesysPointsSync({
    cards: createCardCatalogService(db),
    schedule: cron.schedule,
    expression: process.env.GENESYS_SYNC_CRON,
    timezone: process.env.GENESYS_SYNC_TIMEZONE,
    effectiveDate: process.env.GENESYS_LIST_EFFECTIVE_DATE,
    expectedRevision: process.env.GENESYS_LIST_REVISION,
  }),
  createImageCleanup({
    cache: createImageCacheCleanup({ imageCacheDir }),
    maximumBytes,
    expression: process.env.IMAGE_CLEANUP_CRON ?? "0 4 * * *",
    timezone: process.env.IMAGE_CLEANUP_TIMEZONE ?? "UTC",
  }),
];

let draining: Promise<void> | undefined;
function stop() {
  return draining ??= (async () => {
    const cleanup = async (run: () => unknown) => {
      try { await run(); }
      catch (error) {
        report(error, { tags: { operation: "[worker] cleanup failed" } });
        process.exitCode = 1;
      }
    };
    try {
      await Promise.all(jobs.map(job => cleanup(() => job.stop())));
      await cleanup(() => rmSync(healthPath, { force: true }));
      await cleanup(() => db.close());
    } finally { await awaitObservabilityShutdown(); }
  })();
}
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, () => {
    void stop().catch(error => { report(error, { tags: { operation: "Error path in worker/src/index.ts" } }); process.exitCode = 1; });
  });
}
try {
  await Promise.all(jobs.map(job => job.start()));
} catch (error) {
  report(error, { tags: { operation: "[worker] startup failed" } });
  await stop();
  process.exitCode = 1;
}
