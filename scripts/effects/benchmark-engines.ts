/** Host API benchmark; disposable file DB, committed artifacts, no paid judge calls. */
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrate } from "@yugidraft/shared/db";
import { importBridgeArtifact } from "@yugidraft/shared/cards/effects";
import type { BridgeApi as BridgeApiType } from "../../packages/duel-server/src/bridge-api.js";
import type { DeckSuggestionWorkers as DeckSuggestionWorkersType } from "../../packages/duel-server/src/deck-suggestion-workers.js";
import { seedIdentity } from "../../packages/duel-server/tests/helpers/identity.js";

const { BridgeApi } = await import(process.argv.includes("--built")
  ? "../../packages/duel-server/dist/bridge-api.js" : "../../packages/duel-server/src/bridge-api.js");
const { DeckSuggestionWorkers } = await import(process.argv.includes("--built")
  ? "../../packages/duel-server/dist/deck-suggestion-workers.js" : "../../packages/duel-server/src/deck-suggestion-workers.js");
const directory = mkdtempSync(join(tmpdir(), "bridge-engines-bench-"));
const db = new Database(join(directory, "app.sqlite"));
let api: BridgeApiType | undefined, workers: DeckSuggestionWorkersType | undefined;
const p95 = (values: number[]) => Math.round([...values].sort((a, b) => a - b)[Math.ceil(values.length * 0.95) - 1]! * 100) / 100;
try {
  db.pragma("journal_mode = WAL"); migrate(db); importBridgeArtifact(db);
  const actor = seedIdentity(db);
  workers = new DeckSuggestionWorkers(db, directory);
  api = new BridgeApi(db, workers);
  const samples = [];
  for (const format of ["advanced", "genesys"] as const) for (const engines of [["Odion", "Ashtra"], ["The Weather", "Genex", "Synchron", "Blue-Eyes"]]) {
    const run = async () => {
      if (process.argv.includes("--uncached")) db.prepare("UPDATE bridge_graph SET source_version=source_version WHERE id=1").run();
      let block = 0, previous = performance.now();
      const timer = setInterval(() => { const now = performance.now(); block = Math.max(block, now - previous - 2); previous = now; }, 2);
      await new Promise(resolve => setTimeout(resolve, 4));
      const start = performance.now();
      await api!.handle({ userId: actor.userId, bridgeRequest: { op: "engines", engines, format } }, "g", actor.playerId);
      const elapsed = performance.now() - start;
      await new Promise(resolve => setTimeout(resolve, 4)); clearInterval(timer);
      return { elapsed, block };
    };
    const cold = await run(), warm = [];
    for (let i = 0; i < 20; i++) warm.push(await run());
    samples.push({ engines, format, cold_ms: Math.round(cold.elapsed), cold_block_ms: Math.round(cold.block),
      warm_samples: warm.length, p95_ms: p95(warm.map(row => row.elapsed)),
      event_loop_p95_ms: p95(warm.map(row => row.block)), event_loop_max_ms: Math.max(...warm.map(row => row.block)) });
  }
  console.log(JSON.stringify({ node: process.version, runtime: process.argv.includes("--built") ? "built JavaScript workers" : "source TypeScript workers", cache: process.argv.includes("--uncached") ? "invalidated before every call" : "normal five-second TTL", samples }, null, 2));
} finally { await api?.jobs.close(); await workers?.close(); db.close(); rmSync(directory, { recursive: true, force: true }); }
