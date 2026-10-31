import type Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_CARD_EFFECT_ARTIFACT_DIRECTORY } from "./artifact.js";
import { prepareArtifactFile, streamArtifactLines, type PreparedArtifactFile } from "./artifact-stream.js";
import { bridgeHash, printedText } from "./bridge-text.js";
import { engineRankingStats } from "./bridge-engine-ranking.js";
import { bridgeLegal } from "./bridge-engine.js";
import { CAPABILITY_KEYS, REASON_CAPS, type ArchetypeBridge, type BridgeGraphData, type CardCapability } from "./bridge-types.js";

export const BRIDGE_ARTIFACT_MANIFEST_SHA256 = "65bf2e4ba13c9f91c94c6a152d48705e34b53c5743577cb614f93135699c1e52";
export interface BridgeArtifactFile { path: string; records: number; bytes: number; sha256: string; gzipBytes: number; gzipSha256: string }
export interface BridgeManifest {
  schema_version: 1;
  algorithm_version: string;
  inputs: { tags: string; profiles: string; engine: string; metadata: string; genesys_revision: string; groups?: string };
  files: Record<"advanced" | "genesys" | "capabilities", BridgeArtifactFile>;
  groups: BridgeGraphData["groups"];
  group_policies?: BridgeGraphData["group_policies"];
  target_means: BridgeGraphData["target_means"];
  reason_frequencies?: BridgeGraphData["reason_frequencies"];
  ancillary_outlets?: BridgeGraphData["ancillary_outlets"];
  materials?: BridgeGraphData["materials"];
  version: string;
}

export function readBridgeManifest(directory = DEFAULT_CARD_EFFECT_ARTIFACT_DIRECTORY): BridgeManifest {
  const bytes = readFileSync(join(directory, "bridges-manifest.json"));
  if (bridgeHash(bytes.toString("utf8")) !== BRIDGE_ARTIFACT_MANIFEST_SHA256) throw new Error("Bridge manifest does not match pinned integrity");
  const manifest = JSON.parse(bytes.toString("utf8")) as BridgeManifest;
  const { version, ...identity } = manifest;
  if (manifest.schema_version !== 1 || bridgeHash(identity) !== version) throw new Error("Invalid bridge manifest identity");
  for (const [key, path] of [["advanced", "bridges-advanced.jsonl.gz"], ["genesys", "bridges-genesys.jsonl.gz"], ["capabilities", "card-capabilities.jsonl.gz"]] as const) {
    const file = manifest.files[key];
    if (file.path !== path || !Number.isSafeInteger(file.bytes) || file.bytes < 1 || file.bytes > 250_000_000 || !Number.isSafeInteger(file.records) || file.records < 0) throw new Error("Invalid bridge artifact descriptor");
  }
  return manifest;
}

