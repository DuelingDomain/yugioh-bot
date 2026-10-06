import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { createCardCatalogService } from "../services/card-catalog.js";
import { loadArtworkIdentityCatalog } from "../services/card-artworks.js";

const API = "https://db.ygoprodeck.com/api/v7/cardinfo.php";
type Checkpoint = { database: string; dumpHash: string; afterId: number };

function atomicWrite(path: string, contents: string): void {
  writeFileSync(`${path}.tmp`, contents);
  renameSync(`${path}.tmp`, path);
}

/** No migrations, implicit database path, per-card network calls, or image downloads. */
export async function backfillCardArtworks(input: {
  database: string;
  dump: string;
  state: string;
  fetch?: typeof globalThis.fetch;
  dryRun?: boolean;
  onProgress?: (id: number) => void;
}) {
  // npm --workspace changes cwd; INIT_CWD retains the invocation directory.
  // Direct node invocations default to the repo root, in src and built dist alike.
  const root = process.env.INIT_CWD || fileURLToPath(new URL("../../../../", import.meta.url));
  const database = resolve(root, input.database);
  const dump = resolve(root, input.dump);
  const state = resolve(root, input.state);
  const engineDirectory = resolve(root, process.env.DUEL_DATA_DIR || "data/duel-engine");
  if (new Set([database, dump, state, `${dump}.tmp`, `${state}.tmp`]).size !== 5) {
    throw new Error("Database, dump and checkpoint paths must be distinct");
  }
  const db = new Database(database, { fileMustExist: true, readonly: input.dryRun === true });
  try {
    db.pragma("foreign_keys = ON"); db.pragma("busy_timeout = 5000");
    // Fail before downloading if the application's artwork migration has not been applied.
    db.prepare("select source from card_artworks limit 1").get();
    let contents: string;
    if (existsSync(dump)) contents = readFileSync(dump, "utf8");
    else {
      if (existsSync(state)) throw new Error("Checkpoint exists but its dump is missing; restore the dump or use new dump/state paths");
      // Exactly one request. No automatic retry loop; resume manually after an upstream error.
      const response = await (input.fetch ?? globalThis.fetch)(API, { signal: AbortSignal.timeout(120_000), redirect: "error" });
      if (!response.ok) throw new Error(`Card dump download failed (${response.status}); retry later`);
      contents = await response.text();
      const payload = JSON.parse(contents) as { data?: unknown };
      if (!Array.isArray(payload.data)) throw new Error("Invalid card dump");
      atomicWrite(dump, contents);
    }
    const dumpHash = createHash("sha256").update(contents).digest("hex");
    const payload: unknown = JSON.parse(contents);
    let afterId = 0;
    if (existsSync(state)) {
      const checkpoint = JSON.parse(readFileSync(state, "utf8")) as Checkpoint;
      if (checkpoint.database !== database || checkpoint.dumpHash !== dumpHash
        || !Number.isSafeInteger(checkpoint.afterId) || checkpoint.afterId < 0) {
        throw new Error("Checkpoint does not match this database and dump; use a new state path");
      }
      afterId = checkpoint.afterId;
    }
    const catalog = createCardCatalogService(db, { identityCatalog: loadArtworkIdentityCatalog(engineDirectory), fetch: async () => ({ ok: true, status: 200, json: async () => payload }) });
    return await catalog.backfillExistingArtworks({ afterId, dryRun: input.dryRun, onProgress: id => {
      atomicWrite(state, JSON.stringify({ database, dumpHash, afterId: id } satisfies Checkpoint));
      input.onProgress?.(id);
    } });
  } finally { db.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { values } = parseArgs({ options: { database: { type: "string" }, dump: { type: "string" }, state: { type: "string" }, "dry-run": { type: "boolean", default: false } } });
  if (!values.database || !values.dump || !values.state) {
    console.error("Usage: backfill-card-artworks --database /path/bot.sqlite --dump /path/cardinfo.json --state /path/artworks-state.json [--dry-run]");
    process.exitCode = 1;
  } else {
    let completed = 0;
    backfillCardArtworks({ database: values.database, dump: values.dump, state: values.state, dryRun: values["dry-run"],
      onProgress: id => { if (++completed % 100 === 0) console.log(`Synced ${completed} families; checkpoint ${id}`); },
    }).then(report => console.log(JSON.stringify(report))).catch(error => { console.error(error); process.exitCode = 1; });
  }
}
