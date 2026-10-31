import type Database from "better-sqlite3";
import { storedBridgeEngine } from "../cards/effects/bridge-graph-store.js";
import type { ArchetypeBridge, BridgeFormat, BridgeProgress, CapabilityKey, CardCapability } from "../cards/effects/bridge-types.js";
import { shownBridge, type ShownBridge } from "../cards/effects/bridge-judge.js";
import { detectDeckEngines, type BridgeDeck } from "../cards/effects/bridge-engines.js";
import { formatStaples } from "../cards/effects/staples.js";
import type { BridgeGraphData } from "../cards/effects/bridge-types.js";
import { deriveEngineCore, type EngineCorePlan } from "../cards/effects/engine-core.js";
import { type EngineRankingContext } from "../cards/effects/bridge-engine-ranking.js";

/** Construct in the duel-host scanner or an administrative process, never in the web process. */
export function createBridgeService(db: Database.Database) {
  const live = () => storedBridgeEngine(db);
  let graph: { version: string; data: BridgeGraphData } | undefined;
  const parsedGraph = () => {
    const row = db.prepare("SELECT source_version FROM bridge_graph WHERE id=1").get() as { source_version: string } | undefined;
    if (!row) throw new Error("Bridge artifact has not been imported");
    if (graph?.version !== row.source_version) {
      const { graph_json } = db.prepare("SELECT graph_json FROM bridge_graph WHERE id=1").get() as { graph_json: string };
      graph = { version: row.source_version, data: JSON.parse(graph_json) as BridgeGraphData };
    }
    return graph!;
  };
  let ranking: { version: string; context: EngineRankingContext } | undefined;
  const cores = new Map<string, EngineCorePlan>();
  const stored = (source: string, target: string, format: BridgeFormat): ArchetypeBridge | null => {
    const row = db.prepare("SELECT bridge_json FROM archetype_bridge WHERE source=? COLLATE NOCASE AND target=? COLLATE NOCASE AND format=?").get(source.trim(), target.trim(), format) as { bridge_json: string } | undefined;
    return row ? JSON.parse(row.bridge_json) as ArchetypeBridge : null;
  };
  return {
    corePlan(engine: string, format: BridgeFormat): EngineCorePlan {
      const { version } = parsedGraph();
      const revision = (db.prepare("SELECT revision FROM card_catalog_revision WHERE id=1").get() as { revision: number }).revision;
      const key = JSON.stringify([version, revision, format, engine]);
      let plan = cores.get(key);
      if (!plan) {
        plan = deriveEngineCore(live().data, engine, format);
        cores.set(key, plan);
        if (cores.size > 512) cores.delete(cores.keys().next().value!);
      }
      return plan;
    },
    rankingContext(): EngineRankingContext {
      const { version, data: { engine_ranking: stats } } = parsedGraph();
      const revision = (db.prepare("SELECT revision FROM card_catalog_revision WHERE id=1").get() as { revision: number }).revision;
      const rankingVersion = `${version}:${revision}`;
      if (ranking?.version === rankingVersion) return ranking.context;
      if (!stats) throw new Error("Bridge ranking snapshot has not been imported");
      const engine = live();
      const context: EngineRankingContext = { groups: engine.data.groups, hubs: new Set(stats.hubs),
        idf: { advanced: new Map(Object.entries(stats.idf.advanced)), genesys: new Map(Object.entries(stats.idf.genesys)) },
        related: (a, b) => engine.relatedEngines(a, b) };
      ranking = { version: rankingVersion, context }; return context;
    },
    engineRows(engines: readonly string[], format: BridgeFormat): ArchetypeBridge[] {
      const rows = new Map<string, ArchetypeBridge>();
      for (const engine of engines) for (const column of ["source", "target"]) {
        const stored = db.prepare(`SELECT bridge_json FROM archetype_bridge WHERE ${column}=? AND format=? ORDER BY score DESC`).all(engine, format) as { bridge_json: string }[];
        for (const value of stored) { const row = JSON.parse(value.bridge_json) as ArchetypeBridge; rows.set(JSON.stringify([row.source, row.target]), row); }
      }
      return [...rows.values()];
    },
    detectEngines(deck: BridgeDeck, format: BridgeFormat = "advanced", guildId?: string) {
      const groups = live().data.groups;
      const skip = new Set(formatStaples(format === "advanced" ? "normal" : format, undefined, db, guildId).cards.keys());
      const handTraps = db.prepare(`SELECT passcode FROM card_tags WHERE EXISTS
        (SELECT 1 FROM json_each(tags_json,'$.roles') WHERE value='hand_trap')`).all() as { passcode: number }[];
      handTraps.forEach(row => skip.add(row.passcode));
      return detectDeckEngines(deck, groups, skip);
    },
    bridgesFrom(archetype: string, format: BridgeFormat = "advanced", limit = 4): ArchetypeBridge[] {
      const count = Number.isFinite(limit) ? Math.max(0, Math.min(25, Math.floor(limit))) : 4;
      const rows = db.prepare("SELECT bridge_json FROM archetype_bridge WHERE source=? COLLATE NOCASE AND format=? AND coalesce(json_extract(bridge_json,'$.tier'),'strict')<>'niche' ORDER BY score DESC,target LIMIT 25").all(archetype.trim(), format) as { bridge_json: string }[];
      return live().distinctTargets(rows.map(row => JSON.parse(row.bridge_json) as ArchetypeBridge), count);
    },
    bridgeBetween(x: string, y: string, format: BridgeFormat = "advanced"): ArchetypeBridge | null {
      const row = stored(x, y, format);
      return row?.tier === "niche" ? null : row;
    },
    explain(x: string, y: string, format: BridgeFormat = "advanced"): ArchetypeBridge | null {
      const saved = stored(x, y, format);
      const row = saved?.tier !== "niche" && saved ? saved : live().between(x, y, format);
      return row;
    },
    distinctTargets<T extends ArchetypeBridge>(rows: T[], limit = 4): T[] {
      return live().distinctTargets(rows, limit);
    },
    liveCandidates(source: string, format: BridgeFormat = "advanced", progress?: (progress: BridgeProgress) => void): ArchetypeBridge[] {
      return live().liveCandidates(source, format, progress);
    },
    deepCandidates(source: string, format: BridgeFormat = "advanced", progress?: (progress: BridgeProgress) => void, distinct = true): ArchetypeBridge[] {
      return live().deepCandidates(source, format, progress, distinct);
    },
    deepInto(target: string, format: BridgeFormat = "advanced", progress?: (progress: BridgeProgress) => void): ArchetypeBridge[] {
      return live().deepInto(target, format, progress);
    },
    deepBetween(source: string, target: string, format: BridgeFormat = "advanced"): ArchetypeBridge | null {
      return stored(source, target, format) ?? live().deepBetween(source, target, format);
    },
    deepFrom(source: string, format: BridgeFormat = "advanced", limit = 10): ArchetypeBridge[] {
      const rows = db.prepare("SELECT bridge_json FROM archetype_bridge WHERE source=? COLLATE NOCASE AND format=?").all(source.trim(), format) as { bridge_json: string }[];
      return live().deepTargets(rows.map(row => JSON.parse(row.bridge_json) as ArchetypeBridge), Math.max(0, Math.min(25, Math.floor(limit))));
    },
    deepTargets<T extends ArchetypeBridge>(rows: T[], limit = 10): T[] {
      return live().deepTargets(rows, limit);
    },
    shownFrom(archetype: string, format: BridgeFormat = "advanced", limit = 4): ShownBridge[] {
      const count = Number.isFinite(limit) ? Math.max(0, Math.min(4, Math.floor(limit))) : 4;
      const rows = db.prepare("SELECT bridge_json FROM archetype_bridge WHERE source=? COLLATE NOCASE AND format=? AND coalesce(json_extract(bridge_json,'$.tier'),'strict')<>'niche' ORDER BY score DESC,target LIMIT 25").all(archetype.trim(), format) as { bridge_json: string }[];
      const results: ShownBridge[] = [];
      for (const row of rows) {
        const projected = shownBridge(db, JSON.parse(row.bridge_json) as ArchetypeBridge);
        if (projected && projected.tier !== "niche") results.push(projected);

      }
      return live().distinctTargets(results, count);
    },
    shownBetween(x: string, y: string, format: BridgeFormat = "advanced"): ShownBridge | null {
      const row = stored(x, y, format);
      return row && row.tier !== "niche" ? shownBridge(db, row) : null;
    },
    capabilities(key: CapabilityKey, direction: "needs" | "provides"): CardCapability[] {
      return (db.prepare(`SELECT capabilities_json FROM card_capability WHERE EXISTS
        (SELECT 1 FROM json_each(capabilities_json,?) WHERE json_extract(value,'$.key')=?) ORDER BY passcode`).all(`$.${direction}`, key) as { capabilities_json: string }[]).map(row => JSON.parse(row.capabilities_json));
    },
  };
}
export type BridgeService = ReturnType<typeof createBridgeService>;