export function importBridgeArtifact(db: Database.Database, directory = DEFAULT_CARD_EFFECT_ARTIFACT_DIRECTORY): { version: string; bridges: number; capabilities: number; skipped: boolean } {
  const manifest = readBridgeManifest(directory), spools = new Map<string, PreparedArtifactFile>();
  try {
    for (const file of Object.values(manifest.files)) spools.set(file.path, prepareArtifactFile(join(directory, file.path), file));
    const bridges = manifest.files.advanced.records + manifest.files.genesys.records;
    const skipped = !!db.prepare("SELECT 1 FROM bridge_artifact_import WHERE version=?").get(manifest.version);
    const rankingRows: ArchetypeBridge[] = [];
    const snapshot = () => {
      const stats = engineRankingStats(manifest.groups, rankingRows);
      return { hubs: [...stats.hubs], idf: { advanced: Object.fromEntries(stats.idf.advanced), genesys: Object.fromEntries(stats.idf.genesys) } };
    };
    if (!skipped) db.transaction(() => {
      db.exec("DELETE FROM archetype_bridge; DELETE FROM card_capability; DELETE FROM bridge_graph;");
      const insertCapability = db.prepare("INSERT INTO card_capability(passcode,capabilities_json,text_hash,evidence_hash,source_version) VALUES(?,?,?,?,?)");
      const cards = new Map<number, CardCapability["card"]>();
      const read = (file: BridgeArtifactFile, consume: (row: any) => void) => {
        let count = 0;
        streamArtifactLines(join(directory, file.path), file, line => { consume(JSON.parse(line)); count++; }, spools.get(file.path));
        if (count !== file.records) throw new Error("Bridge artifact record count mismatch");
      };
      read(manifest.files.capabilities, (row: CardCapability) => {
        if (!Number.isSafeInteger(row.id) || row.id <= 0 || row.id !== row.card.id || cards.has(row.id) || row.text_hash !== bridgeHash(printedText(row.card)) || !/^[a-f0-9]{64}$/.test(row.evidence_hash)
          || [...row.provides, ...row.needs].some(capability => !CAPABILITY_KEYS.includes(capability.key))) throw new Error("Invalid card capability");
        cards.set(row.id, row.card);
        insertCapability.run(row.id, JSON.stringify(row), row.text_hash, row.evidence_hash, manifest.version);
      });
      const insertBridge = db.prepare("INSERT INTO archetype_bridge(source,target,format,score,grade,bridge_json,evidence_hash,source_version) VALUES(?,?,?,?,?,?,?,?)");
      for (const format of ["advanced", "genesys"] as const) read(manifest.files[format], (row: ArchetypeBridge) => {
        if (row.format !== format || !manifest.groups[row.source] || !manifest.groups[row.target] || row.source === row.target || row.validation !== "deterministic" || !Number.isFinite(row.score) || row.score < 0 || row.score > 100 || !/^[a-f0-9]{64}$/.test(row.evidence_hash)
          || row.tier !== undefined && (row.tier !== "niche" || row.grade !== "Niche")
          || !row.reasons.length || row.reasons.some(reason => !Object.hasOwn(REASON_CAPS, reason.key) || reason.cards.some(id => !row.cards.includes(id)))
          || row.cards.some(id => !cards.has(id) || !bridgeLegal(cards.get(id)!, format))) throw new Error("Invalid archetype bridge");
        rankingRows.push(row);
        insertBridge.run(row.source, row.target, row.format, row.score, row.grade, JSON.stringify(row), row.evidence_hash, manifest.version);
      });
      db.prepare("INSERT INTO bridge_graph(id,graph_json,source_version) VALUES(1,?,?)").run(JSON.stringify({ engine_ranking: snapshot(), groups: manifest.groups, group_policies: manifest.group_policies, target_means: manifest.target_means, reason_frequencies: manifest.reason_frequencies, ancillary_outlets: manifest.ancillary_outlets, materials: manifest.materials }), manifest.version);
      db.exec("DELETE FROM bridge_artifact_import");
      db.prepare("INSERT INTO bridge_artifact_import(version) VALUES(?)").run(manifest.version);
    }).immediate();
    // Backfill existing installations from immutable artifact files, never from
    // archetype_bridge, which also contains user-triggered deep-search rows.
    if (skipped && db.prepare("SELECT 1 FROM bridge_graph WHERE source_version=? AND json_type(graph_json,'$.engine_ranking') IS NULL").get(manifest.version)) {
      for (const format of ["advanced", "genesys"] as const) {
        const file = manifest.files[format];
        streamArtifactLines(join(directory, file.path), file, line => rankingRows.push(JSON.parse(line)), spools.get(file.path));
      }
      db.prepare("UPDATE bridge_graph SET graph_json=json_set(graph_json,'$.engine_ranking',json(?)) WHERE source_version=?")
        .run(JSON.stringify(snapshot()), manifest.version);
    }
    return { version: manifest.version, bridges, capabilities: manifest.files.capabilities.records, skipped };
  } finally { for (const spool of spools.values()) spool.close(); }
}
