import type Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { DEFAULT_CARD_EFFECT_ARTIFACT_DIRECTORY } from "./artifact.js";
import { BridgeJudgementRecordSchema, bridgeJudgeIdentity, buildBridgeJudgeEvidence, parseBridgeJudgement, saveBridgeJudgement, type BridgeJudgementRecord } from "./bridge-judge.js";
import { bridgeHash } from "./bridge-text.js";
import type { ArchetypeBridge } from "./bridge-types.js";

export const BRIDGE_JUDGEMENTS_FILENAME = "bridge-judgements.jsonl.gz";
export function importBridgeJudgements(db: Database.Database, directory = DEFAULT_CARD_EFFECT_ARTIFACT_DIRECTORY): { imported: number; skipped: number } {
  const path = join(directory, BRIDGE_JUDGEMENTS_FILENAME);
  if (!existsSync(path)) return { imported: 0, skipped: 0 };
  const compressed = readFileSync(path);
  if (compressed.length > 30_000_000) throw new Error("Bridge judgement artifact is too large");
  const text = gunzipSync(compressed, { maxOutputLength: 150_000_000 }).toString("utf8");
  let imported = 0, skipped = 0;
  db.transaction(() => {
    for (const line of text.split("\n")) {
      if (!line) continue;
      const row = BridgeJudgementRecordSchema.parse(JSON.parse(line));
      if (row.judge !== bridgeJudgeIdentity(row, row.framing)) { skipped++; continue; }
      const candidates = db.prepare("SELECT bridge_json FROM archetype_bridge WHERE evidence_hash=?").all(row.evidence_hash) as { bridge_json: string }[];
      const evidence = candidates.map(candidate => buildBridgeJudgeEvidence(db, JSON.parse(candidate.bridge_json) as ArchetypeBridge)).find(evidence => evidence?.input_hash === row.input_hash);
      if (!evidence) { skipped++; continue; }
      const result = parseBridgeJudgement(row.result, evidence, db, true);
      if (!result) throw new Error("Invalid bridge judgement artifact record");
      const existing = db.prepare("SELECT created_at FROM bridge_judgement WHERE evidence_hash=? AND judge=?").get(row.evidence_hash, row.judge) as { created_at: string } | undefined;
      if (existing && existing.created_at > row.created_at) { skipped++; continue; }
      saveBridgeJudgement(db, { ...row, result }); imported++;
    }
  }).immediate();
  return { imported, skipped };
}

export function exportBridgeJudgements(db: Database.Database, directory = DEFAULT_CARD_EFFECT_ARTIFACT_DIRECTORY): { records: number; sha256: string; gzipSha256: string } {
  const records = (db.prepare("SELECT judgement_json FROM bridge_judgement ORDER BY evidence_hash,judge").all() as { judgement_json: string }[])
    .map(row => BridgeJudgementRecordSchema.parse(JSON.parse(row.judgement_json)))
    .filter(row => row.judge === bridgeJudgeIdentity(row, row.framing));
  return writeBridgeJudgements(records, directory);
}

export function writeBridgeJudgements(records: BridgeJudgementRecord[], directory = DEFAULT_CARD_EFFECT_ARTIFACT_DIRECTORY): { records: number; sha256: string; gzipSha256: string } {
  const seen = new Set<string>();
  const checked = records.map(row => BridgeJudgementRecordSchema.parse(row)).sort((a, b) => a.evidence_hash.localeCompare(b.evidence_hash) || a.judge.localeCompare(b.judge));
  for (const row of checked) {
    const key = `${row.evidence_hash}:${row.judge}`;
    if (seen.has(key) || row.judge !== bridgeJudgeIdentity(row, row.framing)) throw new Error("Duplicate or stale bridge judgement artifact record");
    seen.add(key);
  }
  const bytes = checked.length ? checked.map(row => JSON.stringify(row)).join("\n") + "\n" : "";
  const gzip = gzipSync(bytes, { level: 9 });
  mkdirSync(directory, { recursive: true });
  const path = join(directory, BRIDGE_JUDGEMENTS_FILENAME);
  writeFileSync(`${path}.next`, gzip); renameSync(`${path}.next`, path);
  return { records: checked.length, sha256: bridgeHash(bytes), gzipSha256: createHash("sha256").update(gzip).digest("hex") };
}
