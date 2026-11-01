import { readFileSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { buildMechanicFacts } from "../../packages/shared/src/cards/effects/bridge-mechanic-facts.js";
import type { TaggedCard } from "../../packages/shared/src/cards/effects/tags.js";

export function writeMechanicFacts(tagsPath: string, output: string) {
  const bytes = readFileSync(tagsPath);
  const rows = gunzipSync(bytes, { maxOutputLength: 50_000_000 }).toString().trim().split("\n").map(line => JSON.parse(line) as TaggedCard);
  const artifact = buildMechanicFacts(rows, createHash("sha256").update(bytes).digest("hex"));
  writeFileSync(output, JSON.stringify(artifact) + "\n");
  return artifact;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const directory = resolve(import.meta.dirname, "../../packages/shared/data/effects");
  const artifact = writeMechanicFacts(process.argv[2] ?? `${directory}/tags.jsonl.gz`, process.argv[3] ?? `${directory}/bridge-mechanic-facts.json`);
  console.log(`Mechanic facts: ${Object.keys(artifact.cards).length} cards; ${artifact.version}`);
}
