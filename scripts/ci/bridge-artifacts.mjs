import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";

const DATA = "packages/shared/data/effects";
export const BRIDGE_PIN_FILE = "packages/shared/src/cards/effects/bridge-artifact.ts";
export const BRIDGE_FILES = ["bridges-advanced.jsonl.gz", "bridges-genesys.jsonl.gz", "card-capabilities.jsonl.gz", "bridges-manifest.json"].map(file => `${DATA}/${file}`).concat(BRIDGE_PIN_FILE);
const sha = bytes => createHash("sha256").update(bytes).digest("hex");

/** Inert data plus one literal integrity pin; candidate source is never executed. */
export function validateBridgeCandidate(root, output, bridge) {
  if (!bridge) return [];
  if (JSON.stringify([...bridge.files].sort()) !== JSON.stringify([...BRIDGE_FILES].sort()) || !/^[a-f0-9]{64}$/.test(bridge.manifest_sha256)) throw new Error("Invalid bridge publication paths");
  for (const file of BRIDGE_FILES) if (!lstatSync(join(output, file)).isFile() || lstatSync(join(output, file)).isSymbolicLink()) throw new Error("Bridge publication requires regular files");
  const bytes = readFileSync(join(output, DATA, "bridges-manifest.json"));
  if (sha(bytes) !== bridge.manifest_sha256 || bytes.length > 10_000_000) throw new Error("Bridge manifest integrity mismatch");
  const manifest = JSON.parse(bytes), { version, ...identity } = manifest;
  if (version !== sha(JSON.stringify(identity)) || version !== bridge.version || manifest.schema_version !== 1) throw new Error("Invalid bridge manifest identity");
  const cardIds = new Set();
  for (const [key, path] of [["capabilities", "card-capabilities.jsonl.gz"], ["advanced", "bridges-advanced.jsonl.gz"], ["genesys", "bridges-genesys.jsonl.gz"]]) {
    const file = manifest.files[key];
    if (file.path !== path || !Number.isSafeInteger(file.bytes) || file.bytes < 1 || file.bytes > 250_000_000 || !Number.isSafeInteger(file.records) || file.records < 0) throw new Error("Invalid bridge artifact bounds");
    const compressed = readFileSync(join(output, DATA, path));
    if (compressed.length !== file.gzipBytes || sha(compressed) !== file.gzipSha256) throw new Error("Bridge compressed integrity mismatch");
    const content = gunzipSync(compressed, { maxOutputLength: file.bytes });
    if (content.length !== file.bytes || sha(content) !== file.sha256) throw new Error("Bridge content integrity mismatch");
    const rows = content.toString("utf8").trim().split("\n").filter(Boolean).map(JSON.parse);
    if (rows.length !== file.records) throw new Error("Invalid bridge row count");
    const counts = new Map();
    for (const row of rows) {
      if (!/^[a-f0-9]{64}$/.test(row.evidence_hash)) throw new Error("Missing bridge evidence hash");
      if (key === "capabilities") {
        if (!Number.isSafeInteger(row.id) || row.id <= 0 || row.id > 0xffffffff || row.card?.id !== row.id || cardIds.has(row.id) || !Array.isArray(row.provides) || !Array.isArray(row.needs)) throw new Error("Invalid capability identity");
        cardIds.add(row.id);
      } else {
        if (row.format !== key || row.validation !== "deterministic" || !Number.isFinite(row.score) || row.score < 0 || row.score > 100 || !manifest.groups[row.source] || !manifest.groups[row.target] || !row.reasons?.length || row.cards.some(id => !cardIds.has(id))) throw new Error("Invalid bridge row");
        counts.set(row.source, (counts.get(row.source) ?? 0) + 1);
        if (counts.get(row.source) > 25) throw new Error("Bridge source exceeds top 25");
      }
    }
  }
  const before = readFileSync(join(root, BRIDGE_PIN_FILE), "utf8"), after = readFileSync(join(output, BRIDGE_PIN_FILE), "utf8");
  const pin = /(export const BRIDGE_ARTIFACT_MANIFEST_SHA256 = ")[a-f0-9]{64}(";)/g;
  if ([...before.matchAll(pin)].length !== 1 || before.replace(pin, `$1${bridge.manifest_sha256}$2`) !== after) throw new Error("Bridge publication altered source outside its integrity pin");
  return BRIDGE_FILES;
}
