import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { gzipSync, gunzipSync } from "node:zlib";
import { loadTaggingCatalog } from "./catalog.js";
import { buildMechanicFacts } from "../../packages/shared/src/cards/effects/bridge-mechanic-facts.js";
import { parseGenesysPointsSnapshot } from "@yugidraft/shared/services";
import { PINNED_TCG_BANLIST_ID } from "@yugidraft/shared/duels";
import { extractCardCapabilities, BridgeEngine, bridgeGroups, indexBridgeCapabilities, bridgeHash,
  type BridgeArtifactFile, type BridgeManifest, type TaggedCard, type ProfiledArchetype, type BridgeGraphData } from "@yugidraft/shared/cards/effects";

const sha = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
const root = resolve(import.meta.dirname, "../..");
const data = "packages/shared/data/effects";
export const BRIDGE_UPDATE_FILES = ["bridges-advanced.jsonl.gz", "bridges-genesys.jsonl.gz", "card-capabilities.jsonl.gz", "bridge-mechanic-facts.json", "bridges-manifest.json"].map(file => `${data}/${file}`);

export async function rebuildBridges(options: { engineDirectory: string; directory?: string; output?: string; metadata?: string; pin?: string }) {
  const started = performance.now(), directory = resolve(options.directory ?? join(root, data)), output = resolve(options.output ?? directory);
  const decode = <T>(file: string): T[] => gunzipSync(readFileSync(join(directory, file))).toString("utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line));
  const tags = decode<TaggedCard>("tags.jsonl.gz"), profiles = decode<ProfiledArchetype>("profiles.jsonl.gz");
  let metadataBytes: Buffer;
  if (options.metadata) metadataBytes = readFileSync(options.metadata);
  else {
    const response = await fetch("https://db.ygoprodeck.com/api/v7/cardinfo.php?format=genesys&misc=yes", { signal: AbortSignal.timeout(45_000) });
    if (!response.ok) throw new Error(`Card metadata download failed: ${response.status}`);
    metadataBytes = Buffer.from(await response.arrayBuffer());
  }
  const metadata = JSON.parse(metadataBytes.toString("utf8"));
  const points = parseGenesysPointsSnapshot(metadata);
  const byId = new Map<number, any>(metadata.data.map((card: any) => [card.id, card]));
  const byName = new Map<string, any>(metadata.data.map((card: any) => [card.name.toLowerCase(), card]));
  const tagById = new Map(tags.map(tag => [tag.id, tag.tags])), tagByName = new Map(tags.map(tag => [tag.name.toLowerCase(), tag.tags]));
  const pointById = new Map(points.cards.map(card => [card.id, card.points]));
  const profileByName = new Map(profiles.map(row => [row.archetype, row.profile]));
  const banlistPath = "../../packages/duel-server/src/banlists/index.js";
  const { banlistLimitsFor } = await import(banlistPath);
  const banned = banlistLimitsFor(PINNED_TCG_BANLIST_ID)!;
  const cards = await loadTaggingCatalog(options.engineDirectory);
  for (const card of cards) {
    const source = byId.get(card.id) ?? byName.get(card.name.toLowerCase());
    card.formats = source?.misc_info?.[0]?.formats ?? [];
    // Engine CDB supplies every printed identity field; the bulk API supplies only legality and the primary group label.
    card.archetype = source?.archetype ?? card.archetype;
    const limit = banned[card.id];
    card.banTcg = limit === 0 ? "Forbidden" : limit === 1 ? "Limited" : limit === 2 ? "Semi-Limited" : undefined;
    card.genesysPoints = source ? pointById.get(source.id) : undefined;
  }
  const capabilities = cards.filter(card => card.formats.includes("TCG") && !card.prerelease && !card.subtypes.includes("token"))
    .sort((a, b) => a.id - b.id).map(card => extractCardCapabilities(card, tagById.get(card.id) ?? tagByName.get(card.name.toLowerCase()), profileByName.get(card.archetype ?? "")));
  const policyBytes = readFileSync(join(directory, "bridge-groups.json"));
  const group_policies: BridgeGraphData["group_policies"] = JSON.parse(policyBytes.toString("utf8"));
  const groups = bridgeGroups(capabilities, profileByName, group_policies);
  indexBridgeCapabilities(capabilities);
  const graph: BridgeGraphData = { capabilities, groups, group_policies, target_means: { advanced: {}, genesys: {} } };
  const engine = new BridgeEngine(graph);
  console.error(`Bridge index: ${capabilities.length} cards, ${Object.keys(groups).length} groups`);
  let lastProgress = 0;
  const bridges = engine.rebuild(progress => {
    if (performance.now() - lastProgress > 15_000) { console.error(`${progress.phase}: ${progress.completed}/${progress.total}`); lastProgress = performance.now(); }
  });
  mkdirSync(output, { recursive: true });
  writeFileSync(join(output, "bridge-mechanic-facts.json"), JSON.stringify(buildMechanicFacts(tags, sha(readFileSync(join(directory, "tags.jsonl.gz"))))) + "\n");
  const emit = (path: string, rows: unknown[]): BridgeArtifactFile => {
    const bytes = Buffer.from(rows.map(row => JSON.stringify(row)).join("\n") + "\n"), compressed = gzipSync(bytes, { level: 9 });
    writeFileSync(join(output, path), compressed);
    return { path, records: rows.length, bytes: bytes.length, sha256: sha(bytes), gzipBytes: compressed.length, gzipSha256: sha(compressed) };
  };
  const identity: Omit<BridgeManifest, "version"> = {
    schema_version: 1, algorithm_version: "capability-bridges-v6-access",
    inputs: { tags: sha(readFileSync(join(directory, "tags.jsonl.gz"))), profiles: sha(readFileSync(join(directory, "profiles.jsonl.gz"))),
      engine: sha(readFileSync(join(options.engineDirectory, "cards.cdb"))), metadata: sha(metadataBytes), genesys_revision: points.revision, groups: sha(policyBytes) },
    files: { capabilities: emit("card-capabilities.jsonl.gz", capabilities), advanced: emit("bridges-advanced.jsonl.gz", bridges.filter(row => row.format === "advanced")), genesys: emit("bridges-genesys.jsonl.gz", bridges.filter(row => row.format === "genesys")) },
    groups, group_policies, target_means: graph.target_means, reason_frequencies: graph.reason_frequencies, ancillary_outlets: graph.ancillary_outlets, materials: graph.materials,
  };
  const manifest: BridgeManifest = { ...identity, version: bridgeHash(identity) };
  const manifestBytes = JSON.stringify(manifest) + "\n";
  writeFileSync(join(output, "bridges-manifest.json"), manifestBytes);
  const pinPath = options.pin ?? join(root, "packages/shared/src/cards/effects/bridge-artifact.ts");
  const pin = readFileSync(pinPath, "utf8").replace(/(export const BRIDGE_ARTIFACT_MANIFEST_SHA256 = ")[a-f0-9]{64}(";)/, `$1${sha(manifestBytes)}$2`);
  writeFileSync(pinPath, pin);
  const known = new Set(cards.map(card => card.id));
  const missing = metadata.data.filter((card: any) => card.archetype && groups[card.archetype] === undefined && profiles.some(profile => profile.archetype === card.archetype) && !known.has(card.id)).map((card: any) => ({ id: card.id, name: card.name, archetype: card.archetype }));
  const report = { version: manifest.version, cards: capabilities.length, groups: Object.keys(groups).length, bridges: bridges.length,
    niche_rows: bridges.filter(row => row.tier === "niche").length,
    gzip_bytes: Object.values(manifest.files).reduce((sum, file) => sum + file.gzipBytes, 0), elapsed_ms: Math.round(performance.now() - started), max_rss_kib: process.resourceUsage().maxRSS,
    missing_engine_cards: missing,
    sanity: Object.fromEntries(["advanced", "genesys"].map(format => [format, bridges.filter(row => row.source === "Odion" && row.format === format).slice(0, 5).map(row => ({ target: row.target, score: row.score }))])) };
  console.log(JSON.stringify(report, null, 2));
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2), get = (flag: string) => { const i = args.indexOf(flag); return i < 0 ? undefined : args[i + 1]; };
  const engineDirectory = get("--engine-directory") ?? process.env.DUEL_DATA_DIR;
  if (!engineDirectory) throw new Error("Set DUEL_DATA_DIR or pass --engine-directory (read-only engine bundle)");
  await rebuildBridges({ engineDirectory, directory: get("--directory"), output: get("--output"), metadata: get("--metadata"), pin: get("--pin") });
}
