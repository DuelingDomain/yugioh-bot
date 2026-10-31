import type Database from "better-sqlite3";
import { BridgeEngine } from "./bridge-engine.js";
import type { BridgeGraphData, CardCapability } from "./bridge-types.js";

const engines = new WeakMap<Database.Database, { version: string; catalogRevision: number; engine: BridgeEngine }>();

/** Share the complete, versioned capability universe between scans and judge validation. */
export function storedBridgeEngine(db: Database.Database): BridgeEngine {
  const row = db.prepare("SELECT source_version FROM bridge_graph WHERE id=1").get() as { source_version: string } | undefined;
  if (!row) throw new Error("Bridge artifact has not been imported");
  const catalogRevision = (db.prepare("SELECT revision FROM card_catalog_revision WHERE id=1").get() as { revision: number }).revision;
  const cached = engines.get(db);
  if (cached?.version === row.source_version && cached.catalogRevision === catalogRevision) return cached.engine;
  const { graph_json } = db.prepare("SELECT graph_json FROM bridge_graph WHERE id=1").get() as { graph_json: string };
  const graph = JSON.parse(graph_json) as Omit<BridgeGraphData, "capabilities">;
  const capabilities = (db.prepare("SELECT capabilities_json FROM card_capability ORDER BY passcode").all() as { capabilities_json: string }[])
    .map(row => JSON.parse(row.capabilities_json) as CardCapability);
  const engine = new BridgeEngine({ ...graph, capabilities });
  engines.set(db, { version: row.source_version, catalogRevision, engine });
  return engine;
}
