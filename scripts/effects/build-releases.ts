/** Rebuild release facts from the owner-approved, read-only searchygo cards.json. */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { cleanReleaseMonth } from "@yugidraft/shared/cards/effects";
const input = process.argv[2];
if (!input) throw new Error("Usage: tsx scripts/effects/build-releases.ts <searchygo/data/cards.json>");
const sha = (value: Buffer | string) => createHash("sha256").update(value).digest("hex");
const bytes = readFileSync(input), root = "packages/shared/data/effects/";
const rows = JSON.parse(bytes.toString("utf8")) as { id: number; name: string; aliases?: number[]; tcgDate?: string; ocgDate?: string }[];
const records = rows.sort((a, b) => a.id - b.id).map(card => {
  const tcgDate = cleanReleaseMonth(card.tcgDate, "tcg"), ocgDate = cleanReleaseMonth(card.ocgDate, "ocg");
  return { id: card.id, name: card.name, aliases: card.aliases ?? [], tcgDate: tcgDate ?? null, ocgDate: ocgDate ?? null,
    quality: (card.tcgDate && !tcgDate) || (card.ocgDate && !ocgDate) ? "placeholder" : tcgDate || ocgDate ? "ok" : "unknown" };
});
const content = Buffer.from(JSON.stringify(records) + "\n"), compressed = gzipSync(content, { level: 9 });
writeFileSync(root + "releases.json.gz", compressed);
const manifest = JSON.parse(readFileSync(root + "manifest.json", "utf8"));
manifest.files.releases = { path: "releases.json.gz", sourcePath: "data/cards.json", sourceSha256: sha(bytes), records: records.length,
  bytes: content.length, sha256: sha(content), gzipBytes: compressed.length, gzipSha256: sha(compressed) };
const { artifactVersion: _old, ...identity } = manifest;
manifest.artifactVersion = sha(JSON.stringify(identity));
const manifestBytes = JSON.stringify(manifest, null, 2) + "\n";
writeFileSync(root + "manifest.json", manifestBytes);
const source = "packages/shared/src/cards/effects/artifact.ts";
let code = readFileSync(source, "utf8");
for (const [key, value] of [["CARD_EFFECT_ARTIFACT_VERSION", manifest.artifactVersion], ["CARD_EFFECT_ARTIFACT_MANIFEST_SHA256", sha(manifestBytes)]]) {
  code = code.replace(new RegExp(`(export const ${key} = ")[a-f0-9]{64}(";)`), `$1${value}$2`);
}
writeFileSync(source, code);
console.info(JSON.stringify({ records: records.length, gzipBytes: compressed.length, version: manifest.artifactVersion }));
