import type Database from "better-sqlite3";
import type { Card } from "./card.js";
import { bridgeLegal } from "./bridge-engine.js";
import { bridgeEngineRevision } from "./bridge-graph-store.js";
import type { BridgeFormat } from "./bridge-types.js";

const universes = new WeakMap<Database.Database, { revision: number; formats: Map<BridgeFormat, ReadonlySet<number>> }>();

/** Only IDs and legality fields: scoped gates need the global denominator, never the full effect graph. */
export function storedBridgeLegalIds(db: Database.Database, format: BridgeFormat): ReadonlySet<number> {
  const revision = bridgeEngineRevision(db);
  let cached = universes.get(db);
  if (cached?.revision !== revision) {
    cached = { revision, formats: new Map() };
    universes.set(db, cached);
  }
  let ids = cached.formats.get(format);
  if (!ids) {
    const rows = db.prepare(`SELECT passcode, json_object(
      'formats',json_extract(capabilities_json,'$.card.formats'),
      'prerelease',json_extract(capabilities_json,'$.card.prerelease'),
      'subtypes',json_extract(capabilities_json,'$.card.subtypes'),
      'banTcg',json_extract(capabilities_json,'$.card.banTcg'),
      'genesysPoints',json_extract(capabilities_json,'$.card.genesysPoints'),
      'text',CASE WHEN ?='genesys' THEN json_extract(capabilities_json,'$.card.text') ELSE '' END
    ) AS legality_json FROM card_capability`).all(format) as { passcode: number; legality_json: string }[];
    ids = new Set(rows.filter(row => bridgeLegal(JSON.parse(row.legality_json) as Card, format)).map(row => row.passcode));
    cached.formats.set(format, ids);
  }
  return ids;
}
