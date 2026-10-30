import type Database from "better-sqlite3";
import { BridgeEngine } from "./bridge-engine.js";
import type { BridgeGraphData, CardCapability } from "./bridge-types.js";

const engines = new WeakMap<Database.Database, { version: string; engine: BridgeEngine }>();

/** Share the complete, versioned capability universe between scans and judge validation. */
export function storedBridgeEngine(db: Database.Database): BridgeEngine {
  const row = db.prepare("SELECT graph_json,source_version FROM bridge_graph WHERE id=1").get() as { graph_json: string; source_version: string } | undefined;
  if (!row) throw new Error("Bridge artifact has not been imported");
  const cached = engines.get(db);
  if (cached?.version === row.source_version) return cached.engine;
  const graph = JSON.parse(row.graph_json) as Omit<BridgeGraphData, "capabilities">;
  const capabilities = (db.prepare("SELECT capabilities_json FROM card_capability ORDER BY passcode").all() as { capabilities_json: string }[])
    .map(row => JSON.parse(row.capabilities_json) as CardCapability);
  const engine = new BridgeEngine({ ...graph, capabilities });
  engines.set(db, { version: row.source_version, engine });
  return engine;
}
