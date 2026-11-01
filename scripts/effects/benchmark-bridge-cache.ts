import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrate } from "@yugidraft/shared/db";
import { bridgeGate, type ArchetypeBridge } from "@yugidraft/shared/cards/effects";
import { storedBridgeEngine } from "../../packages/shared/dist/cards/effects/bridge-graph-store.js";

// Usage: tsx scripts/effects/benchmark-bridge-cache.ts /path/to/source.sqlite
// The source is opened read-only. Every migration/write uses a disposable backup.
const path = process.argv[2];
if (!path) throw new Error("Pass a source SQLite path; it will only be read.");
const directory = mkdtempSync(join(tmpdir(), "bridge-cache-benchmark-"));
const source = new Database(path, { readonly: true, fileMustExist: true });
let db: Database.Database | undefined;
try {
  await source.backup(join(directory, "scratch.sqlite"));
  source.close();
  db = new Database(join(directory, "scratch.sqlite"));
  migrate(db);
  const row = db.prepare(`SELECT bridge_json FROM archetype_bridge WHERE json_extract(bridge_json,'$.tier')='niche'
    AND json_extract(bridge_json,'$.kind') IS NOT 'synergy' ORDER BY score DESC LIMIT 1`).get() as { bridge_json: string } | undefined;
  if (!row) throw new Error("The source needs a stored Niche bridge.");
  const bridge = JSON.parse(row.bridge_json) as ArchetypeBridge;
  const measure = () => { const start = performance.now(); const gate = bridgeGate(db!, bridge); return { ms: performance.now() - start, state: gate.state }; };
  const cold = measure(), warm = measure(), engine = storedBridgeEngine(db);
  // Lookup UPSERTs reassign these values even when only cache metadata changes.
  const card = db.prepare("SELECT ygoprodeck_id FROM card_catalog LIMIT 1").get() as { ygoprodeck_id: number } | undefined;
  if (!card) throw new Error("The source needs a cached catalog card.");
  db.prepare(`UPDATE card_catalog SET name=name,type=type,frame_type=frame_type,effect_text=effect_text,
    atk=atk,def=def,attribute=attribute,level=level,archetype=archetype,race=race,setcodes_json=setcodes_json,
    is_extra_deck=is_extra_deck,is_prerelease=is_prerelease,cached_at=? WHERE ygoprodeck_id=?`)
    .run(new Date().toISOString(), card.ygoprodeck_id);
  const afterLookup = measure();
  console.log(JSON.stringify({ pair: [bridge.source, bridge.target], coldGateMs: cold.ms, warmGateMs: warm.ms,
    afterLookupGateMs: afterLookup.ms, gate: afterLookup.state, sameEngineAfterLookup: storedBridgeEngine(db) === engine, paidCalls: 0 }, null, 2));
} finally { if (source.open) source.close(); db?.close(); rmSync(directory, { recursive: true, force: true }); }
