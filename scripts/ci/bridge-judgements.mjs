import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";

export const BRIDGE_JUDGEMENT_FILE = "packages/shared/data/effects/bridge-judgements.jsonl.gz";
const sha = bytes => createHash("sha256").update(bytes).digest("hex"), equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const key = row => `${row.evidence_hash}:${row.judge}`;
const decode = path => {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 30_000_000) throw new Error("Bridge judgements require a bounded regular file");
  return gunzipSync(readFileSync(path), { maxOutputLength: 150_000_000 }).toString("utf8").split("\n").filter(Boolean).map(JSON.parse);
};

/** Publication accepts inert rows backed by the collected Batch report only. */
export function validateBridgeJudgementCandidate(root, output, metadata) {
  if (!metadata) return [];
  if (!equal(metadata.files, [BRIDGE_JUDGEMENT_FILE]) || !/^[a-f0-9]{64}$/.test(metadata.sha256) || !/^[a-f0-9]{64}$/.test(metadata.base_sha256)) throw new Error("Invalid bridge judgement publication paths");
  const before = new Map(decode(join(root, BRIDGE_JUDGEMENT_FILE)).map(row => [key(row), row])), rows = decode(join(output, BRIDGE_JUDGEMENT_FILE)), seen = new Set();
  if (sha(readFileSync(join(root, BRIDGE_JUDGEMENT_FILE))) !== metadata.base_sha256 || sha(readFileSync(join(output, BRIDGE_JUDGEMENT_FILE))) !== metadata.sha256) throw new Error("Bridge judgement publication integrity mismatch");
  const report = JSON.parse(readFileSync(join(output, "bridge-judge-report.json"), "utf8"));
  if (report.mode !== "live" || !Array.isArray(report.acceptedRecords) || rows.length !== metadata.records) throw new Error("Missing live bridge judgement provenance");
  const accepted = new Map(report.acceptedRecords.map(row => [key(row), row]));
  for (const row of rows) {
    const result = row.result, identity = key(row);
    if (seen.has(identity) || !/^[a-f0-9]{64}$/.test(row.evidence_hash) || !/^[a-f0-9]{64}$/.test(row.input_hash)
      || !["mechanic", "skeptic"].includes(row.framing) || !["claude-haiku-5-5", "claude-sonnet-5-5"].includes(row.model) || !new RegExp(`^${row.model}:${row.framing}:[a-f0-9]{64}:${row.input_hash}$`).test(row.judge)
      || !Number.isFinite(Date.parse(row.created_at)) || !result || !["valid", "invalid", "unsure"].includes(result.verdict) || !["strong", "good", "niche", "risky"].includes(result.grade)
      || [result.pros, result.cons].some(items => !Array.isArray(items) || items.length > 3 || items.some(item => typeof item !== "string" || !item.trim() || item.length > 500))
      || typeof result.lock_note !== "string" || result.lock_note.length > 1500 || typeof result.format_ok !== "boolean" || !Array.isArray(result.line) || result.verdict === "valid" && result.line.length < 1 || result.line.length > (equal(before.get(identity), row) ? 32 : 3) || result.line.some(name => typeof name !== "string" || !name.trim() || name.length > 200)) throw new Error("Invalid bridge judgement record");
    seen.add(identity);
    if (!equal(before.get(identity), row) && !equal(accepted.get(identity), row)) throw new Error("Bridge judgement differs from collected Batch results");
  }
  for (const identity of before.keys()) if (!seen.has(identity)) throw new Error("Bridge judgement publication discarded cached evidence");
  return [BRIDGE_JUDGEMENT_FILE];
}
