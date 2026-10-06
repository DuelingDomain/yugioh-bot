import { config } from "dotenv";
import { isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { writeFileSync, rmSync } from "node:fs";
import { openDatabase } from "@yugidraft/shared/db";
import {
  createDraftService,
  createMatchService,
  createTournamentService,
  createCardCatalogService,
  createImageCacheCleanup,
} from "@yugidraft/shared/services";
import { effectsFromEnv } from "./effects.js";
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
const draftTimer = createDraftTimer({ db, drafts: createDraftService(db), effects, startedAt });
const tournamentTimer = createTournamentTimer({ db, matches: createMatchService(db), tournaments: createTournamentService(db), effects });
const jobs = [
  createLoop(async () => { await draftTimer.tick(); writeHealth(); }, 1000),
  createLoop(() => tournamentTimer.tick(), 60_000),
  createSetSync({
    db,
    cards: createCardCatalogService(db),
    expression: process.env.SETS_SYNC_CRON ?? "0 6 * * *",
    timezone: process.env.SETS_SYNC_TIMEZONE ?? "UTC",
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
    await Promise.all(jobs.map(job => job.stop()));
    rmSync(healthPath, { force: true });
    db.close();
  })();
}
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, () => {
    void stop().catch(error => { console.error(error); process.exitCode = 1; });
  });
}
try {
  await Promise.all(jobs.map(job => job.start()));
} catch (error) {
  console.error("[worker] startup failed", error);
  await stop();
  process.exitCode = 1;
}
