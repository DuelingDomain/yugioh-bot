import type Database from "better-sqlite3";
import { BridgeEngine } from "../cards/effects/bridge-engine.js";
import type { ArchetypeBridge, BridgeFormat, BridgeGraphData, BridgeProgress, CapabilityKey, CardCapability } from "../cards/effects/bridge-types.js";
import { shownBridge, type ShownBridge } from "../cards/effects/bridge-judge.js";

/** Construct in the duel-host scanner or an administrative process, never in the web process. */
export function createBridgeService(db: Database.Database) {
  let engine: BridgeEngine | undefined;
  let engineVersion: string | undefined;
  const live = () => {
    const row = db.prepare("SELECT graph_json,source_version FROM bridge_graph WHERE id=1").get() as { graph_json: string; source_version: string } | undefined;
    if (!row) throw new Error("Bridge artifact has not been imported");
    if (!engine || engineVersion !== row.source_version) {
      const graph = JSON.parse(row.graph_json) as Omit<BridgeGraphData, "capabilities">;
      const capabilities: CardCapability[] = [];
      for (const row of db.prepare<[], { capabilities_json: string }>("SELECT capabilities_json FROM card_capability ORDER BY passcode").iterate()) capabilities.push(JSON.parse(row.capabilities_json));
      engine = new BridgeEngine({ ...graph, capabilities });
      engineVersion = row.source_version;
    }
    return engine;
  };
  const stored = (source: string, target: string, format: BridgeFormat): ArchetypeBridge | null => {
    const row = db.prepare("SELECT bridge_json FROM archetype_bridge WHERE source=? COLLATE NOCASE AND target=? COLLATE NOCASE AND format=?").get(source.trim(), target.trim(), format) as { bridge_json: string } | undefined;
    return row ? JSON.parse(row.bridge_json) as ArchetypeBridge : null;
  };
  return {
    bridgesFrom(archetype: string, format: BridgeFormat = "advanced", limit = 4): ArchetypeBridge[] {
      const count = Number.isFinite(limit) ? Math.max(0, Math.min(25, Math.floor(limit))) : 4;
      const rows = db.prepare("SELECT bridge_json FROM archetype_bridge WHERE source=? COLLATE NOCASE AND format=? ORDER BY score DESC,target LIMIT 25").all(archetype.trim(), format) as { bridge_json: string }[];
      return live().distinctTargets(rows.map(row => JSON.parse(row.bridge_json) as ArchetypeBridge), count);
    },
    bridgeBetween(x: string, y: string, format: BridgeFormat = "advanced"): ArchetypeBridge | null {
      const row = stored(x, y, format);
      return row;
    },
    explain(x: string, y: string, format: BridgeFormat = "advanced"): ArchetypeBridge | null {
      const row = stored(x, y, format) ?? live().between(x, y, format);
      return row;
    },
    distinctTargets<T extends ArchetypeBridge>(rows: T[], limit = 4): T[] {
      return live().distinctTargets(rows, limit);
    },
    liveCandidates(source: string, format: BridgeFormat = "advanced", progress?: (progress: BridgeProgress) => void): ArchetypeBridge[] {
      return live().liveCandidates(source, format, progress);
    },
    shownFrom(archetype: string, format: BridgeFormat = "advanced", limit = 4): ShownBridge[] {
      const count = Number.isFinite(limit) ? Math.max(0, Math.min(4, Math.floor(limit))) : 4;
      const rows = db.prepare("SELECT bridge_json FROM archetype_bridge WHERE source=? COLLATE NOCASE AND format=? ORDER BY score DESC,target LIMIT 25").all(archetype.trim(), format) as { bridge_json: string }[];
      const results: ShownBridge[] = [];
      for (const row of rows) {
        const projected = shownBridge(db, JSON.parse(row.bridge_json) as ArchetypeBridge);
        if (projected) results.push(projected);

      }
      return live().distinctTargets(results, count);
    },
    shownBetween(x: string, y: string, format: BridgeFormat = "advanced"): ShownBridge | null {
      const row = stored(x, y, format);
      return row ? shownBridge(db, row) : null;
    },
    capabilities(key: CapabilityKey, direction: "needs" | "provides"): CardCapability[] {
      return (db.prepare(`SELECT capabilities_json FROM card_capability WHERE EXISTS
        (SELECT 1 FROM json_each(capabilities_json,?) WHERE json_extract(value,'$.key')=?) ORDER BY passcode`).all(`$.${direction}`, key) as { capabilities_json: string }[]).map(row => JSON.parse(row.capabilities_json));
    },
  };
}
export type BridgeService = ReturnType<typeof createBridgeService>;
