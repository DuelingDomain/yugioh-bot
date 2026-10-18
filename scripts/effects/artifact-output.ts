import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { gzipSync } from "node:zlib";
import { CardTags } from "@yugidraft/shared/cards/effects";
import { CARD_EFFECT_TEXT_NORMALIZATION } from "@yugidraft/shared/cards/effects";
import { readPinnedArtifact } from "./catalog.js";
import { MODEL, type AcceptedTag } from "./budget-ledger.js";

const sha = (value: Buffer | string) => createHash("sha256").update(value).digest("hex");
export const EFFECT_UPDATE_FILES = ["packages/shared/data/effects/manifest.json", "packages/shared/data/effects/tags.jsonl.gz", "packages/shared/data/effects/source-hashes.json.gz", "packages/shared/src/cards/effects/artifact.ts"] as const;
export interface EffectArtifactCandidate { version: 1; changed: boolean; baseSha: string; baseVersion: string; artifactVersion?: string; manifestSha256?: string; files: string[] }

/** Write only to an output directory. Publication reviews four precise paths;
 * current engine resources and the checked-out artifact are never modified.
 */
export function writeEffectArtifactCandidate(options: { root: string; outputDirectory: string; baseSha: string; accepted: AcceptedTag[] }): EffectArtifactCandidate {
  if (!/^[a-f0-9]{40}$/.test(options.baseSha)) throw new Error("Candidate baseSha must be an immutable commit SHA");
  const dataPath = "packages/shared/data/effects", baseDirectory = join(options.root, dataPath);
  const artifact = readPinnedArtifact(baseDirectory);
  const replacements = options.accepted.filter(tag => artifact.hashes[tag.id] !== tag.inputHash);
  const candidate: EffectArtifactCandidate = { version: 1, changed: Boolean(replacements.length), baseSha: options.baseSha, baseVersion: artifact.manifest.artifactVersion, files: [] };
  mkdirSync(options.outputDirectory, { recursive: true });
  const metadataPath = join(options.outputDirectory, "update.json");
  if (!replacements.length) { writeFileSync(metadataPath, JSON.stringify(candidate, null, 2) + "\n"); return candidate; }
  const output = join(options.outputDirectory, dataPath); mkdirSync(output, { recursive: true });
  const rows = new Map(artifact.tags.map(row => [row.id, row]));
  const hashes = { ...artifact.hashes }, seen = new Set<number>();
  for (const entry of [...replacements].sort((a, b) => a.id - b.id)) {
    if (seen.has(entry.id) || !Number.isSafeInteger(entry.id) || entry.id <= 0 || entry.id > 0xffffffff || entry.model !== MODEL || !/^[a-f0-9]{64}$/.test(entry.inputHash)) throw new Error("Invalid accepted artifact identity");
    seen.add(entry.id);
    rows.set(entry.id, { id: entry.id, name: entry.name, model: MODEL, tags: CardTags.parse(entry.tags) });
    hashes[entry.id] = entry.inputHash;
  }
  const manifest = structuredClone(artifact.manifest);
  const generatedAt = [...replacements].map(row => row.taggedAt).sort().at(-1)!;
  manifest.generation = { kind: "anthropic-message-batches", model: MODEL, baseArtifactVersion: candidate.baseVersion,
    inputSource: "prepared-engine-card-text", normalization: CARD_EFFECT_TEXT_NORMALIZATION, acceptedCards: replacements.length,
    generatedAt, reservationIds: [...new Set(replacements.map(row => row.reservationId))].sort(),
    promptHashes: [...new Set(replacements.map(row => row.promptHash))].sort(),
    acceptedResultsSha256: sha(JSON.stringify([...replacements].sort((a, b) => a.id - b.id))) };
  const emit = (key: "tags" | "sourceHashes", path: string, bytes: Buffer, count: number) => {
    const compressed = gzipSync(bytes, { level: 9 }); writeFileSync(join(output, path), compressed);
    const prior = manifest.files[key];
    const { sourceSha256: _priorInputHash, ...descriptor } = prior;
    manifest.files[key] = { ...descriptor, baseSourcePath: prior.baseSourcePath ?? prior.sourcePath,
      baseSourceSha256: prior.baseSourceSha256 ?? prior.sourceSha256 ?? prior.sha256,
      path, sourcePath: key === "tags" ? "upstream-tags-plus-validated-batch-results" : "actual-tagged-input-text",
      records: count, bytes: bytes.length, sha256: sha(bytes), gzipBytes: compressed.length, gzipSha256: sha(compressed) };
  };
  emit("tags", "tags.jsonl.gz", Buffer.from([...rows.values()].map(row => JSON.stringify(row)).join("\n") + "\n"), rows.size);
  const orderedHashes = Object.fromEntries(Object.entries(hashes).sort(([a], [b]) => Number(a) - Number(b)));
  emit("sourceHashes", "source-hashes.json.gz", Buffer.from(JSON.stringify({ version: 1, normalization: CARD_EFFECT_TEXT_NORMALIZATION, hashes: orderedHashes }) + "\n"), rows.size);
  manifest.files.sourceHashes.knownRecords = Object.values(hashes).filter(value => value !== null).length;
  for (const file of ["profiles.jsonl.gz", "popularity.json.gz"]) copyFileSync(join(baseDirectory, file), join(output, file));
  const { artifactVersion: _old, ...identity } = manifest;
  manifest.artifactVersion = sha(JSON.stringify(identity));
  const manifestBytes = JSON.stringify(manifest, null, 2) + "\n"; writeFileSync(join(output, "manifest.json"), manifestBytes);
  const sourcePath = "packages/shared/src/cards/effects/artifact.ts";
  let source = readFileSync(join(options.root, sourcePath), "utf8");
  for (const [constant, value] of [["CARD_EFFECT_ARTIFACT_VERSION", manifest.artifactVersion], ["CARD_EFFECT_ARTIFACT_MANIFEST_SHA256", sha(manifestBytes)]]) {
    const pattern = new RegExp(`(export const ${constant} = ")[a-f0-9]{64}(";)`, "g");
    if ([...source.matchAll(pattern)].length !== 1) throw new Error(`Missing unique artifact pin ${constant}`);
    source = source.replace(pattern, (_whole, prefix, suffix) => `${prefix}${value}${suffix}`);
  }
  mkdirSync(dirname(join(options.outputDirectory, sourcePath)), { recursive: true }); writeFileSync(join(options.outputDirectory, sourcePath), source);
  Object.assign(candidate, { artifactVersion: manifest.artifactVersion, manifestSha256: sha(manifestBytes), files: [...EFFECT_UPDATE_FILES] });
  writeFileSync(metadataPath, JSON.stringify(candidate, null, 2) + "\n");
  return candidate;
}
